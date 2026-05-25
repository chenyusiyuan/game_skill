#!/usr/bin/env node
import assert from "node:assert/strict";
import { evaluateMilestoneFrequency } from "../scripts/_delivery_runner.mjs";

const burstMilestones = [
  { id: "brick-destroyed", at: 1000 },
  { id: "brick-destroyed", at: 1000 },
  { id: "brick-destroyed", at: 1005 },
  { id: "brick-destroyed", at: 1040 },
];

const noFrequency = evaluateMilestoneFrequency(
  { type: "milestone", id: "brick-destroyed", timeoutMs: 1000, minOccurrences: 1 },
  burstMilestones,
);
assert.equal(noFrequency.ok, true, "legacy milestone expect has no frequency gate");
assert.deepEqual(noFrequency.checks, []);

const minInterval = evaluateMilestoneFrequency(
  { type: "milestone", id: "brick-destroyed", timeoutMs: 1000, minOccurrences: 1, minIntervalMs: 16 },
  burstMilestones,
);
assert.equal(minInterval.ok, false, "burst milestones violate minIntervalMs");
assert.equal(minInterval.checks[0].kind, "minIntervalMs");
assert.equal(minInterval.checks[0].observed, 0);

const maxWindow = evaluateMilestoneFrequency(
  {
    type: "milestone",
    id: "brick-destroyed",
    timeoutMs: 1000,
    minOccurrences: 1,
    maxOccurrencesInWindow: 2,
    windowMs: 10,
  },
  burstMilestones,
);
assert.equal(maxWindow.ok, false, "burst milestones violate maxOccurrencesInWindow");
assert.equal(maxWindow.checks[0].kind, "maxOccurrencesInWindow");
assert.equal(maxWindow.checks[0].observed, 3);

const spacedMilestones = [
  { id: "brick-destroyed", at: 1000 },
  { id: "brick-destroyed", at: 1030 },
  { id: "brick-destroyed", at: 1065 },
];
const spaced = evaluateMilestoneFrequency(
  {
    type: "milestone",
    id: "brick-destroyed",
    timeoutMs: 1000,
    minOccurrences: 1,
    minIntervalMs: 16,
    maxOccurrencesInWindow: 2,
    windowMs: 20,
  },
  spacedMilestones,
);
assert.equal(spaced.ok, true, "spaced milestones satisfy both frequency gates");

console.log("OK delivery_runner_frequency_smoke");
