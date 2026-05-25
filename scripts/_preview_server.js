import { spawn } from "node:child_process";
import net from "node:net";

export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("failed to allocate a free port"));
      });
    });
  });
}

export function waitForDevServer({ dev, port, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const readyPattern = new RegExp(`(Local:\\s+http://127\\.0\\.0\\.1:${port}/|ready in \\d+\\s*ms)`, "u");
    const timeout = setTimeout(() => {
      settle(reject, new Error(`timed out waiting for vite dev readiness on 127.0.0.1:${port}`));
    }, timeoutMs);

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      dev.off("exit", onExit);
      dev.stdout?.off("data", onData);
      dev.stderr?.off("data", onData);
      fn(value);
    };

    const onExit = (code, signal) => {
      settle(reject, new Error(`vite dev exited before readiness: code=${code ?? "null"} signal=${signal ?? "null"}`));
    };

    const onData = (chunk) => {
      if (readyPattern.test(String(chunk))) settle(resolve);
    };

    dev.once("exit", onExit);
    dev.stdout?.on("data", onData);
    dev.stderr?.on("data", onData);
  });
}

export async function startViteDevServer({ gameDir, explicitPort = null, timeoutMs = 30_000 }) {
  const attempts = explicitPort ? 1 : 2;
  let lastError = null;
  let lastOutput = "";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = explicitPort || (await findFreePort());
    const dev = spawn("npx", ["vite", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
      cwd: gameDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const devOutput = [];
    dev.stdout.on("data", (chunk) => devOutput.push(String(chunk)));
    dev.stderr.on("data", (chunk) => devOutput.push(String(chunk)));

    try {
      await waitForDevServer({ dev, port, timeoutMs });
      return { dev, port, devOutput };
    } catch (error) {
      lastError = error;
      lastOutput = devOutput.join("").slice(-4000);
      dev.kill("SIGTERM");
    }
  }

  const error = lastError instanceof Error ? lastError : new Error(String(lastError));
  error.devOutput = lastOutput;
  throw error;
}
