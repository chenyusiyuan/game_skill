/**
 * registry.spec.js — 素材注册表 共享接口
 *
 * 目的：把"assets.yaml 中列出的每个素材 id → 能在代码里按 id 取用"
 * 这件事从 LLM 手写（经常漏 / 写错路径 / 只写一半）变成 **数据驱动**。
 *
 * 使用流程（codegen 生成的代码走这条）：
 *
 *   import { createRegistry } from './adapters/<engine>-registry.js';
 *   const registry = await createRegistry(manifest);
 *   const tex = registry.getTexture('hero-warrior-idle');  // 引擎对应的 texture/image 对象
 *   const snd = registry.getAudio('sfx-hit');
 *
 * manifest 结构（由 scripts/generate_registry.js 从 assets.yaml 产出，JSON 传参）：
 *
 *   {
 *     "basePath": "../../../assets/library_2d",    // 相对于 game/ 的素材库路径
 *     "images": [
 *       { "id": "hero-warrior-idle", "type": "local-file", "src": "tiles/dungeon/tile_0030.png" },
 *       { "id": "skill-fireball",    "type": "inline-svg",  "svg": "<svg>...</svg>" },
 *       { "id": "placeholder-box",   "type": "graphics-generated", "draw": {...} }
 *     ],
 *     "spritesheets": [
 *       { "id": "player-sheet", "type": "local-file", "src": "...", "frameWidth": 32, "frameHeight": 32 }
 *     ],
 *     "audio": [
 *       { "id": "sfx-hit", "type": "local-file", "src": "audio/sfx/hit.ogg" },
 *       { "id": "bgm-dungeon", "type": "synthesized", "params": {...} }
 *     ]
 *   }
 *
 * 每个引擎 adapter 必须实现下列 "createRegistry" 签名：
 *
 *   export async function createRegistry(manifest): Promise<Registry>
 *
 *   Registry = {
 *     getTexture(id: string): EngineTexture | null,
 *     getSpritesheet(id: string): EngineSpritesheet | null,
 *     getAudio(id: string): EngineAudio | null,
 *     has(id: string): boolean,
 *     // diagnostics
 *     stats(): { total: number, loaded: number, missing: string[] },
 *   }
 *
 * 标准错误行为：
 * - 未知 id：返回 null 并在 console.warn 里打 `[registry] missing id: <id>`
 * - 路径 404：console.error 后标 missing，但仍返回 null（不抛），由调用方决定降级方式
 *
 * 这个文件本身不含实现，只定义接口 + 一个参数校验工具。
 */

export const SUPPORTED_TYPES = ["local-file", "inline-svg", "graphics-generated", "synthesized"];

/**
 * 校验 manifest 结构。返回 { ok, errors }。
 * adapter 在 createRegistry 入口调它，发现结构错误就立即 throw，而不是静默降级。
 */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, errors: ["manifest 必须是对象"] };
  }
  if (typeof manifest.basePath !== "string") {
    errors.push("manifest.basePath 必须是字符串");
  }
  for (const section of ["images", "spritesheets", "audio"]) {
    if (manifest[section] && !Array.isArray(manifest[section])) {
      errors.push(`manifest.${section} 必须是数组`);
    }
    for (const [i, item] of (manifest[section] ?? []).entries()) {
      if (!item.id) errors.push(`${section}[${i}] 缺 id`);
      if (!SUPPORTED_TYPES.includes(item.type)) {
        errors.push(`${section}[${i}] type 非法: ${item.type}`);
      }
      if (item.type === "local-file" && !item.src) {
        errors.push(`${section}[${i}] type=local-file 需要 src`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 共享 stats 工具：adapter 组装好的 entries Map → 统计信息。
 */
export function buildStats(entries) {
  const total = entries.size;
  const loaded = [...entries.values()].filter(v => v.loaded).length;
  const missing = [...entries.entries()]
    .filter(([, v]) => !v.loaded)
    .map(([k]) => k);
  return { total, loaded, missing };
}
