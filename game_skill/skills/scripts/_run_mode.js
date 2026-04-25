#!/usr/bin/env node

import { createReadStream, existsSync, readFileSync, statSync } from "fs";
import { dirname, extname, normalize, relative, resolve, join } from "path";
import http from "http";
import { fileURLToPath, pathToFileURL } from "url";

const DEFAULT_RUN_MODE_BY_ENGINE = {
  phaser3: "local-http",
  pixijs: "local-http",
  three: "local-http",
  canvas: "file",
  "dom-ui": "file",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

function loadEngineRegistry() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const idxPath = resolve(scriptDir, "../references/engines/_index.json");
  if (!existsSync(idxPath)) return { engines: [] };
  try {
    return JSON.parse(readFileSync(idxPath, "utf-8"));
  } catch {
    return { engines: [] };
  }
}

export function parseEngineMarker(html) {
  const m = html.match(
    /<!--\s*ENGINE:\s*([^|>]+?)(?:\s*\|\s*VERSION:\s*([^|>]+?))?(?:\s*\|\s*RUN:\s*([^|>]+?))?\s*-->/
  );
  if (!m) return null;
  return {
    engineId: m[1]?.trim() || null,
    version: m[2]?.trim() || null,
    runMode: m[3]?.trim() || null,
  };
}

export function readGameMeta(gameDir) {
  const root = resolve(gameDir);
  const htmlPath = join(root, "index.html");
  if (!existsSync(htmlPath)) {
    throw new Error(`index.html 不存在: ${htmlPath}`);
  }

  const html = readFileSync(htmlPath, "utf-8");
  const marker = parseEngineMarker(html);
  const registry = loadEngineRegistry();
  const engineMeta = registry.engines?.find((e) => e.id === marker?.engineId) ?? null;
  const runMode =
    marker?.runMode ||
    engineMeta?.["default-run-mode"] ||
    DEFAULT_RUN_MODE_BY_ENGINE[marker?.engineId] ||
    "file";

  return {
    gameDir: root,
    htmlPath,
    html,
    marker,
    engineMeta,
    runMode,
  };
}

function startStaticServer(rootDir) {
  const root = resolve(rootDir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const absPath = resolve(root, `.${safePath.startsWith("/") ? safePath : `/${safePath}`}`);

    if (!absPath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!existsSync(absPath) || statSync(absPath).isDirectory()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    res.setHeader("Content-Type", MIME_TYPES[extname(absPath)] || "application/octet-stream");
    createReadStream(absPath).pipe(res);
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolvePromise({
        server,
        origin: `http://127.0.0.1:${addr.port}`,
      });
    });
  });
}

function findProjectRoot(gameDir) {
  let dir = resolve(gameDir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "assets")) && existsSync(join(dir, "cases"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(gameDir);
}

function toUrlPath(root, filePath) {
  const rel = relative(root, filePath);
  if (!rel || rel.startsWith("..")) return "/index.html";
  return "/" + rel.split(/[/\\]+/).map(encodeURIComponent).join("/");
}

export async function resolveLaunchTarget(gameDir) {
  const meta = readGameMeta(gameDir);
  if (meta.runMode === "local-http") {
    const serverRoot = findProjectRoot(meta.gameDir);
    const { server, origin } = await startStaticServer(serverRoot);
    return {
      ...meta,
      serverRoot,
      url: `${origin}${toUrlPath(serverRoot, meta.htmlPath)}`,
      close: async () =>
        await new Promise((resolvePromise, rejectPromise) =>
          server.close((err) => (err ? rejectPromise(err) : resolvePromise()))
        ),
    };
  }

  return {
    ...meta,
    url: pathToFileURL(meta.htmlPath).href,
    close: async () => {},
  };
}
