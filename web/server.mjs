import { createServer } from "node:http";
import { parse } from "node:url";
import { spawn } from "node:child_process";
import path from "node:path";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const hostname = "127.0.0.1";

// Boot the persistent whisper daemon as a child process so it loads the model
// once and stays warm. The Next API route /api/stt talks to it over HTTP.
function startWhisperDaemon() {
  const sttDir = path.resolve(process.cwd(), "..", "stt");
  const py = path.join(sttDir, ".venv", "bin", "python");
  const child = spawn(
    py,
    ["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "7891", "--app-dir", sttDir],
    {
      cwd: sttDir,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env },
    },
  );
  child.on("exit", (code) => {
    console.log(`[stt] daemon exited (code ${code}); restarting in 3s`);
    setTimeout(startWhisperDaemon, 3000);
  });
  process.on("exit", () => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  });
}
startWhisperDaemon();

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  const parsedUrl = parse(req.url, true);
  handle(req, res, parsedUrl);
});

httpServer.listen(port, hostname, () => {
  console.log(`▸ Claude Talk ready at http://${hostname}:${port}`);
});
