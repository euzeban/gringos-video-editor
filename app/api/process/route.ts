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

    // ── FASE 1: corte de silêncio AGRESSIVO (estilo Reels) ──────────────────
    // Mantém só os trechos com fala; gaps de silêncio > GAP_MS são cortados.
    // PAD_MS = micro-folga p/ não cortar o ataque/fim da palavra.
    const GAP_MS = 200;
    const PAD_MS = 60;
    const clampMs = (v: number) => Math.max(0, totalDurationMs ? Math.min(v, totalDurationMs) : v);

    type Seg = { startMs: number; endMs: number };
    let segments: Seg[] = [];
    if (captions.length > 0) {
      for (const c of captions) {
        const s = clampMs(c.startMs - PAD_MS);
        const e = clampMs(c.endMs + PAD_MS);
        const last = segments[segments.length - 1];
        if (last && s - last.endMs <= GAP_MS) {
          last.endMs = Math.max(last.endMs, e); // funde (gap pequeno = mantém)
        } else {
          segments.push({ startMs: s, endMs: e });
        }
      }
    } else {
      // sem fala detectada → mantém o vídeo inteiro, sem cortes nem legenda
      segments = [{ startMs: 0, endMs: totalDurationMs }];
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

    const renderManifest = {
      jobId,
      videoUrl: rawVideoUrl,
      captions: remappedCaptions,
      segments,
      durationInFrames: Math.max(1, durationInFrames),
      fps: 30 as const,
      width: 1080,
      height: 1920,
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
