import React from "react";
import { OffthreadVideo, Series, useVideoConfig } from "remotion";
import { CaptionOverlay } from "./CaptionOverlay";
import type { RenderManifest } from "./types";

export const VideoEditor: React.FC<{ manifest: RenderManifest }> = ({ manifest }) => {
  const { width, height, fps } = useVideoConfig();
  const hasSegments = manifest.segments && manifest.segments.length > 0;

  return (
    <div style={{ width, height, position: "relative", backgroundColor: "#000" }}>
      {hasSegments ? (
        // Fallback (corte no servidor falhou): costura os segmentos no player.
        <Series>
          {manifest.segments.map((seg, i) => {
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
      ) : (
        // Caminho normal: vídeo JÁ cortado e contínuo no servidor → sem transições, sem preto.
        <OffthreadVideo
          src={manifest.videoUrl}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      <CaptionOverlay captions={manifest.captions} />
    </div>
  );
};
