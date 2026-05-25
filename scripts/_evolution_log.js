import { appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

function evalDirFor(casePath) {
  const evalDir = join(casePath, "eval");
  if (!existsSync(evalDir)) {
    throw new Error(`eval directory does not exist: ${evalDir}`);
  }
  return evalDir;
}

function logPathFor(casePath) {
  return join(evalDirFor(casePath), "evolution-log.jsonl");
}

export async function appendEvolutionLog({ casePath, entry }) {
  if (!entry?.kind || !entry?.timestamp) {
    throw new Error("evolution-log entry must include kind and timestamp");
  }
  await appendFile(logPathFor(casePath), `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readEvolutionLog(casePath) {
  const logPath = logPathFor(casePath);
  if (!existsSync(logPath)) return [];

  const raw = await readFile(logPath, "utf8");
  const entries = [];
  raw.split(/\r?\n/u).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      entries.push(JSON.parse(trimmed));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[evolution-log] skipping invalid line ${index + 1}: ${message}`);
    }
  });
  return entries;
}

export async function recordPhaseReport({
  casePath,
  phase,
  status,
  filesCreated,
  filesModified,
  acceptancePassed,
  followUps,
  blockers,
}) {
  await appendEvolutionLog({
    casePath,
    entry: {
      kind: "phase-report",
      timestamp: new Date().toISOString(),
      phase,
      status,
      filesCreated,
      filesModified,
      acceptancePassed,
      followUps,
      blockers,
    },
  });
}
