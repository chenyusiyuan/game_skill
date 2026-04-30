#!/usr/bin/env node
/**
 * check_visual_slots.js — 轻量 visual-slots 语义槽校验。
 *
 * 规则：
 *   - asset-strategy.mode=none：允许缺 visual-slots.yaml。
 *   - 新 case 只在显式 --allow-missing 时允许缺 visual-slots.yaml。
 *   - 有 visual-core-entities 或 core must-render visual asset 时，缺 visual-slots.yaml 必须 fail。
 *   - 一旦存在 visual-slots.yaml：must-render 核心视觉 asset 必须绑定到合法 slot。
 */

import { existsSync, readFileSync } from "fs";
import { basename, join, resolve } from "path";
import yaml from "js-yaml";
import { createLogger, parseLogArg } from "./_logger.js";
import { readAssetStrategy } from "./_asset_strategy.js";
import { isValidVisualPrimitive } from "./_visual_primitive_enum.js";

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const allowMissing = args.includes("--allow-missing");
const log = createLogger(parseLogArg(process.argv));
const specsDir = join(caseDir, "specs");
const visualSlotsPath = join(specsDir, "visual-slots.yaml");
const assetsPath = join(specsDir, "assets.yaml");
const contractPath = join(specsDir, "implementation-contract.yaml");
const errors = [];
const warnings = [];

function fail(msg) { console.log(`  ✗ ${msg}`); errors.push(msg); }
function warn(msg) { console.log(`  ⚠ ${msg}`); warnings.push(msg); }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log(`visual-slots 校验: ${caseDir}`);

if (!existsSync(visualSlotsPath)) {
  const strategy = readAssetStrategy(caseDir);
  if (strategy.mode === "none") {
    ok("asset-strategy.mode=none：允许缺 specs/visual-slots.yaml");
    finish();
  }
  const coreEntities = Array.isArray(strategy["visual-core-entities"]) ? strategy["visual-core-entities"].map(String) : [];
  const coreMustRender = hasCoreMustRenderAsset(contractPath, new Set(coreEntities));
  if (allowMissing) {
    warn(`specs/visual-slots.yaml 不存在，但 --allow-missing 已显式开启（legacy 兼容）；core-entities=${coreEntities.length}, core-must-render=${coreMustRender}`);
    finish();
  }
  if (coreEntities.length > 0 || coreMustRender) {
    fail(`specs/visual-slots.yaml 不存在；asset-strategy.visual-core-entities 非空或 implementation-contract 存在 core must-render visual asset 时必须生成 visual-slots`);
  } else {
    warn("specs/visual-slots.yaml 不存在；当前未发现 core visual entity / core must-render visual asset，按非核心视觉 case 放行");
  }
  finish();
}

const assets = readYaml(assetsPath, "assets");
const contract = readYaml(contractPath, "implementation-contract");
const visualSlots = readYaml(visualSlotsPath, "visual-slots");
if (!assets || !contract || !visualSlots) finish();

const strategy = readAssetStrategy(caseDir);
const coreEntityIds = new Set(strategy["visual-core-entities"] ?? []);
const assetsById = new Map(collectAssets(assets).map((a) => [a.id, a]));
const slots = Array.isArray(visualSlots.slots) ? visualSlots.slots : [];
const slotById = new Map(slots.map((s) => [String(s?.id ?? ""), s]).filter(([id]) => id));
const assetSlotBindings = Array.isArray(visualSlots["asset-slot-bindings"])
  ? visualSlots["asset-slot-bindings"]
  : [];
const assetSlotById = new Map(assetSlotBindings
  .map((b) => [String(b?.["asset-id"] ?? ""), String(b?.["fulfills-slot"] ?? "")])
  .filter(([assetId, slotId]) => assetId && slotId));

checkShape();
checkAssets();
checkRequiredBindings();
finish();

function readYaml(path, label) {
  if (!existsSync(path)) {
    fail(`${label} 文件不存在: ${path}`);
    return null;
  }
  try {
    return yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (e) {
    fail(`${label} YAML 解析失败: ${e.message}`);
    return null;
  }
}

function checkShape() {
  if (visualSlots["visual-slots-version"] !== 1) fail("visual-slots-version 必须为 1");
  else ok("visual-slots-version = 1");
  if (!Array.isArray(visualSlots.slots)) {
    fail("slots 必须是数组");
    return;
  }
  for (const slot of slots) {
    if (!slot?.id) { fail("slots 中存在缺 id 的条目"); continue; }
    if (!slot.entity) fail(`[visual-slot.${slot.id}] 缺 entity`);
    if (!slot["semantic-slot"]) fail(`[visual-slot.${slot.id}] 缺 semantic-slot`);
    if (!slot["render-zone"]) fail(`[visual-slot.${slot.id}] 缺 render-zone`);
    if (!Array.isArray(slot["state-driven-fields"])) {
      fail(`[visual-slot.${slot.id}] state-driven-fields 必须是数组`);
    }
    const allowed = slot["allowed-visual-primitives"];
    if (allowed !== undefined) {
      if (!Array.isArray(allowed)) {
        fail(`[visual-slot.${slot.id}] allowed-visual-primitives 必须是数组`);
      } else {
        for (const vp of allowed) {
          if (!isValidVisualPrimitive(String(vp))) {
            fail(`[visual-slot.${slot.id}] allowed-visual-primitives 包含非法值: ${vp}`);
          }
        }
      }
    }
  }
  if (errors.length === 0) ok(`slots shape 完整 (${slots.length})`);
}

function checkAssets() {
  for (const asset of assetsById.values()) {
    const slotId = asset["fulfills-slot"];
    if (!slotId) continue;
    if (!slotById.has(String(slotId))) {
      fail(`[asset.${asset.id}] fulfills-slot="${slotId}" 未在 visual-slots.yaml 定义`);
    }
  }
  for (const [assetId, slotId] of assetSlotById) {
    if (!assetsById.has(assetId)) fail(`[asset-slot-bindings.${assetId}] asset 不存在于 assets.yaml`);
    if (!slotById.has(slotId)) fail(`[asset-slot-bindings.${assetId}] fulfills-slot="${slotId}" 未定义`);
  }
}

function checkRequiredBindings() {
  const requiredSlots = new Map();
  for (const slot of slots) {
    if (slot?.required === true) requiredSlots.set(String(slot.id), 0);
  }

  for (const binding of contract["asset-bindings"] ?? []) {
    if (!binding?.id || binding["must-render"] !== true) continue;
    if (!["images", "spritesheets"].includes(String(binding.section ?? ""))) continue;
    const bindingTo = String(binding["binding-to"] ?? "");
    const isCore = bindingTo && coreEntityIds.has(bindingTo);
    if (!isCore) continue;
    const asset = assetsById.get(String(binding.id));
    const slotId = String(asset?.["fulfills-slot"] ?? binding["visual-slot"] ?? assetSlotById.get(String(binding.id)) ?? "");
    if (!slotId) {
      fail(`[visual-slot.asset.${binding.id}] 核心视觉 must-render asset 缺 fulfills-slot / visual-slot`);
      continue;
    }
    const slot = slotById.get(slotId);
    if (!slot) {
      fail(`[visual-slot.asset.${binding.id}] slot 未定义: ${slotId}`);
      continue;
    }
    if (String(slot.entity ?? "") !== bindingTo) {
      fail(`[visual-slot.asset.${binding.id}] slot.entity=${slot.entity} 与 binding-to=${bindingTo} 不一致`);
    }
    const vp = String(binding["visual-primitive"] ?? asset?.["visual-primitive"] ?? "");
    const allowed = Array.isArray(slot["allowed-visual-primitives"]) ? slot["allowed-visual-primitives"].map(String) : [];
    if (allowed.length > 0 && !allowed.includes(vp)) {
      fail(`[visual-slot.asset.${binding.id}] visual-primitive=${vp || "<missing>"} 不在 slot.allowed-visual-primitives: ${allowed.join(", ")}`);
    }
    const kind = String(binding["asset-kind"] ?? inferAssetKind(asset) ?? "");
    const disallowed = Array.isArray(slot["disallowed-asset-kinds"]) ? slot["disallowed-asset-kinds"].map(String) : [];
    if (kind && disallowed.includes(kind)) {
      fail(`[visual-slot.asset.${binding.id}] asset-kind=${kind} 被 slot.disallowed-asset-kinds 禁止`);
    }
    if (requiredSlots.has(slotId)) requiredSlots.set(slotId, requiredSlots.get(slotId) + 1);
  }

  const missingSlots = [...requiredSlots.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  if (missingSlots.length > 0) {
    fail(`required visual-slots 缺少 must-render asset: ${missingSlots.join(", ")}`);
  } else if (requiredSlots.size > 0) {
    ok(`required visual-slots 均有 must-render asset (${requiredSlots.size}/${requiredSlots.size})`);
  }
}

function collectAssets(spec) {
  const out = [];
  for (const section of ["images", "spritesheets"]) {
    for (const item of spec?.[section] ?? []) {
      const id = item?.id;
      if (!id) continue;
      out.push({ ...item, id: String(id), section });
    }
  }
  return out;
}

function inferAssetKind(asset) {
  const text = `${asset?.id ?? ""} ${asset?.usage ?? ""} ${asset?.source ?? ""}`.toLowerCase();
  const file = basename(String(asset?.source ?? "")).toLowerCase();
  if (asset?.type === "graphics-generated") return "generated-surface";
  if (asset?.type === "inline-svg") return "svg";
  if (/button|btn|按钮/.test(text) || /^button_/.test(file)) return "button";
  if (/coin|gem|金币|宝石/.test(text)) return "coin";
  if (/tile_|\/tiles\//.test(text)) return "terrain-tile";
  if (/character|player|enemy|sprite/.test(text)) return "sprite";
  return "image";
}

function hasCoreMustRenderAsset(path, coreEntityIds) {
  if (!existsSync(path)) return false;
  let contract;
  try {
    contract = yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch {
    return false;
  }
  const explicitCoreRoles = new Set(["core-visual", "primary-core", "primary-visual"]);
  for (const binding of contract["asset-bindings"] ?? []) {
    if (!binding || binding["must-render"] !== true) continue;
    if (!["images", "spritesheets"].includes(String(binding.section ?? ""))) continue;
    const bindingTo = String(binding["binding-to"] ?? "");
    const role = String(binding.role ?? "");
    if (coreEntityIds.has(bindingTo)) return true;
    if (explicitCoreRoles.has(role) || binding["core-visual"] === true) return true;
  }
  return false;
}

function finish() {
  console.log(`\n${errors.length === 0 ? "✓ 通过" : `✗ ${errors.length} 个错误`}` +
    (warnings.length ? `（${warnings.length} warnings）` : ""));
  log.entry({
    type: "check-run",
    phase: "expand",
    step: "visual-slots",
    script: "check_visual_slots.js",
    exit_code: errors.length > 0 ? 1 : 0,
    errors,
    warnings,
  });
  process.exit(errors.length > 0 ? 1 : 0);
}
