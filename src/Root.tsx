import "./index.css";
import React from "react";
import { Composition } from "remotion";
import { VideoEditor } from "./VideoEditor";
import type { RenderManifest } from "./types";

const defaultManifest: RenderManifest = {
  jobId: "preview",
  videoUrl: "",
  captions: [],
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
    />
  );
};
