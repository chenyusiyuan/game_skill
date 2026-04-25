#!/usr/bin/env node
/**
 * check_skill_compliance.js — skill 合规审计脚本
 *
 * 用法:
 *   node check_skill_compliance.js <case-dir>
 *   node check_skill_compliance.js <case-dir> --log <log.jsonl>
 *   node check_skill_compliance.js <case-dir> --json
 *
 * 定位：check_project.js 做"工程能不能跑"（HTML/CDN/脚本），本脚本做"spec 和
 * code 有没有脱节"——把散落在 SKILL.md / codegen.md / expand.md 的「必须 /
 * 禁止」规则整理成可机械验证的 rule list，打分。
 *
 * 退出码:
 *   0 = 合规（score ≥ 阈值）
 *   1 = 不合规（score < 阈值或有 severity=error 的条目）
 *   2 = case-dir 不合法
 *
 * 设计:
 *   - 规则分 5 组: structure / state / assets / effects / events
 *   - 每条规则返回 { id, severity, passed, detail }
 *   - severity: error（必须通过）/ warning（建议）/ info（提示）
 *   - 总分 = 100 - error_count * 20 - warning_count * 5
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";
import { readState } from "./_state.js";

const COMPLIANCE_PASS_SCORE = 70;

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const logPath = parseLogArg(process.argv);
const asJson = args.includes("--json");
const log = createLogger(logPath);

if (!existsSync(caseDir) || !statSync(caseDir).isDirectory()) {
  emit("error", `case-dir 不存在或不是目录: ${caseDir}`);
  process.exit(2);
}

const ctx = buildContext(caseDir);
const results = [
  ...checkStructure(ctx),
  ...checkState(ctx),
  ...checkAssets(ctx),
  ...checkEffects(ctx),
  ...checkEvents(ctx),
];

const errors = results.filter(r => !r.passed && r.severity === "error");
const warnings = results.filter(r => !r.passed && r.severity === "warning");
const score = Math.max(0, 100 - errors.length * 20 - warnings.length * 5);
const passed = score >= COMPLIANCE_PASS_SCORE && errors.length === 0;

if (asJson) {
  console.log(JSON.stringify({ score, passed, results }, null, 2));
} else {
  printReport(ctx, results, score, passed);
}

log.entry({
  type: "check-run",
  script: "check_skill_compliance",
  exit_code: passed ? 0 : 1,
  score,
  errors: errors.map(e => e.id),
  warnings: warnings.map(w => w.id),
});

process.exit(passed ? 0 : 1);

// ---------------------------------------------------------------------------
// 构造一次扫描的上下文（把共用的文件内容读一遍，规则函数共享）
// ---------------------------------------------------------------------------

function buildContext(caseDir) {
  const ctx = { caseDir };
  ctx.state = readSafely(() => readState(join(caseDir, ".game/state.json")));
  ctx.prd = readSafely(() => readFileSync(join(caseDir, "docs/game-prd.md"), "utf-8"));
  ctx.specs = {};
  for (const k of ["scene", "rule", "data", "assets", "event-graph", "implementation-contract"]) {
    ctx.specs[k] = readSafely(() => readFileSync(join(caseDir, `specs/${k}.yaml`), "utf-8"));
  }
  const gameDir = join(caseDir, "game");
  ctx.gameDir = gameDir;
  ctx.html = readSafely(() => readFileSync(join(gameDir, "index.html"), "utf-8"));
  ctx.sourceBlob = collectSource(gameDir);
  return ctx;
}

function collectSource(gameDir) {
  if (!existsSync(gameDir)) return "";
  const parts = [];
  walk(gameDir, (p) => {
    if (!/\.(js|mjs|html|css)$/.test(p)) return;
    try { parts.push(readFileSync(p, "utf-8")); } catch {}
  });
  return parts.join("\n\n");
}

function walk(dir, fn) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else fn(p);
  }
}

function readSafely(f) { try { return f(); } catch { return null; } }

// ---------------------------------------------------------------------------
// 规则组 1: 目录结构 & 元数据
// ---------------------------------------------------------------------------

function checkStructure(ctx) {
  const rules = [];
  const required = [
    "docs/brief.md", "docs/game-prd.md",
    "specs/scene.yaml", "specs/rule.yaml", "specs/data.yaml",
    "specs/assets.yaml", "specs/event-graph.yaml", "specs/implementation-contract.yaml",
    "game/index.html",
    ".game/state.json",
  ];
  for (const p of required) {
    rules.push(rule(`structure.exists.${p}`, "error",
      existsSync(join(ctx.caseDir, p)),
      `必须存在: ${p}`));
  }
  rules.push(rule("structure.no-orphan-pending", "warning",
    !existsSync(join(ctx.caseDir, "specs/.pending")) ||
      readdirSync(join(ctx.caseDir, "specs/.pending")).length === 0,
    "specs/.pending/ 应该是空的或不存在（事务提交完成后）"));
  rules.push(rule("structure.engine-marker", "error",
    ctx.html && /<!--\s*ENGINE:\s*\w+/i.test(ctx.html),
    'game/index.html head 必须有 "<!-- ENGINE: ... | RUN: ... -->" 注释'));
  return rules;
}

// ---------------------------------------------------------------------------
// 规则组 2: state.json
// ---------------------------------------------------------------------------

function checkState(ctx) {
  const rules = [];
  const s = ctx.state;
  const requiredSubtasks = ["scene", "rule", "data", "assets", "event-graph", "implementation-contract"];
  rules.push(rule("state.schemaVersion", "error", s?.schemaVersion === 1,
    "state.schemaVersion 必须 === 1"));
  rules.push(rule("state.project", "error", typeof s?.project === "string" && s.project.length > 0,
    "state.project 必须存在"));
  rules.push(rule("state.phases.expand.subtasks", "error",
    s?.phases?.expand?.subtasks &&
      requiredSubtasks.every(
        k => typeof s.phases.expand.subtasks[k]?.status === "string"
      ),
    "expand.subtasks 必须覆盖 scene/rule/data/assets/event-graph/implementation-contract 六项"));
  rules.push(rule("state.no-migration-flag", "warning",
    !s?._migrated,
    "state.json 仍在 legacy 兼容读模式，应重新 writeState 持久化到 v1"));
  return rules;
}

// ---------------------------------------------------------------------------
// 规则组 3: 素材绑定率（assets.yaml 的 local-file 要真的被代码引用）
// ---------------------------------------------------------------------------

function checkAssets(ctx) {
  const rules = [];
  if (!ctx.specs.assets) {
    rules.push(rule("assets.spec-readable", "error", false, "specs/assets.yaml 读取失败"));
    return rules;
  }
  const localFiles = extractLocalFileSources(ctx.specs.assets);
  const blob = ctx.sourceBlob;

  // P1-1: 共享层使用信号（registry 数据驱动）。如果代码里调了 createRegistry /
  // getTexture / getAudio，视为走了正确的绑定路径——绑定率按 id 消费算。
  const sharedRegistryUsed =
    /createRegistry\s*\(/.test(blob) &&
    /(registry\.getTexture|registry\.getAudio|registry\.getSpritesheet)\s*\(/.test(blob);

  if (localFiles.length === 0) {
    rules.push(rule("assets.has-local-file", "warning", false,
      "assets.yaml 中没有任何 type: local-file 条目——风格会退化成色块"));
    return rules;
  }
  const referenced = localFiles.filter(f => {
    const base = f.split("/").pop();
    return blob.includes(base);
  });
  // 走共享层时不强求代码里出现文件名（由 manifest 间接引用），只需 registry API 被调用
  const rate = sharedRegistryUsed ? 1.0 : referenced.length / localFiles.length;
  rules.push(rule("assets.local-file-bind-rate", "error",
    rate >= 0.5,
    sharedRegistryUsed
      ? `通过共享层 registry 间接绑定（createRegistry + getTexture 调用命中）`
      : `local-file 素材代码引用率 ${(rate * 100).toFixed(1)}% (${referenced.length}/${localFiles.length})，必须 ≥ 50%`,
    { sharedRegistry: sharedRegistryUsed, referenced: referenced.length, total: localFiles.length, missing: localFiles.filter(f => !referenced.includes(f)).slice(0, 5) }));
  rules.push(rule("assets.primitive-fallback-guard", "warning",
    // local-file 存在时，代码里 fillRect / Graphics().rect() 出现次数不应压倒加载调用
    localFiles.length === 0 || sharedRegistryUsed ||
      countOccurrences(blob, /fillRect\s*\(|\.rect\s*\([^)]*\)\.fill|Graphics\(\)[\s\S]{0,30}\.rect/g) <
        countOccurrences(blob, /load\.(image|spritesheet|audio)|Assets\.load|new\s+Image\s*\(|Texture\.from/g) * 3,
    "代码中原始绘制调用(fillRect/Graphics().rect())远多于素材加载，疑似退化为色块"));
  rules.push(...checkImplementationContractAssetLayer(ctx, localFiles));
  return rules;
}

function checkImplementationContractAssetLayer(ctx, localFiles) {
  const rules = [];
  if (!ctx.specs["implementation-contract"]) {
    rules.push(rule("contract.exists", "error", false,
      "缺少 specs/implementation-contract.yaml，Expand -> Codegen 没有增强契约层"));
    return rules;
  }
  let c;
  try {
    c = yaml.load(ctx.specs["implementation-contract"]);
  } catch (e) {
    rules.push(rule("contract.parseable", "error", false, `implementation-contract.yaml 解析失败: ${e.message}`));
    return rules;
  }
  const bindings = Array.isArray(c?.["asset-bindings"]) ? c["asset-bindings"] : [];
  const bindingIds = new Set(bindings.map(b => b.id));
  const localIds = extractLocalFileIds(ctx.specs.assets);
  const missing = localIds.filter(id => !bindingIds.has(id));
  rules.push(rule("contract.local-file-bindings", "error",
    missing.length === 0,
    missing.length === 0
      ? "所有 local-file 素材都有 implementation-contract 语义绑定"
      : `local-file 素材缺少 contract 绑定: ${missing.slice(0, 8).join(", ")}`,
    { missing }));

  const badTextSurfaces = bindings.filter(b =>
    b.type === "local-file" &&
    /card-surface|card-state-surface|panel/.test(String(b.role ?? "")) &&
    String(b["asset-kind"] ?? "") === "button"
  );
  rules.push(rule("contract.no-button-text-surface", "error",
    badTextSurfaces.length === 0,
    badTextSurfaces.length === 0
      ? "文字承载 UI 未绑定 button 贴图"
      : `文字承载 UI 绑定了 button 贴图: ${badTextSurfaces.map(b => b.id).join(", ")}`));

  const decorativeRoles = ["particle", "hud-indicator", "decorative"];
  const requiredLocal = bindings.filter(b =>
    b.type === "local-file" && b["must-render"] === true && b["allow-fallback"] !== false
    && !decorativeRoles.includes(String(b.role ?? ""))
  );
  rules.push(rule("contract.required-local-no-fallback", "error",
    requiredLocal.length === 0,
    requiredLocal.length === 0
      ? "核心 required local-file 均禁止静默 fallback（装饰素材已豁免）"
      : `核心 required local-file 必须 allow-fallback:false: ${requiredLocal.map(b => b.id).join(", ")}`));
  return rules;
}

// ---------------------------------------------------------------------------
// 规则组 4: 特效绑定率（rule.yaml.visual 动词 ↔ 代码里的特效调用）
// ---------------------------------------------------------------------------

function checkEffects(ctx) {
  const rules = [];
  if (!ctx.specs.rule) {
    rules.push(rule("effects.rule-spec-readable", "error", false, "specs/rule.yaml 读取失败"));
    return rules;
  }
  const verbs = extractVisualVerbs(ctx.specs.rule);
  if (verbs.length === 0) {
    rules.push(rule("effects.has-visual-verbs", "info", false,
      "rule.yaml 没有声明任何 visual 特效动词"));
    return rules;
  }
  const blob = ctx.sourceBlob;
  // P1-1: 如果业务代码走了共享层 fx.playEffect(verb, ...)，直接算该 verb 命中
  const sharedFxVerbs = new Set();
  for (const m of blob.matchAll(/playEffect\s*\(\s*['"]([\w-]+)['"]/g)) {
    sharedFxVerbs.add(m[1]);
  }
  // 允许两种实现形式：直接调共享层 playEffect('shake') 或引擎原生特效 API
  // 每个动词需要 ≥ 2 个证据（函数/类名），避免只出现一次变量名就算通过
  const verbToSignatures = {
    "particle-burst": [/this\.add\.particles/, /ParticleEmitter|particleEmitter|ParticleContainer/, /emitter\.\w+\s*\(/, /createParticle|spawnParticle|burstParticle/],
    "screen-shake": [/cameras\.main\.shake|camera\.shake/, /screenShake\s*\(|shake\s*\(\s*(intensity|duration|\d)/, /setShake\b/],
    "tint-flash": [/setTint\s*\(/, /ColorMatrixFilter|colorMatrix/, /tintFlash|flashTint|flashColor\s*\(/],
    "float-text": [/floatingText|floatText|float-text|damageText|FloatingText/, /this\.add\.text\([^)]*\)[\s\S]{0,200}tweens\.add/],
    "scale-bounce": [/scale.*bounce|scaleBounce/, /tweens\.add\s*\([\s\S]{0,120}scale:[\s\S]{0,120}yoyo:\s*true/],
    "pulse": [/pulse\s*\(|scaleUpDown|breathe/, /tweens\.add\s*\([\s\S]{0,120}scale:[\s\S]{0,120}repeat:\s*-?\d/],
    "fade-out": [/fadeOut\s*\(|\.fadeOut\b/, /tweens\.add\s*\([\s\S]{0,120}alpha:\s*0/, /setAlpha\s*\(\s*0\s*\)/],
  };
  const misses = [];
  for (const v of verbs) {
    // 共享层命中优先
    if (sharedFxVerbs.has(v)) continue;
    const sigs = verbToSignatures[v];
    if (!sigs) continue;
    const hits = sigs.filter(p => p.test(blob)).length;
    // 至少 1 个强信号命中
    if (hits < 1) misses.push(v);
  }
  const rate = (verbs.length - misses.length) / verbs.length;
  rules.push(rule("effects.visual-verb-bind-rate", "error",
    rate >= 0.5,
    `visual 动词代码覆盖率 ${(rate * 100).toFixed(1)}% (${verbs.length - misses.length}/${verbs.length})，必须 ≥ 50%`,
    { verbs, missed: misses }));
  return rules;
}

// ---------------------------------------------------------------------------
// 规则组 5: 事件/场景闭环（多关卡场景下的下一关、scene-transitions 完整性）
// ---------------------------------------------------------------------------

function checkEvents(ctx) {
  const rules = [];
  if (!ctx.specs.scene) {
    rules.push(rule("events.scene-spec-readable", "error", false, "specs/scene.yaml 读取失败"));
    return rules;
  }
  const transitions = extractSceneTransitions(ctx.specs.scene);
  // 每个 scene 引用的 to 必须存在
  const sceneIds = extractSceneIds(ctx.specs.scene);
  const unknownTargets = transitions.filter(t => t.to && !sceneIds.includes(t.to));
  rules.push(rule("events.transition-targets-defined", "error",
    unknownTargets.length === 0,
    unknownTargets.length === 0
      ? "所有 scene-transitions 的 to 目标都在 scenes 里定义了"
      : `scene-transitions 目标未定义: ${unknownTargets.map(t => t.to).join(", ")}`));
  // 如果有 boss / floor / level 相关 scene 或 event-graph 提到 floor-transition，代码里应该有 nextFloor/advanceFloor/regenerateFloor
  const prdMentionsLevels = ctx.prd && /多关卡|下一关|floor\s*[0-9]|level\s*[0-9]|currentFloor|maxFloor/i.test(ctx.prd);
  const graphMentionsFloorFlow = ctx.specs["event-graph"] &&
    /floor[-_]transition|boss[.-]died|level[.-]complete|floor[.-]entered/i.test(ctx.specs["event-graph"]);
  if (prdMentionsLevels || graphMentionsFloorFlow) {
    const hasRebuild = /regenerateFloor|rebuildFloor|loadFloor|enterFloor|advanceFloor|scene\.restart|buildLevel/.test(ctx.sourceBlob);
    rules.push(rule("events.floor-rebuild-present", "error",
      hasRebuild,
      "PRD 或 event-graph 提到多关卡/下一关，代码必须有 regenerateFloor/enterFloor/scene.restart 之类的场景重建函数"));
  }
  return rules;
}

// ---------------------------------------------------------------------------
// spec 解析（轻量正则，不引入 yaml 依赖）
// ---------------------------------------------------------------------------

function extractLocalFileSources(assetsYaml) {
  // 匹配 "source: assets/library_2d/..." 或 "assets/library_3d/..." 之后紧跟的 "type: local-file"
  const out = [];
  const blocks = assetsYaml.split(/\n\s*-\s+id:/);
  for (const b of blocks) {
    if (!/type:\s*local-file/.test(b)) continue;
    const m = b.match(/source:\s*(\S+)/);
    if (m && /assets\/library_(?:2d|3d)\//.test(m[1])) out.push(m[1]);
  }
  return out;
}

function extractLocalFileIds(assetsYaml) {
  const out = [];
  let spec;
  try {
    spec = yaml.load(assetsYaml) ?? {};
  } catch {
    return out;
  }
  for (const sec of ["images", "spritesheets", "audio", "fonts"]) {
    const list = Array.isArray(spec[sec]) ? spec[sec] : [];
    for (const item of list) {
      const id = item?.id ?? item?.family;
      if (id && item.type === "local-file") out.push(String(id));
    }
  }
  return out;
}

function extractVisualVerbs(ruleYaml) {
  const verbs = new Set();
  const KNOWN = ["particle-burst", "screen-shake", "tint-flash", "float-text", "scale-bounce", "pulse", "fade-out"];
  // 进入 visual: 段后逐行找已知动词
  const lines = ruleYaml.split("\n");
  let inVisual = false;
  let visualIndent = -1;
  for (const ln of lines) {
    const trim = ln.trim();
    const indent = ln.match(/^\s*/)[0].length;
    if (/^visual:\s*$/.test(trim)) { inVisual = true; visualIndent = indent; continue; }
    if (inVisual && indent <= visualIndent && trim && !trim.startsWith("#") && !trim.startsWith("-") && !/^visual:/.test(trim)) {
      inVisual = false;
    }
    if (inVisual) {
      for (const v of KNOWN) {
        if (trim.includes(v)) verbs.add(v);
      }
    }
  }
  return Array.from(verbs);
}

function extractSceneIds(sceneYaml) {
  return [...sceneYaml.matchAll(/^\s*-\s+id:\s*(\S+)/gm)].map(m => m[1]);
}

function extractSceneTransitions(sceneYaml) {
  // 抓 boot-contract.scene-transitions 下的 from/to 对
  const ts = [];
  const m = sceneYaml.match(/scene-transitions:([\s\S]*?)(?:\n[^\s]|\n$|$)/);
  if (!m) return ts;
  const body = m[1];
  const blocks = body.split(/\n\s*-\s+from:/);
  for (const b of blocks.slice(1)) {
    const from = b.match(/^\s*(\S+)/)?.[1];
    const to = b.match(/to:\s*(\S+)/)?.[1];
    if (from && to) ts.push({ from, to });
  }
  return ts;
}

function countOccurrences(text, pat) {
  if (!text) return 0;
  return (text.match(pat) || []).length;
}

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------

function rule(id, severity, passed, detail, data) {
  return { id, severity, passed, detail, ...(data ? { data } : {}) };
}

function printReport(ctx, results, score, passed) {
  console.log(`合规审计: ${ctx.caseDir}`);
  console.log(`总分: ${score}/100   ${passed ? "✅ PASS" : "❌ FAIL"}   (阈值 ${COMPLIANCE_PASS_SCORE})`);
  console.log();
  for (const r of results) {
    const mark = r.passed ? "✓" : (r.severity === "error" ? "✗" : r.severity === "warning" ? "⚠" : "·");
    console.log(`  ${mark} [${r.severity}] ${r.id}`);
    if (!r.passed && r.detail) console.log(`      ${r.detail}`);
    if (r.data) {
      const preview = JSON.stringify(r.data);
      console.log(`      ${preview.length > 160 ? preview.slice(0, 160) + "..." : preview}`);
    }
  }
  console.log();
  const errs = results.filter(r => !r.passed && r.severity === "error").length;
  const warns = results.filter(r => !r.passed && r.severity === "warning").length;
  console.log(`错误 ${errs} · 警告 ${warns} · 通过 ${results.filter(r => r.passed).length}/${results.length}`);
}

function emit(kind, msg) {
  if (asJson) console.log(JSON.stringify({ [kind]: msg }));
  else console.error(`[${kind}] ${msg}`);
}
