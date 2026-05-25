#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvolutionLog } from "./_evolution_log.js";
import { KickbackLedger } from "./_kickback_ledger.js";
import { routeQuery } from "./triage_router.js";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

const workerMap = {
  2: () => import("./_stage_2_worker.js").then((module) => module.runStage2),
  3: () => import("./_stage_3_worker.js").then((module) => module.runStage3),
  4: () => import("./_stage_4_worker.js").then((module) => module.runStage4),
  5: () => import("./_stage_5_worker.js").then((module) => module.runStage5),
};

export async function runEvolution({ casePath, rawQuery, forceLocal = false, testHooks = null }) {
  const decision = testHooks?.routeQuery
    ? await testHooks.routeQuery({ casePath, rawQuery, forceLocal, rekickFrom: null })
    : await routeQuery({ casePath, rawQuery, forceLocal });
  if (decision.decision !== "execute") {
    return {
      status: decision.decision,
      decision,
      results: [],
    };
  }

  const queue = [...decision.subtasks];
  const ledger = new KickbackLedger();
  const decisions = [decision];
  const iteration = {
    rawQuery,
    caseId: decision.caseId,
    baselineRef: decision.baselineRef,
    subtasks: queue,
    results: [],
    iterationId: `${decision.caseId}-${Date.now()}`,
    stopped: false,
    stopReason: null,
    isStopped() {
      return this.stopped;
    },
    forceStop(reason) {
      this.stopped = true;
      this.stopReason = reason;
    },
  };

  for (let index = 0; index < queue.length; index += 1) {
    if (iteration.isStopped()) break;
    const subtask = queue[index];
    const loadWorker = workerMap[subtask.stage];
    const runner = testHooks?.dispatchWorker
      ? (args) => testHooks.dispatchWorker(args)
      : loadWorker
        ? await loadWorker()
        : null;
    const result = runner
      ? await runner({ casePath, subtask, evolutionContext: iteration })
      : await workerUnavailable({ casePath, subtask });

    iteration.results.push({
      subtaskId: subtask.id,
      verdict: result.verdict,
      ...result,
    });

    if (result.verdict === "kicked-back") {
      await logKickBack({ casePath, subtask, result });
      const count = ledger.recordKickback(subtask.id);
      if (ledger.shouldForceReject(subtask.id)) {
        await appendEvolutionLog({
          casePath,
          entry: {
            kind: "kickback-circuit-broken",
            timestamp: new Date().toISOString(),
            subtaskId: subtask.id,
            totalKickbacks: count,
            ledger: ledger.snapshot(),
          },
        });
        iteration.forceStop("kickback-circuit-broken");
        break;
      }

      const rekickFrom = {
        originalSubtaskId: subtask.id,
        originalSubtask: subtask,
        kickBackPayload: result.kickBack ?? {},
        kickBackCount: count,
      };
      const rekick = testHooks?.routeQuery
        ? await testHooks.routeQuery({ casePath, rawQuery, forceLocal, rekickFrom })
        : await routeQuery({ casePath, rawQuery, forceLocal, rekickFrom });
      decisions.push(rekick);

      if (rekick.decision !== "execute") {
        iteration.forceStop(rekick.decision);
        break;
      }

      queue.splice(index + 1, 0, ...rekick.subtasks);
      continue;
    }

    if (result.verdict === "blocked") {
      iteration.forceStop("blocked");
      break;
    }

    if (result.verdict === "fail" && subtask.stopIfFails === true) {
      iteration.forceStop("stopIfFails");
      break;
    }
  }

  if (iteration.isStopped()) {
    await appendEvolutionLog({
      casePath,
      entry: {
        kind: "iteration-stopped",
        timestamp: new Date().toISOString(),
        iterationId: iteration.iterationId,
        reason: iteration.stopReason,
        ledger: ledger.snapshot(),
      },
    });
  }

  return {
    status: iteration.stopReason === "kickback-circuit-broken" ? "rejected" : iteration.isStopped() ? "stopped" : "completed",
    iterationId: iteration.iterationId,
    decision,
    decisions,
    results: iteration.results,
    ledger: ledger.snapshot(),
    stopReason: iteration.stopReason,
  };
}

async function workerUnavailable({ casePath, subtask }) {
  const result = { verdict: "blocked", errors: ["worker unavailable"] };
  await appendEvolutionLog({
    casePath,
    entry: {
      kind: "subtask-result",
      timestamp: new Date().toISOString(),
      subtaskId: subtask.id,
      stage: subtask.stage,
      verdict: result.verdict,
      errors: result.errors,
    },
  });
  return result;
}

async function logKickBack({ casePath, subtask, result }) {
  await appendEvolutionLog({
    casePath,
    entry: {
      kind: "kick-back",
      timestamp: new Date().toISOString(),
      subtaskId: subtask.id,
      fromStage: subtask.stage,
      kickBack: result.kickBack ?? null,
    },
  });
}

function parseArgs(argv) {
  const args = { casePath: null, query: null, queryFile: null, forceLocal: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--query") args.query = argv[++index] ?? "";
    else if (arg === "--query-file") args.queryFile = argv[++index] ?? "";
    else if (arg === "--local") args.forceLocal = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    else if (!args.casePath) args.casePath = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.casePath || (!args.query && !args.queryFile)) {
    console.error('Usage: node scripts/run_evolution.js cases/<id> --query "..."');
    return args.help ? 0 : 1;
  }
  const rawQuery = args.queryFile ? await readFile(resolve(REPO, args.queryFile), "utf8") : args.query;
  const report = await runEvolution({ casePath: args.casePath, rawQuery, forceLocal: args.forceLocal });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
