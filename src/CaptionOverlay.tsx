import React from "react";
import { type Caption } from "@remotion/captions";
import { useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  captions: Caption[];
}

export const CaptionOverlay: React.FC<Props> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1000;

  const currentCaption = captions.find((caption) => currentMs >= caption.startMs && currentMs <= caption.endMs);

  if (!currentCaption) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        left: "5%",
        right: "5%",
        bottom: "15%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          maxWidth: "90%",
          padding: "12px 20px",
          borderRadius: 12,
          backgroundColor: "rgba(0,0,0,0.75)",
          textAlign: "center",
        }}
      >
        <span
          style={{
            color: "#fff",
            fontFamily: "Inter, sans-serif",
            fontWeight: 700,
            fontSize: 44,
            lineHeight: 1.2,
            textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
          }}
        >
          {currentCaption.text}
        </span>
      </div>
    </div>
  );
};
