#!/usr/bin/env node
import assert from "node:assert/strict";
import { evaluateStage5VisualGate } from "../scripts/_stage_5_worker.js";

function delivery(visual) {
  return { qualityHints: { visual: { available: true, ...visual } } };
}

const pass = evaluateStage5VisualGate({
  text: "HUD 信息强化",
  targetedWarnings: ["hud-empty"],
  beforeDelivery: delivery({ hudOccupancy: 0.02, colorCount: 4, shapeRegions: 7, centerActivity: 0.1 }),
  afterDelivery: delivery({ hudOccupancy: 0.03, colorCount: 4, shapeRegions: 7, centerActivity: 0.1 }),
});
assert.equal(pass.ok, true);
assert.deepEqual(pass.checked.map((item) => item.metric), ["hudOccupancy"]);

const colorRegression = evaluateStage5VisualGate({
  text: "色彩层次强化",
  targetedWarnings: ["colorCount-low"],
  beforeDelivery: delivery({ hudOccupancy: 0.02, colorCount: 4, shapeRegions: 7, centerActivity: 0.1 }),
  afterDelivery: delivery({ hudOccupancy: 0.02, colorCount: 3, shapeRegions: 7, centerActivity: 0.1 }),
});
assert.equal(colorRegression.ok, false);
assert.match(colorRegression.reason, /colorCount/u);

const centerRegression = evaluateStage5VisualGate({
  text: "中心动态反馈强化",
  targetedWarnings: ["center-static"],
  beforeDelivery: delivery({ hudOccupancy: 0.02, colorCount: 4, shapeRegions: 7, centerActivity: 0.11 }),
  afterDelivery: delivery({ hudOccupancy: 0.02, colorCount: 4, shapeRegions: 7, centerActivity: 0.1 }),
});
assert.equal(centerRegression.ok, false);
assert.match(centerRegression.reason, /centerActivity/u);

const missingMetrics = evaluateStage5VisualGate({
  text: "HUD 信息强化",
  targetedWarnings: ["hud-empty"],
  beforeDelivery: { qualityHints: { visual: { available: false } } },
  afterDelivery: delivery({ hudOccupancy: 0.03 }),
});
assert.equal(missingMetrics.ok, false);
assert.match(missingMetrics.reason, /unavailable/u);

console.log("OK evolution_stage5_gate_smoke");
