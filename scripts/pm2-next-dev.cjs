const { spawn } = require("node:child_process");
const path = require("node:path");

const cwd = process.cwd();
const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
const args = [nextBin, "dev", "-p", "3004"];

const child = spawn(process.execPath, args, {
  cwd,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("[pm2-next-dev] failed to start next dev:", error);
  process.exit(1);
});

for (const event of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(event, () => {
    if (!child.killed) child.kill(event);
  });
}
