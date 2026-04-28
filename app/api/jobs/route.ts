import { NextRequest, NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/src/server/cors";
import { supabase } from "@/src/server/supabase";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "5");

  let query = supabase
    .from("video_jobs")
    .select("id, status, output_video_url, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withCors(NextResponse.json({ jobs: data ?? [] }));
}
