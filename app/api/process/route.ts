import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { openAiWhisperApiToCaptions } from "@remotion/openai-whisper";
import ffmpegPath from "ffmpeg-static";
import { corsPreflight, withCors } from "@/src/server/cors";
import { supabase } from "@/src/server/supabase";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  const { jobId, rawVideoUrl } = await req.json();

  if (!jobId || !rawVideoUrl) {
    return withCors(NextResponse.json({ error: "jobId and rawVideoUrl required" }, { status: 400 }));
  }

  await supabase
    .from("video_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  const tmpDir = os.tmpdir();
  const videoPath = path.join(tmpDir, `${jobId}.mp4`);
  const audioPath = path.join(tmpDir, `${jobId}.mp3`);

  try {
    const videoRes = await fetch(rawVideoUrl);

    if (!videoRes.ok) {
      throw new Error(`Failed to download raw video: ${videoRes.status}`);
    }

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    fs.writeFileSync(videoPath, videoBuffer);

    // ffmpeg-static pode não existir no build standalone do Next (o binário não é
    // rastreado). Preferimos FFMPEG_PATH, depois o estático SE o arquivo existir,
    // por fim o ffmpeg do sistema (instalado via apt no Dockerfile, no PATH).
    const ffmpeg =
      process.env.FFMPEG_PATH ||
      (ffmpegPath && fs.existsSync(ffmpegPath) ? ffmpegPath : "ffmpeg");
    execFileSync(ffmpeg, ["-i", videoPath, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", audioPath, "-y"], {
      stdio: "pipe",
    });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });

    const { captions } = openAiWhisperApiToCaptions({ transcription });
    const FPS = 30;
    const totalDurationMs = Math.round((transcription.duration ?? 0) * 1000);

    // ── FASE 1: corte de silêncio (estilo Reels, mas sem comer palavra) ─────
    // Passo 1: decide os cortes pelo gap REAL entre palavras (gap > GAP_MS = corta).
    // Passo 2: SÓ DEPOIS aplica folga PAD_MS nas bordas e funde sobreposições.
    // (Aplicar folga antes mascarava silêncios curtos e cortava rente demais.)
    const GAP_MS = 180;  // silêncio acima disso entre palavras é cortado
    const PAD_MS = 100;  // folga nas bordas do trecho falado (não come a palavra)
    const clampMs = (v: number) => Math.max(0, totalDurationMs ? Math.min(v, totalDurationMs) : v);

    type Seg = { startMs: number; endMs: number; text: string };
    let segments: Seg[] = [];
    if (captions.length > 0) {
      // Passo 1 — agrupa por gap REAL (sem padding ainda), carregando o texto
      const raw: Seg[] = [];
      for (const c of captions) {
        const last = raw[raw.length - 1];
        if (last && c.startMs - last.endMs <= GAP_MS) {
          last.endMs = Math.max(last.endMs, c.endMs);
          last.text = `${last.text} ${c.text}`.trim();
        } else {
          raw.push({ startMs: c.startMs, endMs: c.endMs, text: c.text });
        }
      }
      // Passo 2 — aplica folga nas bordas, clampa e funde o que sobrepôs
      for (const r of raw) {
        const s = clampMs(r.startMs - PAD_MS);
        const e = clampMs(r.endMs + PAD_MS);
        const last = segments[segments.length - 1];
        if (last && s <= last.endMs) {
          last.endMs = Math.max(last.endMs, e);
          last.text = `${last.text} ${r.text}`.trim();
        } else {
          segments.push({ startMs: s, endMs: e, text: r.text });
        }
      }
    } else {
      // sem fala detectada → mantém o vídeo inteiro, sem cortes nem legenda
      segments = [{ startMs: 0, endMs: totalDurationMs, text: "" }];
    }

    // ── Remapeia legendas pro timeline COMPRIMIDO (após os cortes) ──────────
    const offsets: number[] = [];
    let acc = 0;
    for (const seg of segments) { offsets.push(acc); acc += seg.endMs - seg.startMs; }

    const remapMs = (t: number): number => {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (t < seg.startMs) return offsets[i];
        if (t <= seg.endMs) return offsets[i] + (t - seg.startMs);
      }
      return acc;
    };

    const remappedCaptions = captions.map((c) => ({
      ...c,
      startMs: remapMs(c.startMs),
      endMs: remapMs(c.endMs),
      timestampMs: c.timestampMs != null ? remapMs(c.timestampMs) : null,
    }));

    // duração = soma dos frames por segmento (casa exatamente com a composição)
    const durationInFrames = segments.reduce(
      (sum, s) => sum + Math.max(1, Math.round((s.endMs / 1000) * FPS) - Math.round((s.startMs / 1000) * FPS)),
      0,
    );

    // ── FASE 1b: CORTA + JUNTA no servidor (ffmpeg) → vídeo ÚNICO contínuo ──────
    // Resolve o "pisca preto": o silêncio sai do ARQUIVO (não é pulado no player).
    // Se o corte falhar, cai no modo Series (segmentos) — ainda funciona.
    let finalVideoUrl = rawVideoUrl;
    let finalSegments: Seg[] = segments;
    const compressedMs = acc;
    const shouldCut = captions.length > 0 && segments.length > 0 && compressedMs < totalDurationMs - 100;

    if (shouldCut) {
      try {
        const sec = (ms: number) => (ms / 1000).toFixed(3);
        // aspas simples são quoting do PRÓPRIO ffmpeg (protege as vírgulas do between)
        const ranges = segments.map((s) => `between(t,${sec(s.startMs)},${sec(s.endMs)})`).join("+");
        const cutPath = path.join(tmpDir, `${jobId}-cut.mp4`);
        execFileSync(
          ffmpeg,
          [
            "-i", videoPath,
            "-vf", `select='${ranges}',setpts=N/FRAME_RATE/TB`,
            "-af", `aselect='${ranges}',asetpts=N/SR/TB`,
            "-r", String(FPS),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-y", cutPath,
          ],
          { stdio: "pipe", maxBuffer: 1024 * 1024 * 128 },
        );
        const cutBuffer = fs.readFileSync(cutPath);
        const cutStoragePath = `cuts/${jobId}.mp4`;
        const { error: upErr } = await supabase.storage
          .from("gringos-videos")
          .upload(cutStoragePath, cutBuffer, { contentType: "video/mp4", upsert: true });
        if (upErr) throw new Error(upErr.message);
        finalVideoUrl = supabase.storage.from("gringos-videos").getPublicUrl(cutStoragePath).data.publicUrl;
        finalSegments = []; // vídeo já contínuo → composição usa 1 OffthreadVideo (sem Series, sem preto)
        if (fs.existsSync(cutPath)) fs.unlinkSync(cutPath);
      } catch (cutErr) {
        console.error("[process] ffmpeg cut falhou, fallback p/ Series", cutErr);
        finalVideoUrl = rawVideoUrl;
        finalSegments = segments;
      }
    }

    const renderManifest = {
      jobId,
      videoUrl: finalVideoUrl,
      captions: remappedCaptions,
      segments: finalSegments,
      durationInFrames: Math.max(1, durationInFrames),
      fps: 30 as const,
      width: 1080,
      height: 1920,
      // ── dados p/ o painel de revisão (re-corte manual) ──
      rawVideoUrl,
      rawCaptions: captions,
      editSegments: segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text })),
    };

    await supabase
      .from("video_jobs")
      .update({
        status: "review",
        captions: remappedCaptions,
        render_manifest: renderManifest,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return withCors(NextResponse.json({ success: true, jobId, captionsCount: captions.length }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    await supabase
      .from("video_jobs")
      .update({ status: "error", error_message: message, updated_at: new Date().toISOString() })
      .eq("id", jobId);

    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  } finally {
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }

    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  }
}
