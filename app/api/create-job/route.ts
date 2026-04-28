import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/src/server/cors";
import { supabase } from "@/src/server/supabase";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  const { createdBy, extension } = await req.json();
  const ext = String(extension || "mp4").replace(/^\./, "").toLowerCase();

  const { data: job, error: jobError } = await supabase
    .from("video_jobs")
    .insert({ created_by: createdBy ?? "mauro", status: "uploading" })
    .select("id")
    .single();

  if (jobError || !job) {
    return withCors(
      NextResponse.json({ error: "Failed to create job" }, { status: 500 })
    );
  }

  const filePath = `raw/${job.id}.${ext}`;

  const { data: signedData, error: signedError } = await supabase.storage
    .from("gringos-videos")
    .createSignedUploadUrl(filePath);

  if (signedError || !signedData) {
    return withCors(
      NextResponse.json(
        { error: "Failed to create upload URL: " + signedError?.message },
        { status: 500 }
      )
    );
  }

  const { data: urlData } = supabase.storage
    .from("gringos-videos")
    .getPublicUrl(filePath);

  return withCors(
    NextResponse.json({
      jobId: job.id,
      signedUploadUrl: signedData.signedUrl,
      videoPublicUrl: urlData.publicUrl,
    })
  );
}
