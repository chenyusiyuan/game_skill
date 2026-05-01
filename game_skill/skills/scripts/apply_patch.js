#!/usr/bin/env node
/**
 * apply_patch.js - apply patch-based codegen output to cases/<slug>/game.
 *
 * Usage:
 *   node apply_patch.js <case-dir> <patch-file> [--dry-run] [--archive-to .game/stages/{N}/patches.json]
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, isAbsolute, relative, resolve, sep } from "path";

function usage() {
  return [
    "Usage: node apply_patch.js <case-dir> <patch-file> [--dry-run] [--archive-to <path>]",
    "",
    "Patch file format: JSON array or { patches: [...] }.",
    "Ops: add-file, delete-file, edit, replace-function.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`[apply_patch] ${err.message}`);
  process.exit(1);
}

function main() {
  const positionals = [];
  let dryRun = false;
  let archiveTo = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--archive-to") {
      archiveTo = args[++i];
      if (!archiveTo) throw new Error("--archive-to requires a path");
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    positionals.push(arg);
  }

  const caseDir = positionals[0] ? resolve(positionals[0]) : null;
  const patchPath = positionals[1] ? resolve(positionals[1]) : null;
  if (!caseDir || !patchPath) {
    console.error(usage());
    process.exit(2);
  }
  if (!existsSync(caseDir)) throw new Error(`case-dir does not exist: ${caseDir}`);
  if (!existsSync(patchPath)) throw new Error(`patch-file does not exist: ${patchPath}`);

  const gameRoot = resolve(caseDir, "game");
  const patches = readPatches(patchPath);
  const plan = patches.map((patch, index) => normalizePatch(patch, index, gameRoot));

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      caseDir,
      gameRoot,
      patches: plan.map((item) => ({
        index: item.index,
        op: item.op,
        path: relative(process.cwd(), item.filePath),
      })),
    }, null, 2));
    return;
  }

  const applied = [];
  try {
    for (const item of plan) {
      applyOne(item, applied);
    }
    if (archiveTo) {
      writeArchive(caseDir, archiveTo, patches);
    }
    cleanupBackups(applied);
  } catch (err) {
    rollback(applied);
    throw err;
  }

  console.log(JSON.stringify({
    ok: true,
    applied: plan.length,
    archive: archiveTo ? relative(process.cwd(), resolveArchivePath(caseDir, archiveTo)) : null,
  }, null, 2));
}

function readPatches(path) {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const patches = Array.isArray(doc) ? doc : doc?.patches;
  if (!Array.isArray(patches)) throw new Error("patch-file must be a JSON array or an object with patches[]");
  return patches;
}

function normalizePatch(patch, index, gameRoot) {
  if (!patch || typeof patch !== "object") throw new Error(`patch[${index}] must be an object`);
  const op = patch.op;
  const filePath = resolvePatchPath(gameRoot, patch.path, index);
  if (!["add-file", "delete-file", "edit", "replace-function"].includes(op)) {
    throw new Error(`patch[${index}] unknown op: ${op}`);
  }
  if (op === "add-file" && typeof patch.content !== "string") {
    throw new Error(`patch[${index}] add-file requires content`);
  }
  if (op === "edit") {
    if (typeof patch.anchor !== "string" || !patch.anchor) throw new Error(`patch[${index}] edit requires anchor`);
    if (typeof patch.insert !== "string") throw new Error(`patch[${index}] edit requires insert`);
  }
  if (op === "replace-function") {
    if (typeof patch.name !== "string" || !patch.name) throw new Error(`patch[${index}] replace-function requires name`);
    if (typeof patch.content !== "string") throw new Error(`patch[${index}] replace-function requires content`);
  }
  return { ...patch, index, op, filePath };
}

function resolvePatchPath(gameRoot, patchPath, index) {
  if (typeof patchPath !== "string" || !patchPath) throw new Error(`patch[${index}] path is required`);
  if (isAbsolute(patchPath)) throw new Error(`patch[${index}] path must be relative to case-dir/game`);
  const resolved = resolve(gameRoot, patchPath);
  if (resolved !== gameRoot && !resolved.startsWith(gameRoot + sep)) {
    throw new Error(`patch[${index}] path escapes game root: ${patchPath}`);
  }
  return resolved;
}

function applyOne(item, applied) {
  switch (item.op) {
    case "add-file":
      if (existsSync(item.filePath)) throw new Error(`add-file target already exists: ${relative(process.cwd(), item.filePath)}`);
      mkdirSync(dirname(item.filePath), { recursive: true });
      writeFileSync(item.filePath, item.content, "utf8");
      applied.push({ filePath: item.filePath, existed: false, backupPath: null });
      return;
    case "delete-file": {
      if (!existsSync(item.filePath)) throw new Error(`delete-file target missing: ${relative(process.cwd(), item.filePath)}`);
      const backupPath = createBackup(item.filePath, item.index);
      rmSync(item.filePath, { force: true });
      applied.push({ filePath: item.filePath, existed: true, backupPath });
      return;
    }
    case "edit": {
      if (!existsSync(item.filePath)) throw new Error(`edit target missing: ${relative(process.cwd(), item.filePath)}`);
      const before = readFileSync(item.filePath, "utf8");
      const first = before.indexOf(item.anchor);
      if (first < 0) throw new Error(`edit anchor not found in ${relative(process.cwd(), item.filePath)}: ${item.anchor}`);
      if (before.indexOf(item.anchor, first + item.anchor.length) >= 0) {
        throw new Error(`edit anchor is not unique in ${relative(process.cwd(), item.filePath)}: ${item.anchor}`);
      }
      const backupPath = createBackup(item.filePath, item.index);
      const after = before.slice(0, first + item.anchor.length) + item.insert + before.slice(first + item.anchor.length);
      writeFileSync(item.filePath, after, "utf8");
      applied.push({ filePath: item.filePath, existed: true, backupPath });
      return;
    }
    case "replace-function": {
      if (!existsSync(item.filePath)) throw new Error(`replace-function target missing: ${relative(process.cwd(), item.filePath)}`);
      const before = readFileSync(item.filePath, "utf8");
      const range = findFunctionRange(before, item.name);
      if (!range) throw new Error(`function ${item.name} not found in ${relative(process.cwd(), item.filePath)}`);
      const backupPath = createBackup(item.filePath, item.index);
      const after = before.slice(0, range.start) + item.content + before.slice(range.end);
      writeFileSync(item.filePath, after, "utf8");
      applied.push({ filePath: item.filePath, existed: true, backupPath });
      return;
    }
    default:
      throw new Error(`unreachable op: ${item.op}`);
  }
}

function createBackup(filePath, index) {
  const backupPath = `${filePath}.backup-${Date.now()}-${index}`;
  copyFileSync(filePath, backupPath);
  return backupPath;
}

function rollback(applied) {
  for (const item of [...applied].reverse()) {
    try {
      if (item.existed) {
        copyFileSync(item.backupPath, item.filePath);
      } else if (existsSync(item.filePath)) {
        rmSync(item.filePath, { force: true });
      }
    } finally {
      if (item.backupPath && existsSync(item.backupPath)) unlinkSync(item.backupPath);
    }
  }
}

function cleanupBackups(applied) {
  for (const item of applied) {
    if (item.backupPath && existsSync(item.backupPath)) unlinkSync(item.backupPath);
  }
}

function findFunctionRange(source, name) {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegex(name)}\\s*\\(`, "m");
  const match = re.exec(source);
  if (!match) return null;
  const open = source.indexOf("{", match.index + match[0].length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return { start: match.index, end: i + 1 };
  }
  return null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeArchive(caseDir, archiveArg, patches) {
  const archivePath = resolveArchivePath(caseDir, archiveArg);
  mkdirSync(dirname(archivePath), { recursive: true });
  const entry = {
    appliedAt: new Date().toISOString(),
    patches,
  };
  if (!existsSync(archivePath)) {
    writeFileSync(archivePath, JSON.stringify(entry, null, 2) + "\n", "utf8");
    return;
  }
  const existing = JSON.parse(readFileSync(archivePath, "utf8"));
  if (Array.isArray(existing)) {
    existing.push(entry);
    writeFileSync(archivePath, JSON.stringify(existing, null, 2) + "\n", "utf8");
    return;
  }
  const next = existing?.entries
    ? { ...existing, entries: [...existing.entries, entry] }
    : { entries: [existing, entry] };
  writeFileSync(archivePath, JSON.stringify(next, null, 2) + "\n", "utf8");
}

function resolveArchivePath(caseDir, archiveArg) {
  if (isAbsolute(archiveArg)) return resolve(archiveArg);
  return resolve(caseDir, archiveArg);
}
