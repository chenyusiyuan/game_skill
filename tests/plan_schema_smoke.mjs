#!/usr/bin/env node
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { validatePlan } from "../scripts/validate_plan.js";

const repoRoot = process.cwd();
const schema = JSON.parse(readFileSync(join(repoRoot, "schemas/plan.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function readFixture(name) {
  return JSON.parse(readFileSync(join(repoRoot, "tests/fixtures", name), "utf8"));
}

function hasDiagnostic(items, pattern) {
  return items.some((item) => pattern.test(typeof item === "string" ? item : item.message));
}

assert.equal(validate(readFixture("plan.valid.json")), true, `valid plan should pass: ${JSON.stringify(validate.errors)}`);

const planMissingAcceptance = structuredClone(readFixture("plan.valid.json"));
delete planMissingAcceptance.acceptance;
assert.equal(validate(planMissingAcceptance), false, "plan missing acceptance should fail");
assert(
  validate.errors.some((error) => error.instancePath === "" && error.params?.missingProperty === "acceptance"),
  "missing acceptance error reported",
);

const planWithoutImplementationPlan = readFixture("plan.valid.json");
delete planWithoutImplementationPlan.implementationPlan;
assert.equal(validate(planWithoutImplementationPlan), true, "implementationPlan remains optional");

const planWithImplementationPlan = planWithoutImplementationPlan;
planWithImplementationPlan.implementationPlan = [
  { file: "game/src/scenes/PlayScene.ts", action: "create", purpose: "玩家移动 + 跳跃 + 钥匙拾取" },
];
assert.equal(validate(planWithImplementationPlan), true, `implementationPlan should pass: ${JSON.stringify(validate.errors)}`);

const missingPurpose = structuredClone(planWithImplementationPlan);
delete missingPurpose.implementationPlan[0].purpose;
assert.equal(validate(missingPurpose), false, "implementationPlan item missing purpose should fail");

const badAction = structuredClone(planWithImplementationPlan);
badAction.implementationPlan[0].action = "rename";
assert.equal(validate(badAction), false, "implementationPlan action outside enum should fail");

const frequencyExpectPlan = structuredClone(readFixture("plan.valid.json"));
frequencyExpectPlan.smoke.expect[1].minIntervalMs = 16;
frequencyExpectPlan.smoke.expect[1].maxOccurrencesInWindow = 3;
frequencyExpectPlan.smoke.expect[1].windowMs = 100;
assert.equal(validate(frequencyExpectPlan), true, `milestone frequency fields should pass schema: ${JSON.stringify(validate.errors)}`);

const missingWindowPlan = structuredClone(readFixture("plan.valid.json"));
missingWindowPlan.smoke.expect[1].maxOccurrencesInWindow = 3;
assert.equal(validate(missingWindowPlan), false, "maxOccurrencesInWindow requires windowMs");

assert.equal(validate(readFixture("plan.missing-steps.json")), false, "plan missing smoke.steps should fail");
assert(validate.errors.some((error) => error.instancePath === "/smoke" && error.params?.missingProperty === "steps"), "missing steps error reported");

assert.equal(validate(readFixture("plan.missing-expect.json")), false, "plan missing smoke.expect should fail");
assert(validate.errors.some((error) => error.instancePath === "/smoke" && error.params?.missingProperty === "expect"), "missing expect error reported");

const tempRoot = mkdtempSync(join(tmpdir(), "plan-schema-"));
try {
  const validCaseDir = join(tempRoot, "case-valid");
  mkdirSync(join(validCaseDir, "specs"), { recursive: true });
  copyFileSync(join(repoRoot, "tests/fixtures/plan.valid.json"), join(validCaseDir, "specs/plan.json"));
  const validResult = validatePlan(validCaseDir);
  assert.equal(validResult.ok, true, "valid plan result exposes ok=true");
  assert.equal(validResult.status, "pass", "valid plan still exposes status=pass");
  assert.deepEqual(validResult.warnings, [], "valid plan has no smoke safety warnings");

  const enumStatePlan = structuredClone(readFixture("plan.valid.json"));
  enumStatePlan.smoke.expect.push({ type: "state", path: "gameState", operator: "==", value: "playing" });
  const enumStateCase = join(tempRoot, "case-enum-state-warning");
  mkdirSync(join(enumStateCase, "specs"), { recursive: true });
  writeFileSync(join(enumStateCase, "specs/plan.json"), `${JSON.stringify(enumStatePlan, null, 2)}\n`, "utf8");
  const enumStateResult = validatePlan(enumStateCase);
  assert.equal(enumStateResult.ok, true, "enum-like smoke state warnings are non-fatal");
  assert.equal(enumStateResult.status, "pass", "enum-like smoke state warnings do not fail the plan");
  assert(hasDiagnostic(enumStateResult.warnings, /gameState/u), "enum-like state warning is reported");
  const enumStateCheck = JSON.parse(readFileSync(join(enumStateCase, "eval/plan-check.json"), "utf8"));
  assert(hasDiagnostic(enumStateCheck.warnings, /gameState/u), "plan-check.json includes warnings");

  const uncoveredMechanic = structuredClone(readFixture("plan.valid.json"));
  uncoveredMechanic.acceptance.mustHave[0].mechanicRefs = ["horizontal-movement"];
  const uncoveredCase = join(tempRoot, "case-uncovered-mechanic");
  mkdirSync(join(uncoveredCase, "specs"), { recursive: true });
  writeFileSync(join(uncoveredCase, "specs/plan.json"), `${JSON.stringify(uncoveredMechanic, null, 2)}\n`, "utf8");
  const uncoveredResult = validatePlan(uncoveredCase);
  assert.equal(uncoveredResult.ok, false, "uncovered requiredMechanics should fail");
  assert(hasDiagnostic(uncoveredResult.errors, /gravity-jump/u), "uncovered mechanic is reported");

  const missingEvidence = structuredClone(readFixture("plan.valid.json"));
  missingEvidence.acceptance.mustHave[1].evidence[0].id = "missing-milestone";
  const missingEvidenceCase = join(tempRoot, "case-missing-evidence");
  mkdirSync(join(missingEvidenceCase, "specs"), { recursive: true });
  writeFileSync(join(missingEvidenceCase, "specs/plan.json"), `${JSON.stringify(missingEvidence, null, 2)}\n`, "utf8");
  const missingEvidenceResult = validatePlan(missingEvidenceCase);
  assert.equal(missingEvidenceResult.ok, false, "acceptance evidence missing from smoke.expect should fail");
  assert(hasDiagnostic(missingEvidenceResult.errors, /missing-milestone/u), "missing evidence id is reported");

  const canvasOnly = structuredClone(readFixture("plan.valid.json"));
  canvasOnly.acceptance.mustHave[1].evidence = [{ type: "canvas-change", minChangedPixels: 2000 }];
  const canvasOnlyCase = join(tempRoot, "case-canvas-only");
  mkdirSync(join(canvasOnlyCase, "specs"), { recursive: true });
  writeFileSync(join(canvasOnlyCase, "specs/plan.json"), `${JSON.stringify(canvasOnly, null, 2)}\n`, "utf8");
  const canvasOnlyResult = validatePlan(canvasOnlyCase);
  assert.equal(canvasOnlyResult.ok, false, "mustHave with only canvas-change should fail");
  assert(hasDiagnostic(canvasOnlyResult.errors, /milestone or state/u), "runtime evidence error is reported");

  const weakMilestone = structuredClone(readFixture("plan.valid.json"));
  weakMilestone.acceptance.mustHave[1].evidence[0].minOccurrences = 2;
  const weakMilestoneCase = join(tempRoot, "case-weak-milestone");
  mkdirSync(join(weakMilestoneCase, "specs"), { recursive: true });
  writeFileSync(join(weakMilestoneCase, "specs/plan.json"), `${JSON.stringify(weakMilestone, null, 2)}\n`, "utf8");
  const weakMilestoneResult = validatePlan(weakMilestoneCase);
  assert.equal(weakMilestoneResult.ok, false, "weaker smoke milestone minOccurrences should fail");
  assert(hasDiagnostic(weakMilestoneResult.errors, /minOccurrences>=2/u), "weak milestone requirement is reported");

  const weakMechanicEvidence = structuredClone(readFixture("plan.valid.json"));
  weakMechanicEvidence.requiredMechanics = [{ name: "powerup-system", summary: "奖励砖破坏后产生并拾取道具" }];
  weakMechanicEvidence.acceptance.mustHave = [
    {
      id: "powerup-system",
      text: "奖励砖破坏后掉落道具并可被拾取",
      mechanicRefs: ["powerup-system"],
      evidence: [{ type: "milestone", id: "brick-destroyed", minOccurrences: 1 }],
    },
  ];
  weakMechanicEvidence.smoke.expect = [{ type: "milestone", id: "brick-destroyed", timeoutMs: 3000, minOccurrences: 1 }];
  const weakMechanicEvidenceCase = join(tempRoot, "case-weak-mechanic-evidence");
  mkdirSync(join(weakMechanicEvidenceCase, "specs"), { recursive: true });
  writeFileSync(join(weakMechanicEvidenceCase, "specs/plan.json"), `${JSON.stringify(weakMechanicEvidence, null, 2)}\n`, "utf8");
  const weakMechanicEvidenceResult = validatePlan(weakMechanicEvidenceCase);
  assert.equal(weakMechanicEvidenceResult.ok, false, "single-mechanic weak evidence should fail");
  assert(
    hasDiagnostic(weakMechanicEvidenceResult.errors, /mechanic-specific evidence/u),
    "weak mechanic-specific evidence error is reported",
  );

  const allDiagnostics = structuredClone(readFixture("plan.valid.json"));
  delete allDiagnostics.meta.createdAt;
  allDiagnostics.requiredMechanics[0].derivedFrom = "coreLoop.missing";
  allDiagnostics.acceptance.mustHave[0].mechanicRefs = ["unknown-mechanic"];
  allDiagnostics.smoke.expect.push({ type: "state", path: "score", operator: ">=", value: 0 });
  allDiagnostics.smoke.expect.push({ type: "milestone", id: "brick-destroyed", timeoutMs: 1000 });
  const allDiagnosticsCase = join(tempRoot, "case-all-diagnostics");
  mkdirSync(join(allDiagnosticsCase, "specs"), { recursive: true });
  mkdirSync(join(allDiagnosticsCase, "docs"), { recursive: true });
  writeFileSync(
    join(allDiagnosticsCase, "docs/DESIGN.md"),
    "## visualIdentity\nvisualIdentity:\n  palette: {}\n\n## uiSurfaces\nuiSurfaces:\n  primary: {}\n\n## coreLoop\ncoreLoop:\n  primaryAction: move\n\n## mustAvoid\n- default-purple-blue-orbs\n- no clutter\n- no low contrast\n",
    "utf8",
  );
  writeFileSync(join(allDiagnosticsCase, "specs/plan.json"), `${JSON.stringify(allDiagnostics, null, 2)}\n`, "utf8");
  const allDiagnosticsResult = validatePlan(allDiagnosticsCase);
  assert.equal(allDiagnosticsResult.ok, false, "mixed schema/contract/design issues should fail");
  assert(hasDiagnostic(allDiagnosticsResult.errors, /createdAt/u), "schema error is included");
  assert(hasDiagnostic(allDiagnosticsResult.errors, /unknown-mechanic/u), "acceptance contract error is included despite schema failure");
  assert(hasDiagnostic(allDiagnosticsResult.errors, /coreLoop\.missing/u), "design anchor error is included despite schema failure");
  assert(hasDiagnostic(allDiagnosticsResult.warnings, /score/u), "weak state warning is included");
  assert(hasDiagnostic(allDiagnosticsResult.warnings, /brick-destroyed/u), "high-frequency milestone warning is included");
  assert(allDiagnosticsResult.errors.every((item) => item.skillRef), "errors include skillRef");
  assert(allDiagnosticsResult.warnings.every((item) => item.skillRef), "warnings include skillRef");

  const caseDir = join(tempRoot, "case-missing-steps");
  mkdirSync(join(caseDir, "specs"), { recursive: true });
  copyFileSync(join(repoRoot, "tests/fixtures/plan.missing-steps.json"), join(caseDir, "specs/plan.json"));

  const result = spawnSync(process.execPath, [join(repoRoot, "scripts/validate_plan.js"), caseDir], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, "invalid plan CLI exits non-zero");
  assert.match(`${result.stdout}${result.stderr}`, /\/smoke must have required property 'steps'/u);
  assert.equal(existsSync(join(caseDir, "eval/plan-check.json")), true, "CLI writes plan-check.json");

  const check = JSON.parse(readFileSync(join(caseDir, "eval/plan-check.json"), "utf8"));
  assert.equal(check.ok, false, "invalid plan check exposes ok=false");
  assert.equal(check.status, "fail");
  assert(hasDiagnostic(check.errors, /steps/u), "check output includes missing steps");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK plan_schema_smoke");
