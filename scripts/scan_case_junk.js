#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const FORBIDDEN = [
  "game/node_modules",
  "game/package-lock.json",
  "game/.DS_Store",
  "game/yarn.lock",
  "game/pnpm-lock.yaml",
];

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

export function scanCaseJunk(caseDir) {
  const removed = [];

  for (const relPath of FORBIDDEN) {
    const absolutePath = join(caseDir, relPath);
    if (!existsSync(absolutePath)) continue;
    rmSync(absolutePath, { recursive: true, force: true });
    removed.push(normalizePath(relative(caseDir, absolutePath)));
  }

  return { ok: true, removed };
}
