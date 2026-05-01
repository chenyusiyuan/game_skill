#!/usr/bin/env node
/**
 * prd_diff.js — PRD 版本快照 + 用户反馈分类辅助工具
 *
 * 职责：
 *   1. `--snapshot <case-dir>`  给当前 PRD + assets.yaml 计算 SHA1，写到
 *      .game/state.json 的 `prdSnapshot / assetsSnapshot` 字段。
 *      交付完成（verify 通过）时调用一次，作为后续 diff 的基线。
 *
 *   2. `--diff <case-dir>`      比较当前 PRD/assets 和基线 hash，输出分类
 *      建议：没变化 / 只改 PRD / 只改 assets / 都改了。
 *
 *   3. `--classify <case-dir> <feedback-file>`  读用户反馈文本 + 当前快照，
 *      给出 7+1 类建议分流（基于关键字启发式）。
 *
 * 退出码: 0 = OK, 1 = case-dir 不存在, 2 = 参数错
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { createHash } from "crypto";
import { readState, writeState } from "./_state.js";

const args = process.argv.slice(2);
const mode = args.find(a => a.startsWith("--")) ?? "--help";

if (mode === "--help" || !mode) {
  console.log(`用法:
  node prd_diff.js --snapshot <case-dir>
  node prd_diff.js --diff <case-dir>
  node prd_diff.js --classify <case-dir> <feedback-file>`);
  process.exit(mode ? 0 : 2);
}

const idx = args.indexOf(mode);
const caseDir = resolve(args[idx + 1] ?? ".");
if (!existsSync(caseDir)) {
  console.error(`✗ case-dir 不存在: ${caseDir}`);
  process.exit(1);
}

const prdPath = join(caseDir, "docs/game-prd.md");
const assetsPath = join(caseDir, "specs/assets.yaml");
const statePath = join(caseDir, ".game/state.json");

function hashFile(p) {
  if (!existsSync(p)) return null;
  return createHash("sha1").update(readFileSync(p)).digest("hex");
}

// ---------------------------------------------------------------------------

if (mode === "--snapshot") {
  const st = readState(statePath);
  if (!st) {
    console.error("✗ state.json 不存在，先跑 initState");
    process.exit(1);
  }
  const prdHash = hashFile(prdPath);
  const assetsHash = hashFile(assetsPath);
  const next = {
    ...st,
    prdSnapshot: prdHash,
    assetsSnapshot: assetsHash,
    snapshotAt: new Date().toISOString(),
  };
  writeState(statePath, next);
  console.log(`✓ snapshot 写入 state.json`);
  console.log(`  prdSnapshot:    ${prdHash?.slice(0, 12)}...`);
  console.log(`  assetsSnapshot: ${assetsHash?.slice(0, 12) ?? "<none>"}...`);
  process.exit(0);
}

if (mode === "--diff") {
  const st = readState(statePath);
  if (!st || !st.prdSnapshot) {
    console.error("✗ 未发现快照基线，先跑 --snapshot");
    process.exit(1);
  }
  const curPrd = hashFile(prdPath);
  const curAssets = hashFile(assetsPath);
  const prdChanged = curPrd !== st.prdSnapshot;
  const assetsChanged = curAssets !== st.assetsSnapshot;

  const result = {
    prdChanged, assetsChanged,
    prdHash: { old: st.prdSnapshot?.slice(0, 12), new: curPrd?.slice(0, 12) },
    assetsHash: { old: st.assetsSnapshot?.slice(0, 12), new: curAssets?.slice(0, 12) },
    recommendation:
      !prdChanged && !assetsChanged ? "code-only" :
      !prdChanged && assetsChanged ? "art-only" :
      prdChanged && !assetsChanged ? "design-only" :
      "mixed",
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (mode === "--classify") {
  const feedbackPath = resolve(args[idx + 2] ?? "");
  if (!feedbackPath || !existsSync(feedbackPath)) {
    console.error("✗ feedback-file 不存在");
    process.exit(2);
  }
  const feedback = readFileSync(feedbackPath, "utf-8");
  console.log(JSON.stringify(classifyFeedback(feedback), null, 2));
  process.exit(0);
}

console.error(`未知模式: ${mode}`);
process.exit(2);

// ---------------------------------------------------------------------------

/**
 * 启发式分类器。只给建议，最终仍由主 agent 判断。
 * 返回 { category, confidence, signals, recommended_action }
 */
function classifyFeedback(text) {
  const lc = text.toLowerCase();
  const signals = {
    "code-bug": [],
    tuning: [],
    "art-change": [],
    "scope-change": [],
    rework: [],
    extension: [],
    pivot: [],
  };

  const codeBugPatterns = [
    /崩|闪退|白屏|报错|console.*error|undefined|null|exception/i,
    /不能点|无响应|卡住|卡死|冻住|stuck|frozen/i,
    /没反应|点了没用|no response|does ?n.t work/i,
    /打不开|load.*fail|404|加载失败/i,
    /按钮.*(?:没|无).*用|缺.*按钮/i,
  ];
  const tuningPatterns = [
    /太难|太简单|too hard|too easy|难度|平衡|balance/i,
    /血量|时间|分数|速度|频率|伤害|冷却|cd|金币|生命|hp|score|timer?/i,
    /改(?:一下)?(?:数值|难度|时间|分数)|调(?:低|高|整|一下)|微调/i,
    /删(?:掉)?(?:一条|这个|那个|单条)|少一点|多一点/i,
  ];
  const artChangePatterns = [
    /风格|配色|颜色|字体|调色|color|palette|font|style/i,
    /图|素材|贴图|音效|icon|sprite|art|图标|sound|audio/i,
    /换.*(?:一套|个)?(?:素材|图|贴图)|replace.*art/i,
    /太丑|不好看|丑|美化|polish.*visual|looks? (ugly|bad)/i,
    /动画|特效|animation|effect/i,
  ];
  const scopeChangePatterns = [
    /\d+\s*关.*(?:改|变|到|成)\s*\d+\s*关|关数|几关|level.*(?:count|number)/i,
    /加(?:一个)?关卡选择|关卡选择|level select/i,
    /本(?:阶段|stage).*范围|scope/i,
    /把.*(?:扩到|增加到|减少到).*关/i,
  ];
  const reworkPatterns = [
    /撤销|回滚|退回|回到\s*stage\s*\d+|回到第?\s*\d+\s*阶段/i,
    /去掉\s*stage\s*\d+|删掉\s*stage\s*\d+|不要.*(?:boss|道具|升级|系统)/i,
    /恢复到|还原|reverse patch|rework/i,
  ];
  const extensionPatterns = [
    /排行榜|分享|成就|多人|联机|账号|存档|商店|任务|皮肤|leaderboard|share|achievement|multiplayer/i,
    /加(?:一个)?(?:新功能|新特性|系统)|新增(?:功能|系统|玩法外)/i,
  ];
  const pivotPatterns = [
    /换成.*玩法|改成.*玩法|玩法.*换成|这不是我要的游戏/i,
    /核心玩法|胜利条件|失败条件|win.*condition|lose.*condition/i,
    /完全(?:换|改)|重新做|重做|restart|pivot/i,
  ];

  for (const re of codeBugPatterns) if (re.test(lc)) signals["code-bug"].push(re.source);
  for (const re of tuningPatterns) if (re.test(lc)) signals.tuning.push(re.source);
  for (const re of artChangePatterns) if (re.test(lc)) signals["art-change"].push(re.source);
  for (const re of scopeChangePatterns) if (re.test(lc)) signals["scope-change"].push(re.source);
  for (const re of reworkPatterns) if (re.test(lc)) signals.rework.push(re.source);
  for (const re of extensionPatterns) if (re.test(lc)) signals.extension.push(re.source);
  for (const re of pivotPatterns) if (re.test(lc)) signals.pivot.push(re.source);

  const scores = {
    "code-bug": signals["code-bug"].length,
    tuning: signals.tuning.length,
    "art-change": signals["art-change"].length,
    "scope-change": signals["scope-change"].length,
    rework: signals.rework.length,
    extension: signals.extension.length,
    pivot: signals.pivot.length,
  };
  const priority = ["pivot", "rework", "extension", "scope-change", "code-bug", "art-change", "tuning"];
  const top = Object.entries(scores).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return priority.indexOf(a[0]) - priority.indexOf(b[0]);
  })[0];
  const category = top[1] === 0 ? "ambiguous" : top[0];
  const total = Object.values(scores).reduce((sum, n) => sum + n, 0);
  const confidence = total === 0 ? 0 : (top[1] / total);

  return {
    category,
    confidence: Number(confidence.toFixed(2)),
    scores,
    signals,
    recommended_action: recommendedAction(category),
  };
}

function recommendedAction(category) {
  switch (category) {
    case "code-bug":
      return "run verify_all; fix in current stage";
    case "tuning":
      return "edit data.yaml only; run current stage verify";
    case "art-change":
      return "edit color-scheme + assets.yaml + juice-plan; run assets stage";
    case "scope-change":
      return "regenerate stage-contract-N; rerun phase 3-5 of current stage";
    case "rework":
      return "generate reverse patch on target stage; replay subsequent stages";
    case "extension":
      return "create extension-contract-N; apply patch after delivery";
    case "pivot":
      return "archive game.v{N}/ specs.v{N}/ preserve.v{N}.lock.yaml; rewrite PRD + design-strategy; restart Stage 1";
    default:
      return "AskUserQuestion with all 7 options + Other";
  }
}
