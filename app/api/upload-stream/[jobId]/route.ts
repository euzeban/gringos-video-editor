import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/src/server/cors";
import { supabase } from "@/src/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;

  if (!jobId) {
    return withCors(NextResponse.json({ error: "jobId required" }, { status: 400 }));
  }

  const contentType = req.headers.get("content-type") || "video/mp4";
  const ext = contentType.includes("quicktime")
    ? "mov"
    : contentType.includes("webm")
    ? "webm"
    : "mp4";
  const filePath = `raw/${jobId}.${ext}`;

  // req.arrayBuffer() — sem parsing multipart, sem limite de tamanho no App Router
  const buffer = Buffer.from(await req.arrayBuffer());

  if (buffer.length === 0) {
    return withCors(NextResponse.json({ error: "Empty body" }, { status: 400 }));
  }

  const { error: uploadError } = await supabase.storage
    .from("gringos-videos")
    .upload(filePath, buffer, { contentType, upsert: true });

  if (uploadError) {
    return withCors(
      NextResponse.json({ error: uploadError.message }, { status: 500 })
    );
  }

  const { data: urlData } = supabase.storage
    .from("gringos-videos")
    .getPublicUrl(filePath);

  await supabase
    .from("video_jobs")
    .update({
      raw_video_url: urlData.publicUrl,
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return withCors(NextResponse.json({ videoUrl: urlData.publicUrl }));
}
