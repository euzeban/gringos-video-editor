import type { Caption } from "@remotion/captions";

export interface KeepSegment {
  startMs: number; // início no vídeo ORIGINAL
  endMs: number;   // fim no vídeo ORIGINAL
}

export interface RenderManifest {
  jobId: string;
  videoUrl: string;
  captions: Caption[]; // já remapeadas pro timeline COMPRIMIDO (pós-corte)
  segments: KeepSegment[]; // trechos a manter (silêncio entre eles foi cortado)
  durationInFrames: number;
  fps: 30;
  width: 1080;
  height: 1920;
}

export interface VideoJobSummary {
  id: string;
  status: string;
  output_video_url: string | null;
  created_by: string | null;
  created_at: string;
}
