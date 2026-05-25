import assert from "node:assert/strict";
import { decideStatus } from "../scripts/check_delivery.js";

assert.equal(
  decideStatus({
    planValid: { ok: true },
    build: { ok: false, reason: "typecheck-failed" },
    runnerResult: { ok: false, reason: "skipped-due-to-prior-failure" },
  }).status,
  "generation-blocked",
);

assert.equal(
  decideStatus({
    importScan: {
      ok: false,
      reason: "forbidden-repo-dependency",
      violations: [{ specifier: "../../../scripts/check_delivery" }],
    },
    planValid: { ok: true },
    build: { ok: true },
    runnerResult: { ok: true, summary: {} },
  }).status,
  "chain-blocked",
);

assert.equal(
  decideStatus({
    planValid: { ok: true },
    build: { ok: true },
    runnerResult: { ok: false, reason: "expect-not-met" },
  }).status,
  "generation-blocked",
);

assert.equal(
  decideStatus({
    planValid: { ok: true },
    build: { ok: true },
    runnerResult: { ok: false, chainBlocked: true, reason: "runner-exception" },
  }).status,
  "chain-blocked",
);

assert.equal(
  decideStatus({
    planValid: { ok: true },
    build: { ok: true },
    runnerResult: {
      ok: true,
      summary: { changedPixels: 5000, milestoneCount: 3 },
      nonblockingTodosCount: 0,
      warnings: [],
    },
  }).status,
  "delivery-pass",
);

const diagnostic = {
  canvasMounted: true,
  canvasSize: { width: 480, height: 360 },
  canvasContext: "2d",
  viewport: { width: 480, height: 360 },
  pixelsAvailable: true,
  inputDispatched: true,
  stepsExecuted: 1,
  stepsTotal: 1,
  milestonesAny: 1,
  failedExpects: [],
};
const diagnosticDecision = decideStatus({
  planValid: { ok: true },
  build: { ok: true },
  runnerResult: {
    ok: true,
    summary: {},
    diagnostic,
    nonblockingTodosCount: 0,
    warnings: [],
  },
});
assert.equal(diagnosticDecision.status, "delivery-pass");
assert.deepEqual(diagnosticDecision.detail.diagnostic, diagnostic);

const junkDecision = decideStatus({
  planValid: { ok: true },
  build: { ok: true },
  runnerResult: {
    ok: true,
    summary: {},
    nonblockingTodosCount: 0,
    warnings: [],
  },
  junk: { ok: true, removed: ["game/node_modules"] },
});
assert.equal(junkDecision.status, "delivery-with-warnings");
assert.deepEqual(junkDecision.warnings, [
  { kind: "auto-cleaned-junk", severity: "warn", removed: ["game/node_modules"] },
]);

const nonblockingDecision = decideStatus({
  planValid: { ok: true },
  build: { ok: true },
  runnerResult: {
    ok: true,
    summary: {},
    nonblockingTodosCount: 2,
    warnings: [],
  },
});
assert.equal(nonblockingDecision.status, "delivery-with-warnings");
assert.deepEqual(nonblockingDecision.warnings, [{ kind: "nonblocking-todos", count: 2, severity: "info" }]);

const runnerWarningDecision = decideStatus({
  planValid: { ok: true },
  build: { ok: true },
  runnerResult: {
    ok: true,
    summary: {},
    nonblockingTodosCount: 0,
    warnings: [{ kind: "unexpected-milestone", id: "extra", count: 1, severity: "warn" }],
  },
});
assert.equal(runnerWarningDecision.status, "delivery-with-warnings");
assert.equal(runnerWarningDecision.warnings[0].kind, "unexpected-milestone");

console.log("OK delivery_decision_smoke");
