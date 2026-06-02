import React from "react";
import { OffthreadVideo, Series, useVideoConfig } from "remotion";
import { CaptionOverlay } from "./CaptionOverlay";
import type { RenderManifest } from "./types";

export const VideoEditor: React.FC<{ manifest: RenderManifest }> = ({ manifest }) => {
  const { width, height, fps } = useVideoConfig();

  // Fallback: sem segmentos (vídeo antigo / sem fala) → toca o vídeo inteiro
  const segments =
    manifest.segments && manifest.segments.length > 0
      ? manifest.segments
      : [{ startMs: 0, endMs: (manifest.durationInFrames / fps) * 1000 }];

  return (
    <div style={{ width, height, position: "relative", backgroundColor: "#000" }}>
      <Series>
        {segments.map((seg, i) => {
          const startF = Math.round((seg.startMs / 1000) * fps);
          const endF = Math.round((seg.endMs / 1000) * fps);
          const dur = Math.max(1, endF - startF);
          return (
            <Series.Sequence key={i} durationInFrames={dur}>
              <OffthreadVideo
                src={manifest.videoUrl}
                trimBefore={startF}
                trimAfter={endF}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </Series.Sequence>
          );
        })}
      </Series>
      <CaptionOverlay captions={manifest.captions} />
    </div>
  );
};
