/**
 * _profile_anti_cheat.js — profile eval 反作弊规则
 *
 * 被 check_playthrough.js 调用。profile 只能驱动 UI；禁止写结果、补 trace、调 probes。
 * 参见 plan P0.1 + P0.3 Mini Design。
 */

export const ANTI_CHEAT_PATTERNS = [
  { re: /force(?:Win|Lose|Pass|Fail)\s*\(/i,                 kind: "forceWin/forceLose 直接定判定" },
  { re: /window\.gameState\s*=/,                             kind: "整体替换 gameState" },
  { re: /window\.gameState\.[\w.]+\s*=/,                     kind: "直接改 gameState 字段" },
  { re: /Object\.assign\s*\(\s*window\.gameState/,           kind: "Object.assign 批量改 gameState" },
  { re: /\bstate\.(phase|status|score|win|lose|result)\s*=/, kind: "直接改 state 核心字段" },
  { re: /window\.__trace\.push\s*\(/,                        kind: "补 __trace 伪造执行证据" },
  { re: /window\.__trace\s*=/,                               kind: "整体替换 __trace" },
  { re: /window\.gameTest\.probes\./,                        kind: "profile 调用 probes（只允许 check_runtime_semantics 使用）" },
];

/**
 * 扫描一条 assertion 的 setup 步骤，返回命中的反作弊 hit 列表。
 * 每个 hit: { kind, pattern, match }
 */
export function detectAntiCheatHits(assertion) {
  const hits = [];
  for (const s of assertion?.setup ?? []) {
    if (s.action !== "eval") continue;
    const code = String(s.js ?? s.code ?? "");
    for (const { re, kind } of ANTI_CHEAT_PATTERNS) {
      const m = re.exec(code);
      if (m) hits.push({ kind, pattern: re.source, match: m[0] });
    }
  }
  return hits;
}
