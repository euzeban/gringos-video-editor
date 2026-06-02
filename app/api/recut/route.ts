import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import ffmpegStatic from "ffmpeg-static";
import type { Caption } from "@remotion/captions";
import { corsPreflight, withCors } from "@/src/server/cors";
import { supabase } from "@/src/server/supabase";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

const FPS = 30;
const BUCKET = "gringos-videos";

type EditSegment = { startMs: number; endMs: number; text: string };

function resolveFfmpeg(): string {
  return process.env.FFMPEG_PATH || (ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : "ffmpeg");
}

// Re-corta o vídeo mantendo APENAS os trechos escolhidos no painel de revisão.
// body: { jobId, keepIndices: number[] } — índices em editSegments que ficam.
export async function POST(req: NextRequest) {
  let body: { jobId?: string; keepIndices?: number[] };
  try { body = await req.json(); } catch { return withCors(NextResponse.json({ error: "invalid json" }, { status: 400 })); }
  const { jobId, keepIndices } = body;
  if (!jobId || !Array.isArray(keepIndices)) {
    return withCors(NextResponse.json({ error: "jobId e keepIndices obrigatórios" }, { status: 400 }));
  }
  if (keepIndices.length === 0) {
    return withCors(NextResponse.json({ error: "Não dá pra remover todos os trechos." }, { status: 400 }));
  }

  const { data: job, error } = await supabase
    .from("video_jobs")
    .select("render_manifest")
    .eq("id", jobId)
    .single();
  if (error || !job?.render_manifest) {
    return withCors(NextResponse.json({ error: "Job não encontrado" }, { status: 404 }));
  }

  const manifest = job.render_manifest as {
    rawVideoUrl?: string;
    rawCaptions?: Caption[];
    editSegments?: EditSegment[];
    width: number;
    height: number;
  };
  const rawVideoUrl = manifest.rawVideoUrl;
  const allSegments = manifest.editSegments || [];
  const rawCaptions = manifest.rawCaptions || [];
  if (!rawVideoUrl || allSegments.length === 0) {
    return withCors(NextResponse.json({ error: "Job sem dados de edição (re-processe o vídeo)" }, { status: 400 }));
  }

  // Trechos mantidos, em ordem temporal
  const kept = keepIndices
    .filter((i) => i >= 0 && i < allSegments.length)
    .map((i) => allSegments[i])
    .sort((a, b) => a.startMs - b.startMs);
  if (kept.length === 0) {
    return withCors(NextResponse.json({ error: "Seleção inválida" }, { status: 400 }));
  }

  const tmpDir = os.tmpdir();
  const inPath = path.join(tmpDir, `${jobId}-raw.mp4`);
  const outPath = path.join(tmpDir, `${jobId}-recut.mp4`);

  try {
    // baixa o vídeo original
    const res = await fetch(rawVideoUrl);
    if (!res.ok) throw new Error(`download raw falhou: ${res.status}`);
    fs.writeFileSync(inPath, Buffer.from(await res.arrayBuffer()));

    // corta+junta só os trechos mantidos
    const ffmpeg = resolveFfmpeg();
    const sec = (ms: number) => (ms / 1000).toFixed(3);
    const ranges = kept.map((s) => `between(t,${sec(s.startMs)},${sec(s.endMs)})`).join("+");
    execFileSync(
      ffmpeg,
      [
        "-i", inPath,
        "-vf", `select='${ranges}',setpts=N/FRAME_RATE/TB`,
        "-af", `aselect='${ranges}',asetpts=N/SR/TB`,
        "-r", String(FPS),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", outPath,
      ],
      { stdio: "pipe", maxBuffer: 1024 * 1024 * 128 },
    );

    // sobe o novo corte (sobrescreve o anterior)
    const cutBuffer = fs.readFileSync(outPath);
    const cutStoragePath = `cuts/${jobId}.mp4`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(cutStoragePath, cutBuffer, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new Error(upErr.message);
    // cache-bust: getPublicUrl + timestamp pra forçar o player a recarregar
    const baseUrl = supabase.storage.from(BUCKET).getPublicUrl(cutStoragePath).data.publicUrl;
    const videoUrl = `${baseUrl}?v=${Date.now()}`;

    // remapeia as legendas pro novo timeline (só as palavras dentro dos trechos mantidos)
    const offsets: number[] = [];
    let acc = 0;
    for (const s of kept) { offsets.push(acc); acc += s.endMs - s.startMs; }
    const inKept = (t: number) => kept.findIndex((s) => t >= s.startMs && t <= s.endMs);
    const remapMs = (t: number) => {
      for (let i = 0; i < kept.length; i++) {
        if (t < kept[i].startMs) return offsets[i];
        if (t <= kept[i].endMs) return offsets[i] + (t - kept[i].startMs);
      }
      return acc;
    };
    const newCaptions = rawCaptions
      .filter((c) => inKept(c.startMs) !== -1)
      .map((c) => ({
        ...c,
        startMs: remapMs(c.startMs),
        endMs: remapMs(c.endMs),
        timestampMs: c.timestampMs != null ? remapMs(c.timestampMs) : null,
      }));

    const durationInFrames = Math.max(
      1,
      kept.reduce(
        (sum, s) => sum + Math.max(1, Math.round((s.endMs / 1000) * FPS) - Math.round((s.startMs / 1000) * FPS)),
        0,
      ),
    );

    const removedIndices = allSegments.map((_, i) => i).filter((i) => !keepIndices.includes(i));
    const newManifest = {
      ...manifest,
      videoUrl,
      captions: newCaptions,
      segments: [],
      durationInFrames,
      fps: 30,
      editSegments: allSegments, // mantém a lista COMPLETA (edição reversível)
      removedIndices,
    };

    await supabase
      .from("video_jobs")
      .update({ render_manifest: newManifest, captions: newCaptions, status: "review", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    return withCors(NextResponse.json({ ok: true, videoUrl, durationInFrames }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  } finally {
    for (const p of [inPath, outPath]) if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
