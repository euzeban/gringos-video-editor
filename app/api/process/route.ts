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

    const ffmpeg = ffmpegPath ?? "ffmpeg";
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
    const durationInFrames = Math.ceil((transcription.duration ?? 0) * 30);
    const renderManifest = {
      jobId,
      videoUrl: rawVideoUrl,
      captions,
      durationInFrames,
      fps: 30 as const,
      width: 1080,
      height: 1920,
    };

    await supabase
      .from("video_jobs")
      .update({
        status: "review",
        captions,
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
