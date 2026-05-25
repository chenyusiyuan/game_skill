#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

const IMPORT_RE = /\bimport\s+(?:[^'"()]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function walkTsFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function extractImportSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

function pathSegments(absPath) {
  return normalizePath(absPath).split("/").filter(Boolean);
}

function repoRelative(absPath, repoRoot) {
  return normalizePath(relative(repoRoot, absPath));
}

function findCasesIndex(segments) {
  return segments.lastIndexOf("cases");
}

function resolveSpecifier(filePath, specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return resolve(filePath, "..", specifier);
  }
  return null;
}

const FORBIDDEN_REPO_PREFIXES = ["templates", "scripts", "schemas", "archive", "legacy"];

function startsWithForbiddenRepoPrefix(value) {
  return FORBIDDEN_REPO_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix}/`) || value.includes(`/${prefix}/`));
}

function forbiddenReason({ filePath, specifier, caseDir, repoRoot }) {
  const spec = normalizePath(specifier);
  const caseSlug = basename(caseDir);
  const resolved = resolveSpecifier(filePath, specifier);
  const resolvedRel = resolved ? repoRelative(resolved, repoRoot) : "";
  const resolvedSegments = resolved ? pathSegments(resolved) : [];
  const casesIndex = findCasesIndex(resolvedSegments);
  const resolvedCaseSlug = casesIndex >= 0 ? resolvedSegments[casesIndex + 1] : null;

  if (startsWithForbiddenRepoPrefix(spec) || startsWithForbiddenRepoPrefix(resolvedRel)) {
    return "forbidden-repo-dependency";
  }

  if (resolvedCaseSlug && resolvedCaseSlug !== caseSlug) {
    return "sibling-case-dependency";
  }

  return null;
}

export function scanForbiddenImports(caseDir, { repoRoot = REPO } = {}) {
  const root = resolve(caseDir);
  const srcDir = join(root, "game/src");
  const violations = [];

  for (const filePath of walkTsFiles(srcDir)) {
    const source = readFileSync(filePath, "utf8");
    for (const specifier of extractImportSpecifiers(source)) {
      const reason = forbiddenReason({ filePath, specifier, caseDir: root, repoRoot });
      if (!reason) continue;
      violations.push({
        file: repoRelative(filePath, repoRoot).startsWith("..")
          ? normalizePath(filePath.split(sep).join("/"))
          : repoRelative(filePath, repoRoot),
        specifier,
        reason,
      });
    }
  }

  return {
    ok: violations.length === 0,
    reason: violations.length > 0 ? violations[0].reason : undefined,
    violations,
  };
}

function main() {
  const caseArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!caseArg || process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error("Usage: node scripts/scan_forbidden_imports.js cases/<slug>");
    process.exit(caseArg ? 0 : 2);
  }

  const result = scanForbiddenImports(resolve(REPO, caseArg));
  if (!result.ok) {
    console.error(`[imports] ${result.reason}`);
    for (const violation of result.violations) {
      console.error(`  - ${violation.file}: ${violation.specifier}`);
    }
    process.exit(1);
  }

  console.log("OK forbidden import scan");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
