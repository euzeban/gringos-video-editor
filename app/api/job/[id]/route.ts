import { NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/src/server/cors";
import { supabase } from "@/src/server/supabase";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const { data, error } = await supabase
    .from("video_jobs")
    .select("id, status, render_manifest, output_video_url, error_message, created_at")
    .eq("id", id)
    .single();

  if (error) {
    return withCors(NextResponse.json({ error: error.message }, { status: 404 }));
  }

  return withCors(NextResponse.json(data));
}
