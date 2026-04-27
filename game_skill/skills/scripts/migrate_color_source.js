#!/usr/bin/env node
/**
 * migrate_color_source.js — 一次性迁移：为 color-block / color-unit / colorable-token
 * 缺 color-source 的 assets.yaml / implementation-contract.yaml 条目补一行 color-source。
 *
 * 用法:
 *   node migrate_color_source.js cases/pixel_canvas
 *   node migrate_color_source.js cases/pixel_canvas --dry
 *
 * 策略：
 *   默认 color-source 值为 "entity.color"。
 *   只处理 P0.4 标识为"需要 color-source"的三个 slot: color-block / color-unit / colorable-token。
 *   逐行扫描 YAML，不解析也不重写格式——在 "visual-primitive: X" 下一行若无 color-source 就插一行。
 *
 * 产物：原地修改；--dry 打印要改的行不写回。
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { requiresColorSource } from "./_visual_primitive_enum.js";

const args = process.argv.slice(2);
const caseDir = resolve(args[0] ?? ".");
const dryRun = args.includes("--dry");

const TARGETS = [
  "specs/assets.yaml",
  "specs/implementation-contract.yaml",
];

let totalPatched = 0;

for (const rel of TARGETS) {
  const path = join(caseDir, rel);
  if (!existsSync(path)) continue;
  const src = readFileSync(path, "utf-8");
  const lines = src.split(/\r?\n/);
  const out = [];
  let patched = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);

    const m = /^(\s+)visual-primitive:\s*"?([\w-]+)"?\s*$/.exec(line);
    if (!m) continue;
    const indent = m[1];
    const slot = m[2];
    if (!requiresColorSource(slot)) continue;

    // 查看相邻的同缩进兄弟行，看有没有 color-source
    let hasColorSource = false;
    for (let j = i + 1; j < lines.length; j++) {
      const sib = lines[j];
      if (sib.trim() === "") continue;
      const sibIndent = /^(\s*)/.exec(sib)[1];
      // 同缩进级别且仍在本条目内
      if (sibIndent.length < indent.length) break;
      // 遇到新条目（- id:）也停
      if (/^\s*-\s+/.test(sib)) break;
      if (new RegExp(`^${indent}color-source:`).test(sib)) {
        hasColorSource = true;
        break;
      }
      if (sibIndent.length > indent.length) continue;
    }

    if (!hasColorSource) {
      out.push(`${indent}color-source: entity.color`);
      patched++;
    }
  }

  if (patched > 0) {
    console.log(`${rel}: ${patched} 行补 color-source: entity.color`);
    if (!dryRun) writeFileSync(path, out.join("\n"), "utf-8");
    totalPatched += patched;
  } else {
    console.log(`${rel}: 无需修改`);
  }
}

if (totalPatched === 0) {
  console.log("✓ 无待补条目");
} else {
  console.log(`${dryRun ? "[dry-run] 将补" : "✓ 已补"}充 ${totalPatched} 行`);
}
