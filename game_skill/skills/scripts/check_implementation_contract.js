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
import {
  isValidVisualPrimitive,
  requiresColorSource,
  isValidColorSource,
  VISUAL_PRIMITIVE_ENUM,
} from "./_visual_primitive_enum.js";
import {
  PRIMITIVE_RUNTIME_API,
  isRuntimeBacked,
  isEngineEnforced,
  apisFor,
  applicablePrimitivesFor,
  parseEsmImports,
  isPrimitivesImport,
} from "./_primitive_runtime_map.js";
import { ANTI_CHEAT_PATTERNS } from "./_profile_anti_cheat.js";
import { selectApplicableProbes } from "./_runtime_probes.js";

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
const mechanicsSpec = readOptionalYaml(mechanicsPath, "mechanics");

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

function readOptionalYaml(path, label) {
  if (!existsSync(path)) return null;
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (e) {
    warn(`${label} YAML 解析失败，跳过依赖该文件的过渡校验: ${e.message}`);
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
  checkRequiredTestHooks(c, mechanicsSpec);
}

function checkRequiredTestHooks(c, mechanics) {
  const hooks = c.verification?.["required-test-hooks"];
  // 扁平 string[] 是 B1 过渡期兼容格式，死线 2026-06-01 起改为 fail。
  const DEPRECATED_FLAT_DEADLINE = "2026-06-01";
  const flatDeadline = new Date(DEPRECATED_FLAT_DEADLINE);
  const now = new Date();
  if (Array.isArray(hooks)) {
    if (now >= flatDeadline) {
      fail(`verification.required-test-hooks 仍使用旧 string[] 扁平格式；deprecated 死线 ${DEPRECATED_FLAT_DEADLINE} 已过，必须迁移到 observers/drivers/probes 三桶对象`);
    } else {
      warn(`verification.required-test-hooks 使用旧 string[] 扁平格式；deprecated-flat-test-hooks，请在 ${DEPRECATED_FLAT_DEADLINE} 前迁移到 observers/drivers/probes`);
    }
    log.entry({
      type: "deprecated-flat-test-hooks",
      phase: "verify",
      step: "implementation-contract",
      script: "check_implementation_contract.js",
      deadline: DEPRECATED_FLAT_DEADLINE,
      enforced: now >= flatDeadline,
      hooks,
    });
    if (now >= flatDeadline) return;
    return;
  }
  if (!hooks || typeof hooks !== "object") {
    fail("verification.required-test-hooks 必须是 observers/drivers/probes 三桶对象（旧 string[] 仅过渡 warning）");
    return;
  }
  const buckets = ["observers", "drivers", "probes"];
  for (const bucket of buckets) {
    if (!Array.isArray(hooks[bucket])) {
      fail(`verification.required-test-hooks.${bucket} 必须是数组`);
    }
  }
  if (buckets.every((bucket) => Array.isArray(hooks[bucket]))) {
    ok(`required-test-hooks 三桶齐全: observers=${hooks.observers.length}, drivers=${hooks.drivers.length}, probes=${hooks.probes.length}`);
  }

  const applicable = mechanics ? selectApplicableProbes(mechanics) : [];
  if (applicable.length > 0 && Array.isArray(hooks.probes) && !hooks.probes.includes("resetWithScenario")) {
    fail(`missing-probe-for-runtime-semantics: mechanics 匹配 ${applicable.length} 个 runtime probe，但 required-test-hooks.probes 缺 resetWithScenario`);
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
  const coreEntityIds = new Set(strategy["visual-core-entities"] ?? []);
  const DECORATIVE_ROLES = new Set(["particle", "hud-indicator", "decorative"]);

  for (const b of bindings) {
    if (!b.id) { fail("asset-bindings 中存在缺 id 的条目"); continue; }
    const item = assetById.get(b.id);
    if (!item) {
      fail(`[contract.asset.${b.id}] contract 绑定的 asset 不存在于 assets.yaml`);
      continue;
    }
    if (b.type !== item.type) warn(`[contract.asset.${b.id}] type 与 assets.yaml 不一致: contract=${b.type}, assets=${item.type}`);
    validateSemanticBinding(b, item, coreEntityIds);
  }

  for (const item of assetItems.filter((a) => a.type === "local-file")) {
    if (!bindingById.has(item.id)) {
      fail(`[contract.asset.${item.id}] local-file 素材缺少 asset-bindings 语义绑定`);
    }
  }

  // P0.6: 每个 visual-core-entity 必须有至少 1 个"合格的主视觉 binding"
  //   · must-render: true
  //   · allow-fallback: false
  //   · role 不在装饰角色白名单内
  //   · section 是 images/spritesheets（不能只靠音频/字体顶替）
  for (const coreId of coreEntityIds) {
    const boundTo = bindings.filter((b) =>
      String(b["binding-to"] ?? "") === String(coreId) &&
      ["images", "spritesheets"].includes(String(b.section ?? ""))
    );
    if (boundTo.length === 0) {
      // 交由 check_asset_selection [core-binding] 规则负责报"一个都没有"的情况
      continue;
    }
    const primary = boundTo.find((b) =>
      b["must-render"] === true &&
      b["allow-fallback"] === false &&
      !DECORATIVE_ROLES.has(String(b.role ?? ""))
    );
    if (!primary) {
      const summary = boundTo.map((b) => `${b.id}(role=${b.role},must=${b["must-render"]},fallback=${b["allow-fallback"]})`).join(", ");
      fail(`[contract.core-must-render] visual-core-entity "${coreId}" 无合格主视觉 binding；至少需要 1 个 must-render=true + allow-fallback=false + role 非装饰。现有: ${summary}`);
    }
  }
}

function validateSemanticBinding(binding, item, coreEntityIds = new Set()) {
  const source = String(item.source ?? binding.source ?? "").toLowerCase();
  const file = basename(source);
  const role = String(binding.role ?? "").toLowerCase();
  const kind = String(binding["asset-kind"] ?? "").toLowerCase();
  const textBearing = Boolean(binding["text-bearing"]);
  const isButtonSource = source.includes("/buttons/") || /^button_/.test(file) || kind === "button";

  // P0.4: core entity 的 binding 必须有合法 visual-primitive（single source of truth）
  const bindingTo = binding["binding-to"];
  const vp = binding["visual-primitive"];
  if (bindingTo && coreEntityIds.has(String(bindingTo))) {
    if (!vp) {
      fail(`[contract.asset.${item.id}] binding-to="${bindingTo}" 是 visual-core-entities；contract 必须透传 visual-primitive（合法值: ${VISUAL_PRIMITIVE_ENUM.join(", ")}）`);
    } else if (!isValidVisualPrimitive(String(vp))) {
      fail(`[contract.asset.${item.id}] visual-primitive="${vp}" 不在合法枚举内；合法值: ${VISUAL_PRIMITIVE_ENUM.join(", ")}`);
    } else if (requiresColorSource(String(vp))) {
      const cs = binding["color-source"];
      if (!cs) {
        fail(`[contract.asset.${item.id}] visual-primitive="${vp}" 要求声明 color-source；contract 必须透传（允许: entity.<field> / palette.<name> / #rrggbb / rgb(...)）`);
      } else if (!isValidColorSource(String(cs))) {
        fail(`[contract.asset.${item.id}] color-source="${cs}" 格式不合法`);
      }
    }
  }

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
    // _common/** 整体是共享框架代码（不是业务产物）：primitives / test-hook / registry.spec /
    // asset-usage / fx.spec 等 JSDoc 里的 API 示例会把 call-site 与 anti-cheat 检查误触发。
    // P1.4 首修已排除 _common/primitives/**，本次扩到整个 _common。
    .filter((b) => !/[/\\]_common[/\\]/.test(b.path))
    .filter((b) => !/[/\\]mechanics[/\\]/.test(b.path))
    .map((b) => b.text)
    .join("\n");

  if (bypassAssets) {
    ok("[asset] asset-strategy.mode=none：跳过 manifest / required asset 消费校验");
  } else {
    checkManifest(c, assets, root);
    checkRequiredAssetConsumption(c, businessSrc);
  }
  checkTracePushPoints(businessSrc);  // T3
  checkBusinessAntiCheat(businessSrc);  // SB-unified: 业务代码同步跑 profile 反作弊子集
  checkPrimitiveImplementationCoverage(allSrc); // mechanics -> code 1:1
  checkRuntimePrimitiveImports(c, businessSrc); // P1.4: enforced engines must import runtime APIs
  checkWinLoseRuntimeContract(businessSrc); // R2: win-lose-check ctx.fields/elapsedMs/collections contract

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

// P1.4: enrolled engines must import and call applicable primitive runtime APIs.
// 只校验 mechanics.yaml 中出现、已有 runtime wrapper、且适用于当前 engine 的 primitive。
function checkRuntimePrimitiveImports(c, businessSrc) {
  const engine = String(c.runtime?.engine ?? "").toLowerCase();
  const applicable = applicablePrimitivesFor(engine);
  if (!isEngineEnforced(engine)) {
    ok(`[runtime] 引擎=${engine || "<未指定>"} 尚未纳入 runtime primitive contract，跳过 runtime primitive import 校验`);
    return;
  }
  if (!existsSync(mechanicsPath)) {
    // checkPrimitiveImplementationCoverage 已报错，这里静默
    return;
  }
  let mech;
  try {
    mech = yaml.load(readFileSync(mechanicsPath, "utf-8")) ?? {};
  } catch {
    return;
  }
  const nodes = Array.isArray(mech.mechanics) ? mech.mechanics : [];
  const required = new Set();
  const skipped = new Set();
  for (const node of nodes) {
    if (!node?.primitive || !isRuntimeBacked(node.primitive)) continue;
    if (applicable.has(node.primitive)) {
      required.add(node.primitive);
    } else {
      skipped.add(node.primitive);
    }
  }
  if (required.size === 0) {
    ok(`[runtime] 本 case mechanics 未引用 ${engine} 适用的 runtime-backed primitive，跳过`);
    return;
  }
  if (skipped.size > 0) {
    ok(`[runtime] engine=${engine} 跳过 ${skipped.size} 个不适用 primitive: ${[...skipped].sort().join(", ")}`);
  }

  const imports = parseEsmImports(businessSrc).filter((i) =>
    isPrimitivesImport(i.specifier),
  );
  const importedNames = new Set();
  for (const imp of imports) {
    for (const n of imp.names) {
      if (n === "*") {
        // 命名空间导入：把它视为全量，后续 call-site 校验还会要求调用存在
        for (const api of Object.values(PRIMITIVE_RUNTIME_API).flat()) {
          importedNames.add(api);
        }
      } else {
        importedNames.add(n);
      }
    }
  }

  const missingImport = [];
  const missingCall = [];
  const missingBoundCall = [];
  // P1.4 fix: call-site 检查必须忽略注释内的伪调用（JSDoc / 行注释）和 import 语句本身。
  const codeOnly = stripCommentsAndImports(businessSrc);
  for (const primitive of required) {
    const apis = apisFor(primitive);
    const importedApi = apis.find((api) => importedNames.has(api));
    if (!importedApi) {
      missingImport.push(`${primitive} (期望 import 至少一个: ${apis.join(" / ")})`);
      continue;
    }
    // 被 import 的 API 必须至少被调用一次（排除注释、import 语句）
    const callRe = new RegExp(`\\b${escapeReg(importedApi)}\\s*\\(`);
    if (!callRe.test(codeOnly)) {
      missingCall.push(`${primitive}.${importedApi}`);
    }
  }
  for (const node of nodes) {
    if (!node?.node || !required.has(node.primitive)) continue;
    const calls = apisFor(node.primitive)
      .flatMap((api) => extractFunctionCalls(codeOnly, api));
    const bound = calls.some((call) =>
      objectCallHasStringProperty(call, "node", node.node) &&
      objectCallHasAnyStringProperty(call, "rule")
    );
    if (!bound) missingBoundCall.push(`${node.node} (${node.primitive})`);
  }

  if (missingImport.length > 0) {
    fail(
      `[runtime] ${missingImport.length}/${required.size} 个 runtime-backed primitive 未 import: ${missingImport.slice(0, 6).join("; ")}`,
    );
  }
  if (missingCall.length > 0) {
    fail(
      `[runtime] ${missingCall.length} 个 runtime API 已 import 但未调用: ${missingCall.slice(0, 6).join(", ")}（只有调用才能触发 before/after trace）`,
    );
  }
  if (missingBoundCall.length > 0) {
    fail(
      `[runtime] ${missingBoundCall.length} 个 mechanics node 缺少绑定自身 node/rule 的 runtime 调用: ${missingBoundCall.slice(0, 8).join(", ")}。` +
      `每个 runtime API object literal 必须同时包含 node: "<mechanics-node-id>" 与 rule: "<rule-id>"。`,
    );
  }
  if (missingImport.length === 0 && missingCall.length === 0 && missingBoundCall.length === 0) {
    ok(`[runtime] runtime primitive import 完整：全部 ${required.size} 个适用 runtime-backed primitive 均已 import + 调用，并绑定 node/rule`);
  }
}

function checkWinLoseRuntimeContract(businessSrc) {
  const req = collectWinLoseCtxRequirements(mechanicsSpec);
  if (!req) return;
  const codeOnly = stripCommentsAndImports(businessSrc);
  const calls = extractFunctionCalls(codeOnly, "checkWinLose");
  if (calls.length === 0) {
    // checkRuntimePrimitiveImports already reports the missing runtime API call.
    return;
  }

  const failures = [];
  for (let idx = 0; idx < calls.length; idx++) {
    const stateExpr = findObjectPropertyExpression(calls[idx], "state");
    if (!stateExpr) {
      failures.push(`#${idx + 1} 缺少 state 参数`);
      continue;
    }
    const stateObj = resolveStateObjectExpression(stateExpr, codeOnly);
    if (!stateObj) {
      failures.push(`#${idx + 1} state=${shortSnippet(stateExpr)} 不可静态识别；请传入直接对象或返回对象的 helper`);
      continue;
    }

    const missing = [];
    if (req.fields && !hasTopLevelObjectProperty(stateObj, "fields")) missing.push("fields");
    if (req.elapsedMs && !hasTopLevelObjectProperty(stateObj, "elapsedMs")) missing.push("elapsedMs");
    if (req.collections && !hasTopLevelObjectProperty(stateObj, "collections")) missing.push("collections");
    if (missing.length > 0) {
      failures.push(`#${idx + 1} state 缺 ${missing.join("/")}（需要 ${formatWinLoseReq(req)}）`);
    }
  }

  if (failures.length > 0) {
    fail(
      `[runtime.win-lose-check] checkWinLose ctx shape 不符合 mechanics 条件：${failures.join("; ")}。` +
      `win-lose-check reducer 只读取 ctx.fields / ctx.elapsedMs / ctx.collections，禁止传扁平 { misses, timeLeftMs }。`,
    );
  } else {
    ok(`[runtime.win-lose-check] ctx contract 完整：${calls.length} 个 checkWinLose 调用满足 ${formatWinLoseReq(req)}`);
  }
}

function collectWinLoseCtxRequirements(mechanics) {
  const nodes = (mechanics?.mechanics ?? []).filter((n) => n?.primitive === "win-lose-check@v1");
  if (nodes.length === 0) return null;
  const req = { fields: false, elapsedMs: false, collections: false, nodes: nodes.length };
  for (const node of nodes) {
    const params = node.params ?? {};
    const clauses = [
      ...(Array.isArray(params.win) ? params.win : []),
      ...(Array.isArray(params.lose) ? params.lose : []),
      ...(Array.isArray(params.settle) ? params.settle : []),
    ];
    for (const clause of clauses) {
      if (!clause || typeof clause !== "object") continue;
      if (clause.field) req.fields = true;
      if (clause.collection) req.collections = true;
      switch (clause.kind) {
        case "score-reaches":
        case "out-of-resource":
          req.fields = true;
          break;
        case "time-up":
          req.elapsedMs = true;
          break;
        case "all-cleared":
        case "count-reaches":
        case "count-falls-below":
          req.collections = true;
          break;
      }
    }
  }
  return req;
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

  // 反模式检测：业务代码禁止手写 window.__trace.push(...) 或强制覆盖 __trace。
  // 唯一合法初始化是 state.js / template 里的 `window.__trace = window.__trace || []`
  // （幂等模式，runtime primitive 稍后自动 push）。
  // 业务层的 __trace.push 会把 "trace = primitive 执行副产品" 的反作弊设计彻底绕开。
  const forbiddenPush = /window\.__trace\.push\s*\(/g;
  const pushHits = [...businessSrc.matchAll(forbiddenPush)].length;
  // 赋值检测：逐行扫，命中 `window.__trace = ...` 且右侧不是合法的 `window.__trace || []` 幂等模式
  let assignHits = 0;
  for (const line of businessSrc.split("\n")) {
    const m = line.match(/window\.__trace\s*=\s*(.+)/);
    if (!m) continue;
    const rhs = m[1].trim().replace(/;.*$/, "");
    if (/^window\.__trace\s*\|\|\s*\[\s*\]$/.test(rhs)) continue; // 合法幂等
    assignHits++;
  }
  if (pushHits > 0 || assignHits > 0) {
    fail(
      `[trace] 业务代码禁止手写 window.__trace（${pushHits} 处 push + ${assignHits} 处非幂等赋值）；` +
      `trace 必须由 _common/primitives/*.runtime.mjs 的 ctx.rule 参数自动推送。` +
      `见 codegen.md Step 4.0.6 禁止模式清单`,
    );
    return;
  }

  // 每条 rule-id 必须有对应 ctx.rule 字面量（来自业务层的 primitive 调用传参）
  const missing = [];
  for (const id of ruleIds) {
    const pat = new RegExp(`rule\\s*:\\s*["'\`]${escapeReg(id)}["'\`]`);
    if (!pat.test(businessSrc)) missing.push(id);
  }
  if (missing.length > 0) {
    const shown = missing.slice(0, 8).join(", ");
    const more = missing.length > 8 ? ` ...+${missing.length - 8}` : "";
    fail(`[trace] ${missing.length}/${ruleIds.length} 个 @rule 在业务代码中缺少 trace rule 字面量（应通过 primitive ctx.rule 参数体现）: ${shown}${more}`);
  } else {
    ok(`[trace] 所有 ${ruleIds.length} 个 @rule 都有 trace rule 字面量`);
  }
}

// SB-unified: 反作弊规则的业务代码子集。profile 侧已有 _profile_anti_cheat.js 的 ANTI_CHEAT_PATTERNS
// 扫 profile assertion.setup[*].js；业务代码这边也要扫一部分，否则 A 可以把 profile 要禁的
// pattern 挪到业务源码里照样生效（例如 `forceWin()` 函数 / 调 probes 自调 / 非幂等 __trace=）。
// 只挑**业务绝对不该有**的 pattern：强制判定函数 / 调自己的 probe / __trace 非幂等赋值 / push。
// state.phase = 之类 pattern 业务本来就要用，不在此扫描。
function checkBusinessAntiCheat(businessSrc) {
  const businessOnlyPatterns = ANTI_CHEAT_PATTERNS.filter(({ kind }) =>
    /forceWin|__trace|probes/.test(kind),
  );
  // 幂等初始化 `window.__trace = window.__trace || []` 是模板合法写法，先剔除再扫。
  // 见 checkTracePushPoints 同款处理。
  const cleaned = businessSrc
    .split("\n")
    .filter((line) => !/^\s*window\.__trace\s*=\s*window\.__trace\s*\|\|\s*\[\s*\]\s*;?\s*$/.test(line))
    .join("\n");
  const hits = [];
  for (const { re, kind } of businessOnlyPatterns) {
    // 全局扫一遍 businessSrc（含注释，不剥）
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const count = [...cleaned.matchAll(global)].length;
    if (count > 0) hits.push({ kind, count });
  }
  if (hits.length > 0) {
    const label = hits.map((h) => `${h.kind}×${h.count}`).join("; ");
    fail(`[anti-cheat-business] 业务代码命中反作弊 pattern: ${label}（profile 反作弊规则的业务代码镜像；见 _profile_anti_cheat.js ANTI_CHEAT_PATTERNS）`);
  } else {
    ok("[anti-cheat-business] 业务代码未命中反作弊 pattern");
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
  return /getTexture\s*\(|new\s+Sprite\s*\(|\.add\.image\s*\(|\.add\.sprite\s*\(|drawImage\s*\(|Sprite\.from\s*\(|\.addImage\s*\(|\.addSprite\s*\(|\.addObject\s*\(|\.recordDisplayObject\s*\(|\.recordGameObject\s*\(|\.recordObject\s*\(/;
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

// 去掉所有 /* ... */ 块注释、// 行注释，以及 `import ... from '...';` 语句，
// 用于对业务代码做 call-site 检查时过滤伪调用（JSDoc 示例 / import 里重复出现的名字）。
function stripCommentsAndImports(src) {
  let out = String(src);
  // 块注释
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  // 行注释（尾注释 + 独立行）
  out = out.replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
  // ESM import 语句：支持多行 `import {...} from '...'` 或 `import x from '...'`
  out = out.replace(/^\s*import\s+[^;]+?from\s+['"][^'"]+['"]\s*;?/gms, "");
  out = out.replace(/^\s*import\s+['"][^'"]+['"]\s*;?/gm, "");
  // CJS require 赋值（业务代码一般不用，但稳妥起见）
  out = out.replace(/^\s*(?:const|let|var)\s+\{[^}]+\}\s*=\s*require\([^)]+\)\s*;?/gm, "");
  return out;
}

function extractFunctionCalls(src, name) {
  const out = [];
  const re = new RegExp(`\\b${escapeReg(name)}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf("(", m.index);
    const close = findBalancedEnd(src, open, "(", ")");
    if (close < 0) continue;
    out.push(src.slice(open + 1, close));
    re.lastIndex = close + 1;
  }
  return out;
}

function findObjectPropertyExpression(objectExpr, prop) {
  const s = String(objectExpr ?? "").trim();
  if (!s.startsWith("{")) return null;
  const outerEnd = findBalancedEnd(s, 0, "{", "}");
  if (outerEnd < 0) return null;
  let i = 1;
  while (i < outerEnd) {
    i = skipWsAndCommas(s, i);
    const key = readObjectKey(s, i);
    if (!key) { i++; continue; }
    i = skipWs(s, key.end);
    if (s[i] !== ":") continue;
    i = skipWs(s, i + 1);
    const end = findTopLevelExpressionEnd(s, i, outerEnd);
    if (key.name === prop) return s.slice(i, end).trim();
    i = end + 1;
  }
  return null;
}

function resolveStateObjectExpression(expr, source) {
  const s = String(expr ?? "").trim();
  if (s.startsWith("{")) return s;

  let m = s.match(/^([A-Za-z_$][\w$]*)\s*\(\s*\)$/);
  if (m) {
    const obj = findFunctionReturnObject(source, m[1]);
    if (obj) return obj;
  }

  m = s.match(/^([A-Za-z_$][\w$]*)$/);
  if (m) {
    const obj = findVariableObject(source, m[1]);
    if (obj) return obj;
  }
  return null;
}

function findFunctionReturnObject(source, name) {
  const funcRe = new RegExp(`\\bfunction\\s+${escapeReg(name)}\\s*\\([^)]*\\)\\s*\\{`, "g");
  let m = funcRe.exec(source);
  if (m) {
    const open = source.indexOf("{", m.index);
    const close = findBalancedEnd(source, open, "{", "}");
    if (close >= 0) {
      const body = source.slice(open + 1, close);
      const obj = findReturnObject(body);
      if (obj) return obj;
    }
  }

  const arrowRe = new RegExp(`\\b(?:const|let|var)\\s+${escapeReg(name)}\\s*=\\s*(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>\\s*`, "g");
  m = arrowRe.exec(source);
  if (!m) return null;
  let i = skipWs(source, arrowRe.lastIndex);
  if (source[i] === "(") {
    const openObj = skipWs(source, i + 1);
    if (source[openObj] === "{") {
      const closeObj = findBalancedEnd(source, openObj, "{", "}");
      return closeObj >= 0 ? source.slice(openObj, closeObj + 1) : null;
    }
  }
  if (source[i] === "{") {
    const close = findBalancedEnd(source, i, "{", "}");
    if (close >= 0) return findReturnObject(source.slice(i + 1, close));
  }
  return null;
}

function findReturnObject(body) {
  const re = /\breturn\s*\{/g;
  const m = re.exec(body);
  if (!m) return null;
  const open = body.indexOf("{", m.index);
  const close = findBalancedEnd(body, open, "{", "}");
  return close >= 0 ? body.slice(open, close + 1) : null;
}

function findVariableObject(source, name) {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${escapeReg(name)}\\s*=\\s*\\{`, "g");
  const m = re.exec(source);
  if (!m) return null;
  const open = source.indexOf("{", m.index);
  const close = findBalancedEnd(source, open, "{", "}");
  return close >= 0 ? source.slice(open, close + 1) : null;
}

function hasTopLevelObjectProperty(objectExpr, prop) {
  return findObjectPropertyExpression(objectExpr, prop) !== null;
}

function objectCallHasStringProperty(callExpr, prop, expected) {
  const value = findObjectPropertyExpression(callExpr, prop);
  return stringLiteralValue(value) === String(expected);
}

function objectCallHasAnyStringProperty(callExpr, prop) {
  return stringLiteralValue(findObjectPropertyExpression(callExpr, prop)) !== null;
}

function stringLiteralValue(expr) {
  const s = String(expr ?? "").trim();
  if (s.length < 2) return null;
  const quote = s[0];
  if (!["'", '"', "`"].includes(quote) || s.at(-1) !== quote) return null;
  return s.slice(1, -1);
}

function formatWinLoseReq(req) {
  const parts = [];
  if (req.fields) parts.push("fields");
  if (req.elapsedMs) parts.push("elapsedMs");
  if (req.collections) parts.push("collections");
  return parts.length ? parts.join("+") : "ctx";
}

function shortSnippet(s) {
  return String(s).replace(/\s+/g, " ").slice(0, 80);
}

function skipWs(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

function skipWsAndCommas(s, i) {
  while (i < s.length && (/[\s,]/.test(s[i]))) i++;
  return i;
}

function readObjectKey(s, i) {
  const ch = s[i];
  if (ch === "'" || ch === '"') {
    const end = findStringEnd(s, i, ch);
    if (end < 0) return null;
    return { name: s.slice(i + 1, end), end: end + 1 };
  }
  const m = s.slice(i).match(/^([A-Za-z_$][\w$-]*)/);
  if (!m) return null;
  return { name: m[1], end: i + m[1].length };
}

function findTopLevelExpressionEnd(s, start, limit) {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  for (let i = start; i < limit; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = findStringEnd(s, i, ch);
      if (end < 0) return limit;
      i = end;
      continue;
    }
    if (ch === "(") depthParen++;
    else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      return i;
    }
  }
  return limit;
}

function findBalancedEnd(s, openIdx, openCh, closeCh) {
  if (openIdx < 0 || s[openIdx] !== openCh) return -1;
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = findStringEnd(s, i, ch);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findStringEnd(s, start, quote) {
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] === quote) return i;
  }
  return -1;
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
