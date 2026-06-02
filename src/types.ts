import type { Caption } from "@remotion/captions";

export interface KeepSegment {
  startMs: number; // início no vídeo ORIGINAL
  endMs: number;   // fim no vídeo ORIGINAL
}

// Trecho falado editável (mostrado no painel de revisão), em tempo ORIGINAL
export interface EditSegment {
  startMs: number;
  endMs: number;
  text: string; // transcrição do trecho (pra você reconhecer e remover repetições)
}

export interface RenderManifest {
  jobId: string;
  videoUrl: string;             // vídeo de PREVIEW já cortado/contínuo (pós-edição)
  captions: Caption[];          // remapeadas pro timeline do preview
  segments: KeepSegment[];      // vazio quando o corte foi feito no servidor
  durationInFrames: number;
  fps: 30;
  width: 1080;
  height: 1920;
  // ── Campos p/ o painel de revisão (re-corte) ──
  rawVideoUrl?: string;         // vídeo ORIGINAL (sem corte) — base pro re-corte
  rawCaptions?: Caption[];      // legendas em tempo ORIGINAL (pra re-remapear)
  editSegments?: EditSegment[]; // TODOS os trechos falados (com texto) p/ revisar
  removedIndices?: number[];    // índices de editSegments que o usuário removeu
}

export interface VideoJobSummary {
  id: string;
  status: string;
  output_video_url: string | null;
  created_by: string | null;
  created_at: string;
}
