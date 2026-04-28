import React from "react";
import { OffthreadVideo, useVideoConfig } from "remotion";
import { CaptionOverlay } from "./CaptionOverlay";
import type { RenderManifest } from "./types";

export const VideoEditor: React.FC<{ manifest: RenderManifest }> = ({ manifest }) => {
  const { width, height } = useVideoConfig();

  return (
    <div style={{ width, height, position: "relative", backgroundColor: "#000" }}>
      <OffthreadVideo
        src={manifest.videoUrl}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <CaptionOverlay captions={manifest.captions} />
    </div>
  );
};
