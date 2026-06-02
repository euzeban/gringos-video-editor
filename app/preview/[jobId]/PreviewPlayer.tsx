"use client";

import { useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { VideoEditor } from "@/src/VideoEditor";
import type { RenderManifest } from "@/src/types";

const ACCENT = "#11D462";
const fmtDur = (ms: number) => {
  const s = ms / 1000;
  return s >= 1 ? `${s.toFixed(1)}s` : `${Math.round(ms)}ms`;
};

export function PreviewPlayer({ manifest: initial }: { manifest: RenderManifest }) {
  const [manifest, setManifest] = useState<RenderManifest>(initial);
  const segments = manifest.editSegments ?? [];
  const [keep, setKeep] = useState<boolean[]>(
    segments.map((_, i) => !(manifest.removedIndices ?? []).includes(i)),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const removedCount = keep.filter((k) => !k).length;
  const dirty = useMemo(() => {
    const removedNow = keep.map((k, i) => (!k ? i : -1)).filter((i) => i >= 0);
    const before = (manifest.removedIndices ?? []).slice().sort((a, b) => a - b).join(",");
    return removedNow.sort((a, b) => a - b).join(",") !== before;
  }, [keep, manifest.removedIndices]);

  const toggle = (i: number) => setKeep((prev) => prev.map((k, j) => (j === i ? !k : k)));

  async function apply() {
    const keepIndices = keep.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
    if (keepIndices.length === 0) { setMsg("Você não pode remover todos os trechos."); return; }
    setBusy(true);
    setMsg("Re-gerando o vídeo…");
    try {
      const r = await fetch("/api/recut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: manifest.jobId, keepIndices }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Falha ao re-gerar");
      setManifest((m) => ({
        ...m,
        videoUrl: data.videoUrl,
        durationInFrames: data.durationInFrames,
        segments: [],
        removedIndices: keep.map((k, i) => (!k ? i : -1)).filter((i) => i >= 0),
      }));
      setMsg("✓ Pronto! Confira o resultado e exporte.");
    } catch (e) {
      setMsg("⚠ " + (e instanceof Error ? e.message : "erro"));
    } finally {
      setBusy(false);
    }
  }

  const hasSegments = segments.length > 0;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start", justifyContent: "center", width: "100%", maxWidth: 1100, fontFamily: "Inter, system-ui, sans-serif", color: "#fff" }}>
      {/* PLAYER */}
      <div style={{ flexShrink: 0 }}>
        <Player
          key={manifest.videoUrl}
          component={VideoEditor}
          inputProps={{ manifest }}
          durationInFrames={Math.max(1, manifest.durationInFrames)}
          compositionWidth={manifest.width}
          compositionHeight={manifest.height}
          fps={manifest.fps}
          style={{ width: 320, height: 568, borderRadius: 12, overflow: "hidden", border: "1px solid #222" }}
          controls
          loop
        />
      </div>

      {/* PAINEL DE REVISÃO */}
      {hasSegments && (
        <div style={{ flex: 1, minWidth: 320, maxWidth: 560 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 4px" }}>Revisar edição</h2>
          <p style={{ fontSize: 13, color: "#9aa", margin: "0 0 14px" }}>
            {segments.length} trechos · {removedCount} marcados pra remover. Tire repetições e cortes ruins, depois clique em <b>Aplicar</b>.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 460, overflowY: "auto", paddingRight: 6 }}>
            {segments.map((seg, i) => {
              const kept = keep[i];
              return (
                <div
                  key={i}
                  onClick={() => toggle(i)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10,
                    cursor: "pointer", userSelect: "none",
                    background: kept ? "rgba(17,212,98,0.08)" : "rgba(255,80,80,0.07)",
                    border: `1px solid ${kept ? "rgba(17,212,98,0.35)" : "rgba(255,80,80,0.3)"}`,
                    opacity: kept ? 1 : 0.6,
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1.3, flexShrink: 0 }}>{kept ? "✅" : "🗑️"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, lineHeight: 1.35, textDecoration: kept ? "none" : "line-through" }}>
                      {seg.text || <i style={{ color: "#778" }}>(sem fala)</i>}
                    </div>
                    <div style={{ fontSize: 11, color: "#778", marginTop: 2 }}>
                      {fmtDur(seg.startMs)} → {fmtDur(seg.endMs)} · {fmtDur(seg.endMs - seg.startMs)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <button
              onClick={apply}
              disabled={busy || !dirty}
              style={{
                background: dirty && !busy ? ACCENT : "#2a2a2a",
                color: dirty && !busy ? "#08120B" : "#888",
                border: "none", borderRadius: 10, padding: "12px 20px", fontWeight: 800, fontSize: 14,
                cursor: dirty && !busy ? "pointer" : "default",
              }}
            >
              {busy ? "Re-gerando…" : "Aplicar edição"}
            </button>
            {msg && <span style={{ fontSize: 13, color: "#9aa" }}>{msg}</span>}
          </div>
          <p style={{ fontSize: 12, color: "#667", marginTop: 14 }}>
            Depois de revisar, use <b>Exportar</b> no Social Hub para gerar o vídeo final com as legendas.
          </p>
        </div>
      )}
    </div>
  );
}
