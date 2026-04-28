"use client";

import { Player } from "@remotion/player";
import { VideoEditor } from "@/src/VideoEditor";
import type { RenderManifest } from "@/src/types";

export function PreviewPlayer({ manifest }: { manifest: RenderManifest }) {
  return (
    <Player
      component={VideoEditor}
      inputProps={{ manifest }}
      durationInFrames={manifest.durationInFrames}
      compositionWidth={manifest.width}
      compositionHeight={manifest.height}
      fps={manifest.fps}
      style={{ width: 360, height: 640 }}
      controls
      loop
    />
  );
}
