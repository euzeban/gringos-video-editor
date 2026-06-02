import "./index.css";
import React from "react";
import { Composition } from "remotion";
import { VideoEditor } from "./VideoEditor";
import type { RenderManifest } from "./types";

const defaultManifest: RenderManifest = {
  jobId: "preview",
  videoUrl: "",
  captions: [],
  segments: [],
  durationInFrames: 300,
  fps: 30,
  width: 1080,
  height: 1920,
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="VideoEditor"
      component={VideoEditor}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ manifest: defaultManifest }}
      // duração/dimensões REAIS vêm do manifesto (antes era fixo em 300 = só 10s)
      calculateMetadata={({ props }) => {
        const m = props.manifest as RenderManifest;
        return {
          durationInFrames: Math.max(1, m?.durationInFrames || 300),
          fps: m?.fps || 30,
          width: m?.width || 1080,
          height: m?.height || 1920,
        };
      }}
    />
  );
};
