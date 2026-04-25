#!/usr/bin/env node
/**
 * generate_registry.js — 从 specs/assets.yaml 生成 registry manifest JSON
 *
 * 用途：codegen 阶段之前跑一次，产出 game/src/assets.manifest.json，
 * adapter 的 createRegistry(manifest) 直接吃它，无需 LLM 手写 loader 调用。
 *
 * 用法:
 *   node generate_registry.js <case-dir>
 *   node generate_registry.js <case-dir> --out <path>
 *
 * 默认输出到 <case-dir>/game/src/assets.manifest.json。若 game/src/ 不
 * 存在（canvas/dom 单文件模板）则输出到 game/assets.manifest.json。
 *
 * 退出码: 0 = OK, 1 = assets.yaml 不存在或解析失败
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? resolve(args[outIdx + 1]) : null;

const assetsYamlPath = join(caseDir, "specs/assets.yaml");
if (!existsSync(assetsYamlPath)) {
  console.error(`✗ specs/assets.yaml 不存在: ${assetsYamlPath}`);
  process.exit(1);
}

const yamlText = readFileSync(assetsYamlPath, "utf-8");
const manifest = parseAssetsYaml(yamlText);

// 默认输出路径
const finalOut = outPath || defaultOutPath(caseDir);
mkdirSync(dirname(finalOut), { recursive: true });
writeFileSync(finalOut, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
console.log(`✓ registry manifest 写入: ${finalOut}`);
console.log(`  - images: ${manifest.images.length}`);
console.log(`  - spritesheets: ${manifest.spritesheets.length}`);
console.log(`  - audio: ${manifest.audio.length}`);

// ---------------------------------------------------------------------------

function defaultOutPath(caseDir) {
  const srcDir = join(caseDir, "game/src");
  if (existsSync(srcDir)) return join(srcDir, "assets.manifest.json");
  return join(caseDir, "game/assets.manifest.json");
}

/**
 * 轻量 YAML 解析：只处理 assets.yaml 的已知结构，不引入 yaml 依赖。
 * 识别 images / spritesheets / audio 三段，每段列表里的 id / source / type /
 * svg / draw / frameWidth / frameHeight / params。
 *
 * basePath：从 game/ 回退到项目根的素材库，相对路径。
 * 2D 引擎（默认）：../../../assets/library_2d
 * Three.js 引擎（is-3d: true 或 runtime: three）：../../../assets/library_3d
 */
function parseAssetsYaml(text) {
  // 检测是否为 3D 引擎
  const is3d = /is-3d:\s*true/i.test(text) || /runtime:\s*three/i.test(text);
  const manifest = {
    basePath: is3d ? "../../../assets/library_3d" : "../../../assets/library_2d",
    images: [],
    spritesheets: [],
    audio: [],
  };

  let section = null; // "images" | "spritesheets" | "audio"
  let current = null;
  const lines = text.split("\n");

  const commit = () => {
    if (!current) return;
    const bucket = section === "spritesheets" ? manifest.spritesheets
                 : section === "audio" ? manifest.audio
                 : section === "images" ? manifest.images
                 : null;
    if (!bucket) { current = null; return; }
    const item = normalizeItem(current, section);
    if (item) bucket.push(item);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    // 识别顶层 section（0 缩进的 key:）
    const sec = line.match(/^([a-z-]+):\s*$/);
    if (sec) {
      commit();
      const name = sec[1];
      section = (name === "images" || name === "spritesheets" || name === "audio") ? name : null;
      continue;
    }

    // item 起始：2 空格缩进的 "- id: xxx"
    const itemStart = line.match(/^\s{2}-\s+id:\s*(\S+)/);
    if (itemStart && section) {
      commit();
      current = { id: itemStart[1] };
      continue;
    }

    if (!current) continue;
    // 属性行："    key: value"（4 空格缩进）
    const kv = line.match(/^\s{4}([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) {
      current[kv[1]] = kv[2].trim();
      continue;
    }
    // block scalar（svg: |\n      ...），简化处理：识别 "    svg: |" 后收缩多行
    if (/^\s{4}svg:\s*\|\s*$/.test(line)) {
      current.svg = ""; current.__collecting = "svg"; continue;
    }
    if (current.__collecting === "svg") {
      if (/^\s{6,}/.test(line)) {
        current.svg += line.replace(/^\s{6}/, "") + "\n";
        continue;
      } else {
        current.__collecting = null;
      }
    }
  }
  commit();
  return manifest;
}

function normalizeItem(raw, section) {
  let type = raw.type || inferType(raw.source);
  // 兼容旧 assets.yaml 把 type 写成 "generated"（无区分度）。按 section
  // 和是否带 svg 字段分流：audio 段默认 synthesized；images/spritesheets 段
  // 按 svg 字段存在与否分流到 inline-svg / graphics-generated。
  if (type === "generated" || type === "synthesized" && section === "images") {
    if (section === "audio") type = "synthesized";
    else type = raw.svg ? "inline-svg" : "graphics-generated";
  }
  // audio 段强制纠正：type 必须是 local-file 或 synthesized
  if (section === "audio" && type !== "local-file" && type !== "synthesized") {
    type = "synthesized";
  }
  const out = { id: raw.id, type };
  // source → src（local-file）
  if (type === "local-file" && raw.source) {
    const src = stripLibraryPrefix(raw.source);
    out.src = src;
  }
  if (type === "inline-svg") out.svg = raw.svg ?? "";
  if (type === "synthesized") out.params = raw.params ?? raw.format ?? null;
  if (raw["frame-width"] || raw.frameWidth) out.frameWidth = Number(raw["frame-width"] ?? raw.frameWidth);
  if (raw["frame-height"] || raw.frameHeight) out.frameHeight = Number(raw["frame-height"] ?? raw.frameHeight);
  // 省略无效条目（无 type 的跳过）
  if (!out.type) return null;
  return out;
}

function inferType(source) {
  if (!source) return null;
  if (/^assets\/library_(?:2d|3d)\//.test(source)) return "local-file";
  if (/^inline-svg$/.test(source)) return "inline-svg";
  if (/^synthesized$/.test(source)) return "synthesized";
  if (/^graphics-generated$/.test(source)) return "graphics-generated";
  return null;
}

function stripLibraryPrefix(src) {
  // 保留 "tiles/dungeon/tile_xxx.png" 这种相对 assets/library_2d 或 assets/library_3d 的路径
  return src.replace(/^assets\/library_(?:2d|3d)\//, "");
}
