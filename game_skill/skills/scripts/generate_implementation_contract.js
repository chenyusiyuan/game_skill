#!/usr/bin/env node
/**
 * generate_implementation_contract.js
 *
 * 从 Phase 3 已展开的 scene/assets/event-graph 等 specs 生成
 * specs/implementation-contract.yaml。它是 Expand -> Codegen 之间的硬契约：
 * - UI/素材语义绑定
 * - 本地素材是否必须真实渲染
 * - 引擎生命周期要求
 * - Verify 需要观测的 runtime 证据
 *
 * 用法:
 *   node generate_implementation_contract.js <case-dir>
 *   node generate_implementation_contract.js <case-dir> --out specs/.pending/implementation-contract.yaml
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import yaml from "js-yaml";
import { readAssetStrategy } from "./_asset_strategy.js";

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0
  ? resolve(caseDir, args[outIdx + 1])
  : join(caseDir, "specs/implementation-contract.yaml");

const specsDir = join(caseDir, "specs");
const scenePath = firstExisting(
  join(specsDir, "scene.yaml"),
  join(specsDir, ".pending/scene.yaml")
);
const assetsPath = firstExisting(
  join(specsDir, "assets.yaml"),
  join(specsDir, ".pending/assets.yaml")
);
const prdPath = join(caseDir, "docs/game-prd.md");
const strategy = readAssetStrategy(caseDir);
const assetless = strategy.mode === "none";

if (!scenePath || (!assetsPath && !assetless)) {
  console.error("✗ 需要先存在 specs/scene.yaml 和 specs/assets.yaml（或 specs/.pending/ 对应文件）；asset-strategy.mode=none 可省略 assets.yaml");
  process.exit(1);
}

const sceneRaw = readFileSync(scenePath, "utf-8");
const assetsRaw = assetsPath ? readFileSync(assetsPath, "utf-8") : "";
const prdRaw = existsSync(prdPath) ? readFileSync(prdPath, "utf-8") : "";

let sceneSpec;
let assetsSpec;
try {
  sceneSpec = yaml.load(sceneRaw) ?? {};
  assetsSpec = assetsRaw ? (yaml.load(assetsRaw) ?? {}) : {};
} catch (e) {
  console.error(`✗ specs yaml 解析失败: ${e.message}`);
  process.exit(1);
}

const runtime = inferRuntime({ assetsRaw, assetsSpec, prdRaw });
const runMode = defaultRunMode(runtime);
const boot = normalizeBoot(sceneSpec["boot-contract"] ?? {});
const bindings = assetless ? [] : collectAssetBindings(assetsSpec, strategy);

const contract = {
  "contract-version": 1,
  runtime: {
    engine: runtime,
    "run-mode": runMode,
  },
  boot,
  "asset-bindings": bindings,
  "engine-lifecycle": lifecycleFor(runtime),
  verification: {
    "required-runtime-evidence": assetless
      ? ["gameState-exposed"]
      : [
          "gameState-exposed",
          "no-project-asset-http-errors",
          "required-local-assets-loaded",
          "required-local-assets-consumed",
        ],
    "required-test-hooks": ["clickStartButton"],
    "report-policy": "verifier-json-only",
  },
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, yaml.dump(contract, { lineWidth: 120, noRefs: true }) + "\n", "utf-8");
console.log(`✓ implementation contract 写入: ${outPath}`);
console.log(`  - runtime: ${runtime} (${runMode})`);
console.log(`  - asset-bindings: ${bindings.length}`);

function firstExisting(...paths) {
  return paths.find((p) => existsSync(p)) ?? null;
}

function inferRuntime({ assetsRaw, assetsSpec, prdRaw }) {
  const fromSpec = assetsSpec.runtime || assetsSpec.engine || null;
  if (fromSpec) return String(fromSpec).trim();
  const fromAssetsComment = assetsRaw.match(/^\s*#?\s*runtime:\s*([a-z0-9-]+)/mi)?.[1];
  if (fromAssetsComment) return fromAssetsComment.trim();
  const fromPrd = prdRaw.match(/^runtime:\s*([a-z0-9-]+)/m)?.[1] ||
    prdRaw.match(/engine-plan:[\s\S]*?runtime:\s*([a-z0-9-]+)/m)?.[1];
  if (fromPrd) return fromPrd.trim();
  return "canvas";
}

function defaultRunMode(runtime) {
  if (["phaser3", "phaser", "pixijs", "pixi", "three"].includes(runtime)) return "local-http";
  return "file";
}

function normalizeBoot(raw) {
  const transitions = Array.isArray(raw["scene-transitions"]) ? raw["scene-transitions"] : [];
  return {
    "entry-scene": raw["entry-scene"] ?? "start",
    "ready-condition": raw["ready-condition"] ?? "window.gameState !== undefined",
    "start-action": raw["start-action"] ?? { trigger: "auto", target: null, result: "phase -> playing" },
    "scene-transitions": transitions,
  };
}

function collectAssetBindings(spec, strategy) {
  const out = [];
  // generated-only 模式下，生成类型也可以 must-render=true（只要 binding-to 指向 core-entity）
  const allowGeneratedMustRender = strategy?.mode === "generated-only";
  for (const section of ["images", "spritesheets", "audio", "fonts"]) {
    const list = Array.isArray(spec[section]) ? spec[section] : [];
    for (const item of list) {
      const id = item.id ?? item.family;
      if (!id) continue;
      const source = item.source ?? "";
      const type = normalizeType(item.type, source, section);
      const role = inferRole({ id, usage: item.usage, source, section });
      const kind = inferAssetKind({ id, usage: item.usage, source, section, type });
      const isOptionalState = /hover|悬停|outline|empty|备用|fallback|backup/i.test(`${id} ${item.usage ?? ""}`);
      const isDecorativeRole = ["particle", "hud-indicator", "decorative"].includes(role);
      const bindingTo = item["binding-to"] ?? null;
      const hasRealBinding = bindingTo && bindingTo !== "decor";
      // library-first: 只有 local-file + 真 binding 才 must-render
      // generated-only: generated/local-file 都可以 must-render（只要有真 binding）
      const typeAllowed = allowGeneratedMustRender
        ? (type === "local-file" || type === "graphics-generated" || type === "inline-svg")
        : (type === "local-file");
      const mustRender = typeAllowed && section !== "fonts" && !isOptionalState && hasRealBinding;
      out.push({
        id: String(id),
        section,
        role,
        "asset-kind": kind,
        type,
        source: source || type,
        "binding-to": bindingTo,
        "render-as": inferRenderAs(section, type, role),
        "text-bearing": isTextBearing(role),
        "must-render": mustRender,
        "allow-fallback": !mustRender,
        consumer: inferConsumer(section, type),
      });
    }
  }
  return out;
}

function normalizeType(type, source, section) {
  if (type === "generated") return section === "audio" ? "synthesized" : "graphics-generated";
  if (type) return String(type);
  if (/^assets\/library_(?:2d|3d)\//.test(source)) return "local-file";
  if (source === "inline-svg") return "inline-svg";
  if (source === "synthesized") return "synthesized";
  if (source === "generated") return "graphics-generated";
  return "unknown";
}

function inferRole({ id, usage, source, section }) {
  const text = `${id} ${usage ?? ""}`.toLowerCase();
  if (section === "audio") return /bgm|music|背景音乐/.test(text) ? "background-music" : "audio-feedback";
  if (section === "fonts") return "font";
  if (/particle|粒子/.test(text)) return "particle";
  if (/btn|button|按钮/.test(text)) return "button";
  if (/card.*(bg|background)|卡片.*(背景|底)|单词.*(背景|底)/.test(text)) return "card-surface";
  if (/selected|matched|选中|匹配/.test(text) && /card|卡片/.test(text)) return "card-state-surface";
  if (/panel|window|dialog|面板|弹窗/.test(text)) return "panel";
  if (/hud|timer|score|combo|icon|star|heart|图标|星/.test(text)) return "hud-indicator";
  if (/background|bg|背景/.test(text)) return "scene-background";
  return "decorative";
}

function inferAssetKind({ id, usage, source, section, type }) {
  const text = `${id} ${usage ?? ""} ${source ?? ""}`.toLowerCase();
  const file = basename(source).toLowerCase();
  if (type === "graphics-generated") return "generated-surface";
  if (type === "inline-svg") return "svg";
  if (section === "audio") return "audio";
  if (section === "fonts") return "font";
  if (/\/buttons\//.test(source) || /^button_/.test(file) || /button|按钮/.test(text)) return "button";
  if (/icon|\/hud\/|star|heart|trophy|award|图标|星/.test(text)) return "icon";
  if (/particle|粒子/.test(text)) return "particle";
  if (/panel|window|frame|面板/.test(text)) return "panel";
  if (/tile_|\/tiles\//.test(text)) return "tile";
  if (/character|player|enemy/.test(text)) return "sprite";
  return "image";
}

function inferRenderAs(section, type, role) {
  if (section === "audio") return "audio";
  if (section === "fonts") return "font-face";
  if (type === "graphics-generated") return "procedural-surface";
  if (role === "particle") return "particle-texture";
  if (role === "scene-background") return "background-texture";
  return "texture";
}

function isTextBearing(role) {
  return ["card-surface", "card-state-surface", "panel"].includes(role);
}

function inferConsumer(section, type) {
  if (type !== "local-file") return null;
  if (section === "audio") return "registry.getAudio";
  if (section === "fonts") return "css.font-face";
  return "registry.getTexture";
}

function lifecycleFor(runtime) {
  if (runtime === "phaser3" || runtime === "phaser") {
    return {
      "asset-loading": "queue-in-preload",
      "forbid": ["scene.load.start-in-create", "missing-texture-as-success", "silent-asset-fallback"],
    };
  }
  if (runtime === "pixijs" || runtime === "pixi") {
    return {
      "asset-loading": "await-before-render",
      "forbid": ["silent-asset-fallback", "string-reference-only"],
    };
  }
  return {
    "asset-loading": "before-first-render",
    "forbid": ["silent-asset-fallback", "string-reference-only"],
  };
}
