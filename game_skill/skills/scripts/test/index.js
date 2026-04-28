#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(here)
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => join(here, name));

const args = ["--test", ...testFiles, join(here, "run.js")];
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const result = spawnSync(process.execPath, args, { stdio: "inherit", env });
process.exit(result.status ?? 1);
