import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/src/server/cors";
import { supabase } from "@/src/server/supabase";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  const createdBy = String(formData.get("createdBy") ?? "mauro");

  if (!(file instanceof File)) {
    return withCors(NextResponse.json({ error: "No file" }, { status: 400 }));
  }

  if (file.size > 500 * 1024 * 1024) {
    return withCors(NextResponse.json({ error: "File exceeds 500MB limit" }, { status: 400 }));
  }

  const { data: job, error: jobError } = await supabase
    .from("video_jobs")
    .insert({ created_by: createdBy, status: "uploading" })
    .select("id")
    .single();

  if (jobError || !job) {
    return withCors(NextResponse.json({ error: "Failed to create job" }, { status: 500 }));
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const filePath = `raw/${job.id}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("gringos-videos")
    .upload(filePath, buffer, { contentType: file.type || "video/mp4", upsert: true });

  if (uploadError) {
    return withCors(NextResponse.json({ error: uploadError.message }, { status: 500 }));
  }

  const { data: urlData } = supabase.storage.from("gringos-videos").getPublicUrl(filePath);

  await supabase
    .from("video_jobs")
    .update({
      raw_video_url: urlData.publicUrl,
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  return withCors(NextResponse.json({ jobId: job.id, videoUrl: urlData.publicUrl }));
}
