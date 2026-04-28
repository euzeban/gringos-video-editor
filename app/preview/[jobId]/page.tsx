import { PreviewPlayer } from "./PreviewPlayer";
import { supabase } from "@/src/server/supabase";
import type { RenderManifest } from "@/src/types";

export const runtime = "nodejs";

export default async function PreviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  const { data: job } = await supabase
    .from("video_jobs")
    .select("render_manifest")
    .eq("id", jobId)
    .single();

  if (!job?.render_manifest) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#fff",
        }}
      >
        Job não encontrado
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "#000",
      }}
    >
      <PreviewPlayer manifest={job.render_manifest as RenderManifest} />
    </div>
  );
}
