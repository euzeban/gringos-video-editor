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

  // Upload assembled file to Supabase Storage via TUS resumable upload.
  // Each TUS PATCH is 6 MB — small enough to bypass Traefik's body-size limit,
  // which would reject the full assembled file (100+ MB) in a single POST.
  const supabasePath = `raw/${job.id}.${ext}`;
  const fileSize = fs.statSync(assembledPath).size;
  const TUS_CHUNK = 6 * 1024 * 1024; // 6 MB
  const storageBase = process.env.SUPABASE_URL!;
  const authHeader = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`;

  let tusError: string | null = null;
  try {
    // Step 1: create the resumable upload
    const createResp = await fetch(`${storageBase}/storage/v1/upload/resumable`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Length": "0",
        "Upload-Length": String(fileSize),
        "Tus-Resumable": "1.0.0",
        "Upload-Metadata": [
          `bucketName ${Buffer.from("gringos-videos").toString("base64")}`,
          `objectName ${Buffer.from(supabasePath).toString("base64")}`,
          `contentType ${Buffer.from(contentType).toString("base64")}`,
          `cacheControl ${Buffer.from("3600").toString("base64")}`,
        ].join(","),
        "x-upsert": "true",
      },
    });

    if (!createResp.ok) {
      tusError = `TUS create failed: ${createResp.status} ${await createResp.text()}`;
    } else {
      const location = createResp.headers.get("Location")!;
      // Supabase returns http://...:8000/upload/resumable/{id} (internal Kong port).
      // Normalise to the public HTTPS URL so PATCH requests go through Traefik,
      // where each 6 MB chunk body is within the body-size limit.
      const uploadIdMatch = location.match(/\/upload\/resumable\/(.+)$/);
      const uploadUrl = `${storageBase}/storage/v1/upload/resumable/${uploadIdMatch?.[1] ?? ""}`;

      // Step 2: send file in TUS chunks
      const fd = fs.openSync(assembledPath, "r");
      let offset = 0;
      try {
        while (offset < fileSize) {
          const chunkSize = Math.min(TUS_CHUNK, fileSize - offset);
          const chunk = Buffer.alloc(chunkSize);
          fs.readSync(fd, chunk, 0, chunkSize, offset);

          const patchResp = await fetch(uploadUrl, {
            method: "PATCH",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/offset+octet-stream",
              "Content-Length": String(chunkSize),
              "Upload-Offset": String(offset),
              "Tus-Resumable": "1.0.0",
            },
            body: chunk,
          });

          if (!patchResp.ok) {
            tusError = `TUS patch failed at offset ${offset}: ${patchResp.status} ${await patchResp.text()}`;
            break;
          }
          offset += chunkSize;
        }
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (err) {
    tusError = err instanceof Error ? err.message : String(err);
  } finally {
    fs.existsSync(assembledPath) && fs.unlinkSync(assembledPath);
  }

  if (tusError) {
    await supabase
      .from("video_jobs")
      .update({ status: "error", error_message: tusError, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    return withCors(NextResponse.json({ error: tusError }, { status: 500 }));
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
