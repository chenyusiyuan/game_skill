#!/usr/bin/env node
/**
 * generate_visual_slots.js
 *
 * 从 assets.yaml + implementation-contract.yaml 派生轻量 visual-slots.yaml。
 * 这是 visual-primitive 到 semantic slot 的过渡层：不替代 asset-bindings，
 * 只把“某素材服务哪个实体/槽位/渲染区域”收束成可校验结构。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import yaml from "js-yaml";
import { isValidVisualPrimitive } from "./_visual_primitive_enum.js";

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0
  ? resolve(caseDir, args[outIdx + 1])
  : join(caseDir, "specs/visual-slots.yaml");

const specsDir = join(caseDir, "specs");
const assetsPath = firstExisting(join(specsDir, "assets.yaml"), join(specsDir, ".pending/assets.yaml"));
const contractPath = firstExisting(join(specsDir, "implementation-contract.yaml"), join(specsDir, ".pending/implementation-contract.yaml"));

if (!assetsPath || !contractPath) {
  console.error("✗ 需要先存在 specs/assets.yaml 与 specs/implementation-contract.yaml（或 .pending 对应文件）");
  process.exit(1);
}

let assets;
let contract;
try {
  assets = yaml.load(readFileSync(assetsPath, "utf-8")) ?? {};
  contract = yaml.load(readFileSync(contractPath, "utf-8")) ?? {};
} catch (e) {
  console.error(`✗ specs yaml 解析失败: ${e.message}`);
  process.exit(1);
}

const assetById = new Map(collectAssets(assets).map((a) => [a.id, a]));
const slots = new Map();
const assetSlotBindings = [];

for (const binding of contract["asset-bindings"] ?? []) {
  if (!binding?.id || !["images", "spritesheets"].includes(String(binding.section ?? ""))) continue;
  if (binding["must-render"] !== true) continue;
  const entity = binding["binding-to"];
  if (!entity || entity === "decor") continue;
  const asset = assetById.get(String(binding.id));
  const slotId = String(asset?.["fulfills-slot"] ?? binding["visual-slot"] ?? defaultSlotId(entity));
  const visualPrimitive = String(binding["visual-primitive"] ?? asset?.["visual-primitive"] ?? binding.role ?? "core-visual");
  const allowedVisualPrimitives = isValidVisualPrimitive(visualPrimitive) ? [visualPrimitive] : [];
  const slot = slots.get(slotId) ?? {
    id: slotId,
    entity: String(entity),
    "semantic-slot": semanticSlotFor(binding, visualPrimitive),
    required: true,
    "render-zone": renderZoneFor(binding),
    "state-driven-fields": stateDrivenFieldsFor(binding),
    "allowed-visual-primitives": allowedVisualPrimitives,
    "disallowed-asset-kinds": disallowedKindsFor(visualPrimitive),
  };
  if (isValidVisualPrimitive(visualPrimitive) && !slot["allowed-visual-primitives"].includes(visualPrimitive)) {
    slot["allowed-visual-primitives"].push(visualPrimitive);
  }
  slots.set(slotId, slot);
  assetSlotBindings.push({
    "asset-id": String(binding.id),
    "fulfills-slot": slotId,
    entity: String(entity),
    "semantic-slot": slot["semantic-slot"],
  });
}

const out = {
  "visual-slots-version": 1,
  slots: [...slots.values()],
  "asset-slot-bindings": assetSlotBindings,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, yaml.dump(out, { lineWidth: 120, noRefs: true }) + "\n", "utf-8");
console.log(`✓ visual-slots 写入: ${outPath}`);
console.log(`  - slots: ${out.slots.length}`);
console.log(`  - asset-slot-bindings: ${assetSlotBindings.length}`);

function firstExisting(...paths) {
  return paths.find((p) => existsSync(p)) ?? null;
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

function defaultSlotId(entity) {
  return `entity.${String(entity).replace(/[^a-zA-Z0-9_.-]+/g, "-")}.primary`;
}

function semanticSlotFor(binding, visualPrimitive) {
  if (visualPrimitive === "color-block") return "color-block";
  if (visualPrimitive === "color-unit") return "colored-character";
  if (binding.role === "card-surface") return "card-surface";
  if (binding.role === "button") return "button";
  if (binding.role === "panel") return "panel";
  return String(binding.role ?? visualPrimitive ?? "core-visual");
}

function renderZoneFor(binding) {
  const role = String(binding.role ?? "");
  if (/hud|score|timer|icon/.test(role)) return "hud";
  if (/button|panel|card/.test(role)) return "ui";
  if (/background/.test(role)) return "scene";
  return "playfield";
}

function stateDrivenFieldsFor(binding) {
  const colorSource = String(binding["color-source"] ?? "");
  const m = colorSource.match(/^entity\.([a-zA-Z0-9_.-]+)$/);
  return m ? [m[1]] : [];
}

function disallowedKindsFor(visualPrimitive) {
  if (visualPrimitive === "color-block") return ["coin", "gem", "terrain-tile", "button", "sprite"];
  if (visualPrimitive === "ui-button") return ["terrain-tile", "sprite"];
  return [];
}
