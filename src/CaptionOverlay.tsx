import React, { useMemo } from "react";
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  captions: Caption[];
}

// Agrupa as palavras em "páginas" (algumas palavras por vez) — estilo TikTok/Reels.
const COMBINE_MS = 1200;

// Cores da legenda
const BASE_COLOR = "#FFFFFF";
const ACTIVE_COLOR = "#11D462"; // verde-marca Gringos

export const CaptionOverlay: React.FC<Props> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1000;

  const { pages } = useMemo(
    () => createTikTokStyleCaptions({ captions: captions ?? [], combineTokensWithinMilliseconds: COMBINE_MS }),
    [captions],
  );

  if (!pages.length) return null;

  // Página ativa = a última cujo startMs já passou
  let activeIndex = -1;
  for (let i = 0; i < pages.length; i++) {
    if (currentMs >= pages[i].startMs) activeIndex = i;
    else break;
  }
  if (activeIndex < 0) return null;
  const page = pages[activeIndex];

  // animação de entrada da página (pop)
  const pageStartFrame = (page.startMs / 1000) * fps;
  const enter = spring({ frame: frame - pageStartFrame, fps, config: { damping: 200 }, durationInFrames: 8 });
  const scale = interpolate(enter, [0, 1], [0.82, 1]);
  const translateY = interpolate(enter, [0, 1], [24, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: "6%",
        right: "6%",
        bottom: "18%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        transform: `translateY(${translateY}px) scale(${scale})`,
      }}
    >
      <div
        style={{
          maxWidth: "92%",
          textAlign: "center",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.28em",
          lineHeight: 1.18,
        }}
      >
        {page.tokens.map((token, i) => {
          const active = currentMs >= token.fromMs && currentMs <= token.toMs;
          return (
            <span
              key={i}
              style={{
                color: active ? ACTIVE_COLOR : BASE_COLOR,
                fontFamily: "Inter, system-ui, sans-serif",
                fontWeight: 800,
                fontSize: 64,
                letterSpacing: "-0.5px",
                textTransform: "uppercase",
                display: "inline-block",
                transform: active ? "scale(1.12)" : "scale(1)",
                transition: "transform 80ms ease-out",
                // contorno + sombra forte p/ legibilidade sobre qualquer fundo
                WebkitTextStroke: "2px rgba(0,0,0,0.9)",
                textShadow: "0 4px 14px rgba(0,0,0,0.85), 0 2px 4px rgba(0,0,0,0.9)",
                paintOrder: "stroke fill",
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
