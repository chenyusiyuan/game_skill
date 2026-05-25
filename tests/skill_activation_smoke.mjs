#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const forbiddenTokens = ["N" + "10", "N" + "14", "N" + "16", "N" + "17", "N" + "18"];
const forbiddenVersionText = new RegExp(forbiddenTokens.join("|"), "u");

const skill = fs.readFileSync("SKILL.md", "utf8");
assert.match(skill, /^# mini-game Skill$/m, "SKILL.md must use the current unversioned title");
assert.match(skill, /specs\/plan\.json/, "Phase A must reference plan.json");
assert.match(skill, /schemas\/plan\.schema\.json/, "Phase A must reference plan.schema.json");
assert.match(skill, /node scripts\/validate_plan\.js/, "Phase A must document validate_plan.js");
assert.match(skill, /node scripts\/check_delivery\.js/, "Phase C must document check_delivery.js");
assert.match(skill, /eval\/delivery\.json/, "Phase C must document delivery.json");
assert.match(skill, /implementationPlan\[\]/, "Phase A must document implementationPlan");
assert.match(skill, /acceptance\.mustHave\[\]/, "Phase A must document acceptance.mustHave");
assert.match(skill, /requiredMechanics\[\]\.name/, "acceptance rules must bind back to requiredMechanics");
assert.match(skill, /first-cut evidence pass/, "delivery-pass must be scoped to first-cut evidence");
assert.match(skill, /eval\/screenshots\/final\.png/, "Phase C must document screenshot evidence");
assert.match(skill, /unexpected-milestone/, "structured warning kinds must be documented");
assert.match(skill, /top_down.*确定性短路径/u, "Phase A must keep realtime/top_down smoke deterministic");
assert.match(skill, /最多运行 3 次 `check_delivery`/u, "Phase C must document check_delivery attempt budget");
assert.match(skill, /不是 repair loop/u, "Phase C must forbid repair-loop behavior");
assert.match(skill, /Liveness 规则/u, "Phase B must document the liveness rule");
assert.match(skill, /update\(_time: number, delta: number\)/u, "Phase B must show a delta-based update example");
assert.match(skill, /纯回合制游戏可豁免/u, "liveness guidance must avoid turn-based false positives");
assert.match(skill, /static-between-inputs/u, "liveness warning kind must be documented");
assert.match(skill, /idle-frozen/u, "idle liveness warning kind must be documented");
assert.match(skill, /auto-cleaned-junk/u, "junk cleanup warning kind must be documented");
assert.match(skill, /视觉表现建议（非门禁，参考用）/u, "visual guidance must be isolated as non-gating");
assert.match(skill, /不影响 delivery 判定/u, "visual guidance must stay non-gating");
assert.match(skill, /emitMilestone/, "Phase B must document emitMilestone");
assert.match(skill, /window\.__state/, "Phase B must document window.__state");
assert.match(skill, /import Phaser from "phaser"/, "Phase B must document explicit Phaser import");
assert.match(skill, /KEEP scaffold.*check_delivery/u, "Phase B must explain KEEP scaffold is synced by check_delivery");
assert.match(skill, /chain-blocked/, "4-state table must include chain-blocked");
assert.match(skill, /templates\/\*\*/, "forbidden read list must include templates/**");
assert.match(skill, /known-issues\.md/, "Phase B must reference known-issues.md");
assert.match(skill, /禁止读 sibling case|不要从中复制 sibling case/, "Phase B must explicitly forbid sibling case source use");
assert.doesNotMatch(skill, forbiddenVersionText, "SKILL.md must not contain version-prefix wording");

const agents = fs.readFileSync("AGENTS.md", "utf8");
assert.match(agents, /Step 0 -> Phase A -> Phase B -> Phase C/, "AGENTS.md must point to the current phase flow");
assert.match(agents, /SKILL\.md/, "AGENTS.md must point to SKILL.md");
assert.match(agents, /known-issues\.md/, "AGENTS.md must mention known issues");
assert.doesNotMatch(agents, forbiddenVersionText, "AGENTS.md must not contain version-prefix wording");

const readme = fs.readFileSync("README.md", "utf8");
assert.match(readme, /node scripts\/check_delivery\.js/, "README.md must document current delivery");
assert.match(readme, /npm test/, "README.md must document npm test");
assert.doesNotMatch(readme, forbiddenVersionText, "README.md must not contain version-prefix wording");

assert.equal(fs.existsSync(`SKILL.n${"17"}-archive.md`), false, "archive skill files must not remain");
assert.equal(fs.existsSync(`SKILL.n${"16"}-archive.md`), false, "archive skill files must not remain");

const knownIssues = fs.readFileSync("docs/known-issues.md", "utf8");
for (const heading of ["症状", "原因", "推荐修法", "备选修法", "禁止项"]) {
  assert.match(knownIssues, new RegExp(`### ${heading}`, "u"), `known issue entry must include ${heading}`);
}
assert.match(knownIssues, /Phaser is not defined/, "known issues must cover missing Phaser import");
assert.match(knownIssues, /Cannot find namespace 'Phaser'/, "known issues must cover missing Phaser types");
assert.match(knownIssues, /milestonesAny > 0/, "known issues must cover missing milestone diagnostics");
assert.match(knownIssues, /physics body \/ overlap/, "known issues must mention physics overlap checks");
assert.match(knownIssues, /实时导航 Smoke 过长/u, "known issues must cover long realtime navigation smoke");
assert.match(knownIssues, /Phaser\.Scale\.FIT/u, "known issues must explain playable canvas scaling");
assert.doesNotMatch(knownIssues, /尺寸应与 `plan\.smoke\.viewport` 对齐/u, "known issues must not conflate smoke viewport with game canvas size");
assert.doesNotMatch(knownIssues, /cases\/[a-z0-9_-]+\//u, "known issues must not point to sibling case paths");

console.log("OK skill_activation_smoke");
