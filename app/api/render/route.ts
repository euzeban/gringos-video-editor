import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { corsPreflight, withCors } from "@/src/server/cors";
import { supabase } from "@/src/server/supabase";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  const { jobId } = await req.json();

  if (!jobId) {
    return withCors(NextResponse.json({ error: "jobId required" }, { status: 400 }));
  }

  const { data: job, error } = await supabase
    .from("video_jobs")
    .select("render_manifest")
    .eq("id", jobId)
    .single();

  if (error || !job?.render_manifest) {
    return withCors(NextResponse.json({ error: "Job not found or no manifest" }, { status: 404 }));
  }

  const manifest = job.render_manifest;
  const outputPath = path.join(os.tmpdir(), `${jobId}-output.mp4`);

  try {
    await supabase
      .from("video_jobs")
      .update({ status: "rendering", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    const bundleLocation = await bundle({
      entryPoint: path.join(process.cwd(), "src", "index.ts"),
      webpackOverride: (config) => config,
    });

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "VideoEditor",
      inputProps: { manifest },
    });

    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: { manifest },
    });

    const buffer = fs.readFileSync(outputPath);
    const storagePath = `renders/${jobId}.mp4`;

    const { error: uploadError } = await supabase.storage
      .from("gringos-videos")
      .upload(storagePath, buffer, { contentType: "video/mp4", upsert: true });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: urlData } = supabase.storage.from("gringos-videos").getPublicUrl(storagePath);

    await supabase
      .from("video_jobs")
      .update({
        status: "done",
        output_video_url: urlData.publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return withCors(NextResponse.json({ downloadUrl: urlData.publicUrl }));
  } catch (renderError: unknown) {
    const message = renderError instanceof Error ? renderError.message : String(renderError);

    await supabase
      .from("video_jobs")
      .update({ status: "error", error_message: message, updated_at: new Date().toISOString() })
      .eq("id", jobId);

    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  } finally {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }
}
