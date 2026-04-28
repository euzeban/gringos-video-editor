import type { Caption } from "@remotion/captions";

export interface RenderManifest {
  jobId: string;
  videoUrl: string;
  captions: Caption[];
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
