export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#050505",
        color: "#ffffff",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 32 }}>Gringos Video Editor</h1>
        <p style={{ marginTop: 12, color: "rgba(255,255,255,.7)" }}>
          Use the Social Hub to upload, review and render videos.
        </p>
      </div>
    </main>
  );
}
