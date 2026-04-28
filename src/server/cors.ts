import { NextResponse } from "next/server";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const withCors = (response: NextResponse) => {
  Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
  return response;
};

export const corsPreflight = () => new NextResponse(null, { status: 204, headers });
