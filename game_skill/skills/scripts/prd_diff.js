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
 *      给出 code-bug / design-change / art-change 的建议分流（基于关键字启发式）。
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
  const signals = { codeBug: [], designChange: [], artChange: [] };

  const codeBugPatterns = [
    /崩|闪退|白屏|报错|console.*error|undefined|null|exception/i,
    /不能点|无响应|卡住|卡死|冻住|stuck|frozen/i,
    /没反应|点了没用|no response|does ?n.t work/i,
    /打不开|load.*fail|404|加载失败/i,
    /按钮.*(?:没|无).*用|缺.*按钮/i,
  ];
  const designChangePatterns = [
    /太难|太简单|节奏|平衡|balance|玩法|不好玩|too hard|too easy/i,
    /想.*(?:改|换).*(?:玩法|规则|机制)|能不能.*(?:加|改)(?:个|一个)/i,
    /应该.*(?:变|换|改成)|change.*(?:rule|mechanic)/i,
    /关卡|关数|level.*(?:count|number)|loops?|几关/i,
    /胜利条件|失败条件|win.*condition|lose.*condition/i,
    /\d+\s*(?:秒|分钟|min|sec).*(?:太短|太长|too)/i,
  ];
  const artChangePatterns = [
    /风格|配色|颜色|字体|调色|color|palette|font|style/i,
    /图|素材|贴图|icon|sprite|art|图标/i,
    /换.*(?:一套|个)?(?:素材|图|贴图)|replace.*art/i,
    /太丑|不好看|丑|美化|polish.*visual|looks? (ugly|bad)/i,
    /动画|特效|animation|effect/i,  // 特效也算 art 层
  ];

  for (const re of codeBugPatterns) if (re.test(lc)) signals.codeBug.push(re.source);
  for (const re of designChangePatterns) if (re.test(lc)) signals.designChange.push(re.source);
  for (const re of artChangePatterns) if (re.test(lc)) signals.artChange.push(re.source);

  const scores = {
    "code-bug": signals.codeBug.length,
    "design-change": signals.designChange.length,
    "art-change": signals.artChange.length,
  };
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const category = top[1] === 0 ? "ambiguous" : top[0];
  const total = scores["code-bug"] + scores["design-change"] + scores["art-change"];
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
      return "走 Phase 5 验证修复循环：定位并修 game/src/，不改 PRD/specs";
    case "design-change":
      return "回流 Phase 2：修改 docs/game-prd.md（或创建 game-prd.v2.md），重跑 Phase 3 expand + Phase 4 codegen + Phase 5 verify";
    case "art-change":
      return "只重跑 Phase 3 的 assets 维度 + Phase 4 的素材绑定段（generate_registry.js）+ Phase 5 的 compliance/playthrough；逻辑代码尽量保留";
    default:
      return "反馈信号不明确，建议用 AskUserQuestion 问用户：是『代码 bug』、『想改玩法/数值』还是『想换视觉』？";
  }
}
