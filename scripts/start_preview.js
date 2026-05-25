#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, startViteDevServer } from "./_preview_server.js";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const args = { casePath: null, port: null, dryRun: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") args.port = Number(argv[++index]);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    else if (!args.casePath) args.casePath = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return args;
}

function previewInfo({ casePath, port }) {
  const caseDir = resolve(REPO, casePath);
  const gameDir = join(caseDir, "game");
  return {
    casePath,
    gameDir,
    port,
    url: `http://127.0.0.1:${port}/`,
    command: ["npx", "vite", "--port", String(port), "--host", "127.0.0.1", "--strictPort"],
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.casePath) {
    console.error("Usage: node scripts/start_preview.js cases/<slug> [--port <port>] [--dry-run] [--json]");
    return args.help ? 0 : 2;
  }

  const caseDir = resolve(REPO, args.casePath);
  const gameDir = join(caseDir, "game");
  if (!existsSync(gameDir)) throw new Error(`game directory does not exist: ${gameDir}`);
  const port = args.port || (await findFreePort());
  const info = previewInfo({ casePath: args.casePath, port });

  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
    return 0;
  }

  const started = await startViteDevServer({ gameDir, explicitPort: port });
  const output = { ...info, port: started.port, url: `http://127.0.0.1:${started.port}/` };
  if (args.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else process.stdout.write(`Preview URL: ${output.url}\n`);

  started.dev.stdout.on("data", (chunk) => process.stdout.write(chunk));
  started.dev.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const stop = () => started.dev.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  return await new Promise((resolve) => {
    started.dev.once("exit", (code) => resolve(code ?? 0));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
