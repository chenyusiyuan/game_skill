#!/usr/bin/env node
/**
 * check_implementation_contract.js
 *
 * 强化契约层校验。它不替代 check_asset_selection/check_asset_usage，
 * 而是把二者之间缺失的「语义绑定 + 真实消费 + 引擎生命周期」串起来。
 *
 * 用法:
 *   node check_implementation_contract.js <case-dir> --stage expand
 *   node check_implementation_contract.js <case-dir> --stage codegen
 *   node check_implementation_contract.js <case-dir> --log cases/<slug>/.game/log.jsonl
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, join, relative, resolve } from "path";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";
import { readAssetStrategy } from "./_asset_strategy.js";

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const stageIdx = args.indexOf("--stage");
const stage = stageIdx >= 0 ? args[stageIdx + 1] : "codegen";
const log = createLogger(parseLogArg(process.argv));

const contractPath = join(caseDir, "specs/implementation-contract.yaml");
const mechanicsPath = join(caseDir, "specs/mechanics.yaml");
const scenePath = join(caseDir, "specs/scene.yaml");
const assetsPath = join(caseDir, "specs/assets.yaml");
const gameDir = join(caseDir, "game");
const errors = [];
const warnings = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`Implementation contract 校验: ${caseDir} [stage=${stage}]`);

// asset-strategy: mode=none → 允许没有 assets.yaml，并跳过 asset-bindings 系列检查
const strategy = readAssetStrategy(caseDir);
const bypassAssets = strategy.mode === "none";
if (bypassAssets) {
  ok(`asset-strategy.mode=none：跳过 asset-bindings 校验`);
}

const contract = readYaml(contractPath, "implementation-contract");
const sceneSpec = readYaml(scenePath, "scene");
const assetsSpec = (bypassAssets && !existsSync(assetsPath)) ? {} : readYaml(assetsPath, "assets");

if (!contract || !sceneSpec || (!bypassAssets && !assetsSpec)) finish();

checkContractShape(contract);
checkBootContract(contract, sceneSpec);
if (!bypassAssets) checkAssetBindings(contract, assetsSpec);

if (stage !== "expand" && existsSync(gameDir)) {
  checkGeneratedCode(contract, assetsSpec, gameDir);
} else if (stage !== "expand") {
  warn("game/ 不存在，跳过 codegen 侧消费校验");
}

finish();

function readYaml(path, label) {
  if (!existsSync(path)) {
    fail(`${label} 文件不存在: ${relative(caseDir, path)}`);
    return null;
  }
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (e) {
    fail(`${label} YAML 解析失败: ${e.message}`);
    return null;
  }
}

function checkContractShape(c) {
  if (c["contract-version"] !== 1) fail("contract-version 必须为 1");
  else ok("contract-version = 1");

  const engine = c.runtime?.engine;
  if (!engine) fail("runtime.engine 缺失");
  else ok(`runtime.engine = ${engine}`);

  const runMode = c.runtime?.["run-mode"];
  if (!["file", "local-http"].includes(runMode)) fail("runtime.run-mode 必须是 file 或 local-http");
  else ok(`runtime.run-mode = ${runMode}`);

  if (!c.boot?.["entry-scene"]) fail("boot.entry-scene 缺失");
  if (!c.boot?.["ready-condition"]) fail("boot.ready-condition 缺失");
  if (!c.boot?.["start-action"]) fail("boot.start-action 缺失");
  if (!Array.isArray(c.boot?.["scene-transitions"])) fail("boot.scene-transitions 必须是数组");

  if (!Array.isArray(c["asset-bindings"])) fail("asset-bindings 必须是数组");
  else ok(`asset-bindings = ${c["asset-bindings"].length}`);

  if (!c["engine-lifecycle"]?.["asset-loading"]) fail("engine-lifecycle.asset-loading 缺失");
  if (!Array.isArray(c.verification?.["required-runtime-evidence"])) {
    fail("verification.required-runtime-evidence 必须是数组");
  }
}

function checkBootContract(c, scene) {
  const sceneIds = new Set((scene.scenes ?? []).map((s) => s.id).filter(Boolean));
  const zoneIds = new Set();
  for (const s of scene.scenes ?? []) {
    for (const z of s.zones ?? []) if (z.id) zoneIds.add(z.id);
    for (const u of s["ui-slots"] ?? []) if (u.id) zoneIds.add(u.id);
  }

  const entry = c.boot?.["entry-scene"];
  if (entry && !sceneIds.has(entry)) fail(`boot.entry-scene 未在 scene.yaml 定义: ${entry}`);
  else if (entry) ok(`boot.entry-scene 已定义: ${entry}`);

  const target = c.boot?.["start-action"]?.target;
  if (target && !zoneIds.has(target)) fail(`boot.start-action.target 未在 scene zones/ui-slots 定义: ${target}`);
  else if (target) ok(`boot.start-action.target 已定义: ${target}`);

  const unknownTargets = (c.boot?.["scene-transitions"] ?? [])
    .map((t) => t?.to)
    .filter((to) => to && !sceneIds.has(to));
  if (unknownTargets.length) fail(`boot.scene-transitions.to 目标未定义: ${unknownTargets.join(", ")}`);
  else ok("boot.scene-transitions 目标完整");

  // T15/L1: 每个 scene 必须声明 layout 数值段
  // viewport/board-bbox/hud-bbox/safe-area 四个子段必须有值（数字、比例或已知预设枚举）
  // 目的：让 codegen 不再"拍脑袋铺满顶部"，所有布局先落在 spec，再由代码承接
  const REQUIRED_LAYOUT_KEYS = ["viewport", "board-bbox", "hud-bbox", "safe-area"];
  for (const s of scene.scenes ?? []) {
    const layout = s.layout;
    if (!layout || typeof layout !== "object") {
      fail(`[scene.${s.id}] 缺少 layout 段（必须声明 ${REQUIRED_LAYOUT_KEYS.join(" / ")}）`);
      continue;
    }
    const missing = REQUIRED_LAYOUT_KEYS.filter((k) => layout[k] === undefined || layout[k] === null || layout[k] === "");
    if (missing.length) {
      fail(`[scene.${s.id}.layout] 缺少字段: ${missing.join(", ")}（数值 bbox、比例 "50%" 或预设 "full" / "centered" 都可以）`);
    } else {
      ok(`[scene.${s.id}.layout] 四段齐全`);
    }
  }
}

function checkAssetBindings(c, assets) {
  const assetItems = collectAssets(assets);
  const assetById = new Map(assetItems.map((a) => [a.id, a]));
  const bindings = Array.isArray(c["asset-bindings"]) ? c["asset-bindings"] : [];
  const bindingById = new Map(bindings.map((b) => [b.id, b]));

  for (const b of bindings) {
    if (!b.id) { fail("asset-bindings 中存在缺 id 的条目"); continue; }
    const item = assetById.get(b.id);
    if (!item) {
      fail(`[contract.asset.${b.id}] contract 绑定的 asset 不存在于 assets.yaml`);
      continue;
    }
    if (b.type !== item.type) warn(`[contract.asset.${b.id}] type 与 assets.yaml 不一致: contract=${b.type}, assets=${item.type}`);
    validateSemanticBinding(b, item);
  }

  for (const item of assetItems.filter((a) => a.type === "local-file")) {
    if (!bindingById.has(item.id)) {
      fail(`[contract.asset.${item.id}] local-file 素材缺少 asset-bindings 语义绑定`);
    }
  }
}

function validateSemanticBinding(binding, item) {
  const source = String(item.source ?? binding.source ?? "").toLowerCase();
  const file = basename(source);
  const role = String(binding.role ?? "").toLowerCase();
  const kind = String(binding["asset-kind"] ?? "").toLowerCase();
  const textBearing = Boolean(binding["text-bearing"]);
  const isButtonSource = source.includes("/buttons/") || /^button_/.test(file) || kind === "button";

  if (textBearing && isButtonSource && role !== "button") {
    fail(`[contract.asset.${item.id}] button 素材不能绑定到非按钮的文字承载 UI（role=${role}）`);
  }
  if (role === "button" && /\/sprites\/|\/tiles\//.test(source)) {
    fail(`[contract.asset.${item.id}] sprite/tile 不能绑定为 button`);
  }
  if ((role === "panel" || role === "scene-background") && /(character|player|enemy)/.test(source)) {
    fail(`[contract.asset.${item.id}] 角色素材不能绑定为 panel/background`);
  }
  if (item.type === "local-file" && binding["must-render"] === true && binding["allow-fallback"] !== false) {
    // 只对核心素材（非装饰性）强制要求 allow-fallback: false
    const decorativeRoles = ["particle", "hud-indicator", "decorative"];
    if (!decorativeRoles.includes(String(binding.role ?? ""))) {
      fail(`[contract.asset.${item.id}] 核心 local-file (role=${binding.role}) 必须 allow-fallback: false，避免静默降级掩盖加载失败`);
    }
  }
}

function checkGeneratedCode(c, assets, root) {
  const engine = c.runtime?.engine;
  const blobs = collectSource(root);
  const allSrc = blobs.map((b) => b.text).join("\n");
  const businessSrc = blobs
    .filter((b) => !/[/\\]adapters[/\\]/.test(b.path))
    .filter((b) => !/assets\.manifest\.json$/.test(b.path))
    .filter((b) => !/registry\.spec\.js$/.test(b.path))
    .map((b) => b.text)
    .join("\n");

  if (bypassAssets) {
    ok("[asset] asset-strategy.mode=none：跳过 manifest / required asset 消费校验");
  } else {
    checkManifest(c, assets, root);
    checkRequiredAssetConsumption(c, businessSrc);
  }
  checkTracePushPoints(businessSrc);  // T3
  checkPrimitiveImplementationCoverage(allSrc); // mechanics -> code 1:1

  if (engine === "phaser3" || engine === "phaser") {
    if (/\.load\.start\s*\(/.test(businessSrc)) {
      fail("[contract.lifecycle.phaser] 禁止在业务代码中 scene.load.start()；素材必须在 preload 队列注册，由 Phaser 生命周期加载");
    } else {
      ok("[contract.lifecycle.phaser] 业务代码未发现 scene.load.start() 反模式");
    }
  }
}

function checkPrimitiveImplementationCoverage(sourceBlob) {
  if (!existsSync(mechanicsPath)) {
    fail("[mechanics] specs/mechanics.yaml 不存在，无法校验 @primitive 代码覆盖率");
    return;
  }
  let mech;
  try {
    mech = yaml.load(readFileSync(mechanicsPath, "utf-8")) ?? {};
  } catch (e) {
    fail(`[mechanics] mechanics.yaml 解析失败: ${e.message}`);
    return;
  }
  const nodes = Array.isArray(mech.mechanics) ? mech.mechanics : [];
  if (nodes.length === 0) {
    fail("[mechanics] mechanics.yaml 缺少 mechanics[] 节点");
    return;
  }
  const missing = [];
  for (const node of nodes) {
    const id = node.node;
    const primitive = node.primitive;
    if (!id || !primitive) {
      missing.push(`${id || "<missing-node>"}:${primitive || "<missing-primitive>"}`);
      continue;
    }
    const re = new RegExp(
      `@primitive\\(\\s*${escapeReg(primitive)}\\s*\\)\\s*:\\s*(?:node-id\\s*=\\s*)?${escapeReg(id)}\\b`,
    );
    if (!re.test(sourceBlob)) missing.push(`${id} (${primitive})`);
  }
  if (missing.length) {
    fail(`[mechanics] ${missing.length}/${nodes.length} 个 mechanics node 缺少 @primitive 实现注释: ${missing.slice(0, 8).join(", ")}`);
  } else {
    ok(`[mechanics] 所有 ${nodes.length} 个 mechanics node 均有 @primitive 实现注释`);
  }
}

// T3: 扫 event-graph.yaml 里声明的每条 rule-id，业务代码必须有对应 push
// 证据：出现 `rule: "<rule-id>"` 或 `rule:'<rule-id>'` 这种字面量即算
function checkTracePushPoints(businessSrc) {
  const egPath = join(caseDir, "specs/event-graph.yaml");
  if (!existsSync(egPath)) {
    warn("[trace] 缺 specs/event-graph.yaml，跳过 trace push 校验");
    return;
  }
  let ruleIds = [];
  try {
    const raw = readFileSync(egPath, "utf-8");
    const body = raw.split(/^rule-traces:/m)[1];
    if (body) {
      ruleIds = [...body.matchAll(/^\s*-\s*rule-id:\s*([\w-]+)/gm)].map((m) => m[1]);
    }
  } catch {}
  if (ruleIds.length === 0) {
    warn("[trace] event-graph.yaml 无 rule-traces 段（需跑 extract_game_prd --emit-rule-traces）");
    return;
  }
  // 先检查业务代码是否有 window.__trace 初始化或 push
  const hasTraceInit = /window\.__trace\s*=|window\.__trace\.push\s*\(/.test(businessSrc);
  if (!hasTraceInit) {
    fail(`[trace] 业务代码未见 window.__trace.push 调用；codegen 必须在每条 @rule 触发点 push`);
    return;
  }
  // 每条 rule-id 必须有对应 push
  const missing = [];
  for (const id of ruleIds) {
    const pat = new RegExp(`rule\\s*:\\s*["'\`]${escapeReg(id)}["'\`]`);
    if (!pat.test(businessSrc)) missing.push(id);
  }
  if (missing.length > 0) {
    const shown = missing.slice(0, 8).join(", ");
    const more = missing.length > 8 ? ` ...+${missing.length - 8}` : "";
    fail(`[trace] ${missing.length}/${ruleIds.length} 个 @rule 在业务代码中缺少 window.__trace.push({rule:...}) 调用: ${shown}${more}`);
  } else {
    ok(`[trace] 所有 ${ruleIds.length} 个 @rule 都有 trace push 调用`);
  }
}

function checkManifest(c, assets, root) {
  const requiredIds = collectAssets(assets)
    .filter((a) => a.type === "local-file" && a.section !== "fonts")
    .map((a) => a.id);
  if (requiredIds.length === 0) {
    ok("无 local-file image/spritesheet/audio，跳过 manifest 覆盖检查");
    return;
  }
  const manifestPath = firstExisting(
    join(root, "src/assets.manifest.json"),
    join(root, "assets.manifest.json")
  );
  if (!manifestPath) {
    fail("缺少 assets.manifest.json，codegen 必须先跑 generate_registry.js");
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (e) {
    fail(`assets.manifest.json 解析失败: ${e.message}`);
    return;
  }
  const manifestIds = new Set([
    ...(manifest.images ?? []).map((x) => x.id),
    ...(manifest.spritesheets ?? []).map((x) => x.id),
    ...(manifest.audio ?? []).map((x) => x.id),
  ]);
  const missing = requiredIds.filter((id) => !manifestIds.has(id));
  if (missing.length) fail(`manifest 缺少 local-file asset id: ${missing.join(", ")}`);
  else ok("manifest 覆盖所有 local-file image/spritesheet/audio");
}

function checkRequiredAssetConsumption(c, businessSrc) {
  const bindings = (c["asset-bindings"] ?? []).filter((b) =>
    b["must-render"] === true &&
    ["images", "spritesheets", "audio"].includes(b.section)
  );
  const missing = [];
  for (const b of bindings) {
    const idRe = new RegExp(`["'\`]${escapeReg(b.id)}["'\`]`);
    const hasId = idRe.test(businessSrc);
    if (!hasId) { missing.push(b.id); continue; }
    // 消费证据：id 出现 + 整个业务代码中存在引擎消费调用即可
    // 不要求 id 和消费调用在同一行——因为常见模式是 helper 封装：
    //   调用处: createImageButton('btn-start-primary', ...)   ← id 在这
    //   helper: registry.getTexture(imageId)                   ← 消费在这
    const consumerPat = consumerPatternFor(b);
    if (!consumerPat.test(businessSrc)) missing.push(b.id);
  }
  if (missing.length) {
    fail(`required asset 未在业务代码中形成消费证据: ${missing.slice(0, 12).join(", ")}`);
  } else {
    ok(`required asset 消费证据完整 (${bindings.length}/${bindings.length})`);
  }
}

function consumerPatternFor(binding) {
  if (binding.section === "audio") {
    return binding.type === "synthesized"
      ? /AudioContext\s*\(|OscillatorNode|createOscillator\s*\(|beep\s*\(|playTone\s*\(/
      : /getAudio\s*\(|playSound\s*\(|sound\.add\s*\(|sound\.play\s*\(/;
  }
  if (binding.type === "graphics-generated" || binding.type === "inline-svg") {
    return /fillRect\s*\(|strokeRect\s*\(|roundRect\s*\(|arc\s*\(|beginPath\s*\(|ctx\.fill\s*\(|ctx\.stroke\s*\(|new\s+Graphics\s*\(|\.add\.graphics\s*\(|\.fillRect\s*\(|\.fillCircle\s*\(|\.rect\s*\(|\.circle\s*\(|\.fill\s*\(|\.stroke\s*\(|<svg\b|createElementNS\s*\([^)]*svg/;
  }
  return /getTexture\s*\(|new\s+Sprite\s*\(|\.add\.image\s*\(|\.add\.sprite\s*\(|drawImage\s*\(|Sprite\.from\s*\(/;
}

function collectAssets(spec) {
  const out = [];
  for (const section of ["images", "spritesheets", "audio", "fonts"]) {
    const list = Array.isArray(spec[section]) ? spec[section] : [];
    for (const item of list) {
      const id = item.id ?? item.family;
      if (!id) continue;
      out.push({
        id: String(id),
        section,
        source: item.source ?? "",
        type: normalizeType(item.type, item.source, section),
        usage: item.usage ?? "",
      });
    }
  }
  return out;
}

function normalizeType(type, source, section) {
  if (type === "generated") return section === "audio" ? "synthesized" : "graphics-generated";
  if (type) return String(type);
  if (typeof source === "string" && /^assets\/library_(?:2d|3d)\//.test(source)) return "local-file";
  return "unknown";
}

function collectSource(root) {
  const out = [];
  walk(root, (p) => {
    if (!/\.(js|mjs|html|css|json)$/.test(p)) return;
    try { out.push({ path: p, text: readFileSync(p, "utf-8") }); } catch {}
  });
  return out;
}

function walk(dir, fn) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else fn(p);
  }
}

function firstExisting(...paths) {
  return paths.find((p) => existsSync(p)) ?? null;
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function finish() {
  console.log(`\n${errors.length === 0 ? "✓ 通过" : `✗ ${errors.length} 个错误`}` +
    (warnings.length ? `（${warnings.length} warnings）` : ""));
  log.entry({
    type: "check-run",
    phase: stage === "expand" ? "expand" : "verify",
    step: "implementation-contract",
    script: "check_implementation_contract.js",
    exit_code: errors.length > 0 ? 1 : 0,
    errors,
    warnings,
  });
  process.exit(errors.length > 0 ? 1 : 0);
}
