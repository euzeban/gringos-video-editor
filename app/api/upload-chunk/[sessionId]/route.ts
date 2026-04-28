import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { corsPreflight, withCors } from "@/src/server/cors";
import { supabase } from "@/src/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;

  const chunkIndex = parseInt(req.headers.get("x-chunk-index") ?? "0");
  const totalChunks = parseInt(req.headers.get("x-total-chunks") ?? "1");
  const createdBy = req.headers.get("x-created-by") ?? "mauro";
  const contentType = req.headers.get("x-content-type") ?? "video/mp4";
  const ext = contentType.includes("quicktime") ? "mov" : contentType.includes("webm") ? "webm" : "mp4";

  if (!sessionId || isNaN(chunkIndex) || isNaN(totalChunks)) {
    return withCors(NextResponse.json({ error: "Invalid params" }, { status: 400 }));
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.length === 0) {
    return withCors(NextResponse.json({ error: "Empty chunk" }, { status: 400 }));
  }

  const tmpDir = os.tmpdir();
  const chunkPath = path.join(tmpDir, `ve-${sessionId}-${chunkIndex}.chunk`);
  fs.writeFileSync(chunkPath, buffer);

  // Not the last chunk — confirm and wait for the next
  if (chunkIndex < totalChunks - 1) {
    return withCors(NextResponse.json({ status: "chunk_saved", chunkIndex }));
  }

  // Last chunk — verify all chunks are present
  for (let i = 0; i < totalChunks; i++) {
    if (!fs.existsSync(path.join(tmpDir, `ve-${sessionId}-${i}.chunk`))) {
      return withCors(NextResponse.json({ error: `Missing chunk ${i}` }, { status: 400 }));
    }
  }

  // Assemble chunks into a single file
  const assembledPath = path.join(tmpDir, `ve-${sessionId}.${ext}`);
  const writeStream = fs.createWriteStream(assembledPath);
  for (let i = 0; i < totalChunks; i++) {
    const p = path.join(tmpDir, `ve-${sessionId}-${i}.chunk`);
    writeStream.write(fs.readFileSync(p));
    fs.unlinkSync(p);
  }
  await new Promise<void>((resolve, reject) => {
    writeStream.end();
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  // Create job record
  const { data: job, error: jobError } = await supabase
    .from("video_jobs")
    .insert({ created_by: createdBy, status: "uploading" })
    .select("id")
    .single();

  if (jobError || !job) {
    fs.existsSync(assembledPath) && fs.unlinkSync(assembledPath);
    return withCors(NextResponse.json({ error: "Failed to create job" }, { status: 500 }));
  }

  // Upload assembled file to Supabase Storage
  const supabasePath = `raw/${job.id}.${ext}`;
  const fileBuffer = fs.readFileSync(assembledPath);
  fs.unlinkSync(assembledPath);

  const { error: uploadError } = await supabase.storage
    .from("gringos-videos")
    .upload(supabasePath, fileBuffer, { contentType, upsert: true });

  if (uploadError) {
    await supabase
      .from("video_jobs")
      .update({ status: "error", error_message: uploadError.message, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    return withCors(NextResponse.json({ error: uploadError.message }, { status: 500 }));
  }

  const { data: urlData } = supabase.storage.from("gringos-videos").getPublicUrl(supabasePath);

  await supabase
    .from("video_jobs")
    .update({ raw_video_url: urlData.publicUrl, status: "pending", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  return withCors(
    NextResponse.json({ status: "assembled", jobId: job.id, videoUrl: urlData.publicUrl })
  );
}
