#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const forbiddenTokens = ["N" + "10", "N" + "14", "N" + "16", "N" + "17", "N" + "18"];
const forbiddenVersionText = new RegExp(forbiddenTokens.join("|"), "u");

const skill = fs.readFileSync("SKILL.md", "utf8");
assert.match(skill, /^# mini-game Skill$/m, "SKILL.md must use the current unversioned title");
assert.match(skill, /space-shooter-glm-1/u, "SKILL.md must document the current slug naming policy");
assert.match(skill, /glm.*kimi.*opus.*gpt/u, "SKILL.md must list the slug model aliases");
assert.match(skill, /specs\/plan\.json/, "Phase A must reference plan.json");
assert.match(skill, /docs\/DESIGN\.md[\s\S]*docs\/decisions\.md[\s\S]*specs\/plan\.json/u, "Phase A must allow DESIGN, decisions, and plan artifacts");
assert.doesNotMatch(skill, /只产 `cases\/<PROJECT>\/specs\/plan\.json`/u, "Phase A must not claim plan.json is the only output");
assert.match(skill, /schemas\/plan\.schema\.json/, "Phase A must reference plan.schema.json");
assert.match(skill, /node scripts\/validate_plan\.js/, "Phase A must document validate_plan.js");
assert.match(skill, /node scripts\/check_delivery\.js/, "Phase C must document check_delivery.js");
assert.match(skill, /node scripts\/check_preview\.js/, "Phase C must document check_preview.js");
assert.match(skill, /node scripts\/write_handoff\.js/, "Phase C must document write_handoff.js");
assert.match(skill, /node scripts\/start_preview\.js/, "Phase C must document start_preview.js");
assert.match(skill, /eval\/delivery\.json/, "Phase C must document delivery.json");
assert.match(skill, /eval\/preview\.json/, "Phase C must document preview.json");
assert.match(skill, /eval\/handoff\.json/, "Phase C must document handoff.json");
assert.match(skill, /implementationPlan\[\]/, "Phase A must document implementationPlan");
assert.match(skill, /acceptance\.mustHave\[\]/, "Phase A must document acceptance.mustHave");
assert.match(skill, /requiredMechanics\[\]\.name/, "acceptance rules must bind back to requiredMechanics");
assert.match(skill, /first-cut evidence pass/, "delivery-pass must be scoped to first-cut evidence");
assert.match(skill, /preview health/u, "Stage 1 must separate preview health from delivery evidence");
assert.match(skill, /可试玩/u, "Stage 1 must allow playable preview handoff");
assert.match(skill, /如果遇到 bug、想增加需求、修改现有机制、调整手感\/数值、素材\/颜色\/布局\/UI，都可以继续说/u, "handoff prompt must invite follow-up iteration");
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
assert.match(skill, /OpenGame 五交互原型/u, "SKILL.md must use OpenGame interaction prototypes");
assert.match(skill, /platformer[\s\S]*top_down[\s\S]*grid_logic[\s\S]*tower_defense[\s\S]*ui_heavy/u, "SKILL.md must list the five OpenGame prototypes");
assert.match(skill, /不要新增 `breakout`、`shooter`、`survivor`/u, "SKILL.md must forbid genre-enumeration primers");
assert.match(skill, /load_primer\.js cases\/<id> --clear/u, "SKILL.md must document clearing a mis-selected primer");
assert.match(skill, /暂停界面/u, "SKILL.md must require a default pause overlay");
assert.match(skill, /Escape.*P.*暂停/u, "pause guidance must name Escape or P");
assert.match(skill, /标准.*960×720/u, "SKILL.md must define a desktop-default canvas size");
assert.match(skill, /1280×720/u, "SKILL.md must allow widescreen desktop games");
assert.match(skill, /不要用 640×480 或 480×360 作为最终交付画布/u, "SKILL.md must not default to legacy low-resolution delivery canvas");
assert.match(skill, /pixelArt: true/u, "SKILL.md must document crisp pixel rendering");
assert.match(skill, /白球对白底/u, "SKILL.md must forbid low-contrast white-on-white core objects");
assert.match(skill, /多关卡.*布局/u, "SKILL.md must require visible multi-level progression");
assert.match(skill, /特效要克制/u, "SKILL.md must require restrained semantic effects");
assert.match(skill, /高频.*局部粒子/u, "SKILL.md must steer high-frequency feedback to local effects");
assert.match(skill, /震动只用于受击\/丢命、combo 阈值、奖励\/道具/u, "SKILL.md must reserve camera shake for high-salience events");
assert.match(skill, /随机事件.*整关通关/u, "SKILL.md must forbid stochastic or whole-level hard smoke");
assert.match(skill, /lib\/HELPERS\.md/u, "SKILL.md must document the scaffold helper index");
assert.match(skill, /不要默认通读全部 helper/u, "SKILL.md must keep helper reads selective");
assert.match(skill, />= 0.*level >= 1/u, "SKILL.md must forbid tautological state evidence");
assert.doesNotMatch(skill, forbiddenVersionText, "SKILL.md must not contain version-prefix wording");

const agents = fs.readFileSync("AGENTS.md", "utf8");
assert.match(agents, /Step 0 -> Phase A -> Phase B -> Phase C/, "AGENTS.md must point to the current phase flow");
assert.match(agents, /SKILL\.md/, "AGENTS.md must point to SKILL.md");
assert.match(agents, /known-issues\.md/, "AGENTS.md must mention known issues");
assert.doesNotMatch(agents, forbiddenVersionText, "AGENTS.md must not contain version-prefix wording");

const readme = fs.readFileSync("README.md", "utf8");
assert.match(readme, /space-shooter-glm-1/u, "README.md must document the current slug naming policy");
assert.match(readme, /node scripts\/check_delivery\.js/, "README.md must document current delivery");
assert.match(readme, /node scripts\/check_preview\.js/, "README.md must document preview health");
assert.match(readme, /node scripts\/write_handoff\.js/, "README.md must document handoff");
assert.match(readme, /node scripts\/start_preview\.js/, "README.md must document preview startup");
assert.match(readme, /templates\/design-template\.md/, "README.md must document v1.1 design template");
assert.match(readme, /qualityHints/, "README.md must document qualityHints");
assert.match(readme, /标准 canvas 为 960×720/u, "README.md must document the desktop delivery canvas default");
assert.match(readme, /platformer\|top_down\|grid_logic\|tower_defense\|ui_heavy/u, "README.md must document OpenGame prototype primer names");
assert.match(readme, /load_primer\.js cases\/<slug> --clear/u, "README.md must document clearing a mis-selected primer");
assert.match(readme, /game\/src\/lib\/HELPERS\.md/u, "README.md must document the helper index");
assert.match(readme, /npm test/, "README.md must document npm test");
assert.doesNotMatch(readme, forbiddenVersionText, "README.md must not contain version-prefix wording");

const helperIndex = fs.readFileSync("templates/scaffold/src/lib/HELPERS.md", "utf8");
for (const helperName of [
  "arcadePhysics.ts",
  "visualTheme.ts",
  "procSprite.ts",
  "inputController.ts",
  "inputExtras.ts",
  "hudBuilder.ts",
  "progressionMath.ts",
  "cameraRig.ts",
  "safeTimers.ts",
  "objectPool.ts",
  "audioSafe.ts",
  "uiButton.ts",
]) {
  assert.match(helperIndex, new RegExp(helperName.replace(".", "\\."), "u"), `helper index must mention ${helperName}`);
}
assert.match(helperIndex, /Do not read[\s\S]*every helper body/u, "helper index must discourage reading every helper body");

const designTemplate = fs.readFileSync("templates/design-template.md", "utf8");
assert.match(designTemplate, /标准画布为 960×720/u, "design template must encode the desktop canvas default");
assert.match(designTemplate, /暂停表面/u, "design template must make pause a generic secondary surface");
assert.match(designTemplate, /多关卡、多波次、多阶段/u, "design template must require generic progression variety");
assert.match(designTemplate, /强对比/u, "design template must require readable contrast");
assert.match(designTemplate, /camera shake 只用于受击\/丢命、combo 阈值、奖励\/道具/u, "design template must reserve camera shake for high-salience events");

const decisionsTemplate = fs.readFileSync("templates/decisions-template.md", "utf8");
assert.match(decisionsTemplate, /OpenGame 交互原型识别/u, "decisions template must use OpenGame prototype language");
assert.match(decisionsTemplate, /桌面画布与布局取舍/u, "decisions template must require a canvas/layout decision");
assert.match(decisionsTemplate, /暂停与继续体验/u, "decisions template must require a pause handoff decision");

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
assert.match(knownIssues, /960×720/u, "known issues must recommend the desktop delivery canvas default");
assert.match(knownIssues, /pixelArt: true/u, "known issues must preserve crisp canvas guidance");
assert.doesNotMatch(knownIssues, /尺寸应与 `plan\.smoke\.viewport` 对齐/u, "known issues must not conflate smoke viewport with game canvas size");
assert.doesNotMatch(knownIssues, /推荐使用 640×480/u, "known issues must not recommend legacy low-resolution canvas defaults");
assert.doesNotMatch(knownIssues, /cases\/[a-z0-9_-]+\//u, "known issues must not point to sibling case paths");

const expectedPrimerFiles = ["grid_logic.md", "platformer.md", "top_down.md", "tower_defense.md", "ui_heavy.md"];
assert.deepEqual(
  fs.readdirSync("templates/archetype-primers").filter((name) => name.endsWith(".md")).sort(),
  expectedPrimerFiles,
  "archetype primers must be exactly the five OpenGame interaction prototypes",
);

const loadPrimer = fs.readFileSync("scripts/load_primer.js", "utf8");
assert.match(loadPrimer, /platformer", "top_down", "grid_logic", "tower_defense", "ui_heavy"/u, "load_primer must only expose the five OpenGame prototypes");
assert.match(loadPrimer, /--clear/u, "load_primer must support clearing a mis-selected primer");
assert.match(loadPrimer, /rmSync/u, "load_primer must remove the case primer when clearing");

for (const primerPath of expectedPrimerFiles.map((name) => `templates/archetype-primers/${name}`)) {
  const primer = fs.readFileSync(primerPath, "utf8");
  assert.match(primer, /OpenGame 五原型之一/u, `${primerPath} must identify the OpenGame prototype`);
  assert.match(primer, /960×720/u, `${primerPath} must preserve the desktop canvas default`);
  assert.match(primer, /Smoke 建议/u, `${primerPath} must include smoke guidance`);
  assert.match(primer, /暂停/u, `${primerPath} must preserve pause guidance`);
  assert.doesNotMatch(primer, /推荐.*640x480|推荐.*640×480|画布建议.*640x480|画布建议.*640×480/u, `${primerPath} must not recommend legacy low-resolution canvas defaults`);
}

console.log("OK skill_activation_smoke");
