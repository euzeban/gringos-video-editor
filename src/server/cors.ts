import { NextResponse } from "next/server";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Chunk-Index, X-Total-Chunks, X-Created-By, X-Content-Type",
};

export const withCors = (response: NextResponse) => {
  Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
  return response;
};

export const corsPreflight = () => new NextResponse(null, { status: 204, headers });
