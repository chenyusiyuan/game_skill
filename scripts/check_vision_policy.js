#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkVisionPolicy } from "./resolve_vision_policy.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: node scripts/check_vision_policy.js <case-dir> [--json]";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = checkVisionPolicy(args.caseDir);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else if (result.status === "pass") console.log(`PASS vision policy: ${result.visionMode}`);
    else console.error(`FAIL vision policy: ${result.errors.join("; ")}`);
    process.exit(result.status === "pass" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage);
    process.exit(2);
  }
}

function parseArgs(argv) {
  const args = { caseDir: null, json: false };
  for (const arg of argv) {
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    if (args.caseDir) throw new Error(`unexpected argument: ${arg}`);
    args.caseDir = resolve(repoRoot, arg);
  }
  if (!args.caseDir) throw new Error("missing <case-dir>");
  return args;
}
