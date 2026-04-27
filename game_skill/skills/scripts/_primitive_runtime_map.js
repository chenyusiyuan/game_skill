/**
 * _primitive_runtime_map.js — single source of truth for the P1.1 runtime library
 *
 * Maps mechanics primitive id (as used in mechanics.yaml `primitive:` field)
 * to the runtime API function names business code must import.
 *
 * Consumed by:
 *   - check_implementation_contract.js (P1.4 gate: canvas/pixijs must import these)
 *   - future codegen tooling that materializes the runtime wiring
 *
 * Engine scope:
 *   P1 only enforces runtime imports on engines in ENFORCED_ENGINES.
 *   Others remain in transition (LLM hand-writes, until P2 lands per-engine runtimes).
 */

export const ENFORCED_ENGINES = Object.freeze(["canvas", "pixijs"]);

/**
 * Keys are primitive ids as they appear in mechanics.yaml.
 * Values are the set of public API names exported from
 * engines/_common/primitives/index.mjs. Business code must import at least
 * ONE of them for a mechanics node whose primitive matches.
 *
 * Keep in sync with references/engines/_common/primitives/index.mjs.
 */
export const PRIMITIVE_RUNTIME_API = Object.freeze({
  "parametric-track@v1": ["tickTrack", "positionAt"],
  "grid-step@v1": ["gridMove"],
  "ray-cast@v1": ["rayCastGrid", "rayCastGridFirstHit"],
  "grid-board@v1": ["addCell", "removeCell"],
  "neighbor-query@v1": ["queryNeighbors"],
  "predicate-match@v1": ["predicateMatch"],
  "resource-consume@v1": ["consumeResource"],
  "fsm-transition@v1": ["fireTrigger"],
  "win-lose-check@v1": ["checkWinLose"],
  "score-accum@v1": ["accumulateScore"],
});

/**
 * Primitive ids for which the runtime library is available in P1.1.
 * Used by callers to distinguish "enforced" vs "still LLM-hand-written" primitives.
 */
export const RUNTIME_BACKED_PRIMITIVES = Object.freeze(
  Object.keys(PRIMITIVE_RUNTIME_API),
);

export function isRuntimeBacked(primitiveId) {
  return Object.prototype.hasOwnProperty.call(PRIMITIVE_RUNTIME_API, primitiveId);
}

export function apisFor(primitiveId) {
  return PRIMITIVE_RUNTIME_API[primitiveId] ?? [];
}

export function isEngineEnforced(engine) {
  return ENFORCED_ENGINES.includes(String(engine || "").toLowerCase());
}

/**
 * Parse ES module imports from a single-file source blob (concatenated ok).
 *
 * Returns [{ specifier, names: [string] }]:
 *   - specifier: the raw string after `from` (e.g. './_common/primitives/index.mjs')
 *   - names: imported identifiers
 *
 * Handles:
 *   import { a, b as c } from 'x';
 *   import * as ns from 'x';       // ns -> '*'
 *   import def from 'x';           // def -> 'default'
 *   import def, { a } from 'x';
 *
 * Ignores dynamic `import()`, CommonJS require(), and comments/strings pitfalls
 * (good-enough for our checker — business code is ESM).
 */
export function parseEsmImports(source) {
  const out = [];
  const re =
    /^\s*import\s+(?:([\w$]+)\s*,\s*)?(\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)?\s*(?:from\s*)?["']([^"']+)["']\s*;?/gm;
  // Fallback simple regex: match any `import ... from '...'`
  const blocks = [
    // import { a, b } from 'x'
    /^\s*import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["']\s*;?/gm,
    // import def, { a } from 'x'
    /^\s*import\s+([\w$]+)\s*,\s*\{([^}]*)\}\s+from\s+["']([^"']+)["']\s*;?/gm,
    // import def from 'x'
    /^\s*import\s+([\w$]+)\s+from\s+["']([^"']+)["']\s*;?/gm,
    // import * as ns from 'x'
    /^\s*import\s+\*\s+as\s+([\w$]+)\s+from\s+["']([^"']+)["']\s*;?/gm,
    // import 'x'  (side-effect only)
    /^\s*import\s+["']([^"']+)["']\s*;?/gm,
  ];
  // named
  for (const m of source.matchAll(blocks[0])) {
    const names = splitBindings(m[1]);
    out.push({ specifier: m[2], names });
  }
  // default + named
  for (const m of source.matchAll(blocks[1])) {
    const names = ["default", ...splitBindings(m[2])];
    out.push({ specifier: m[3], names });
  }
  // default
  for (const m of source.matchAll(blocks[2])) {
    out.push({ specifier: m[2], names: ["default"] });
  }
  // namespace
  for (const m of source.matchAll(blocks[3])) {
    out.push({ specifier: m[2], names: ["*"] });
  }
  // side-effect
  for (const m of source.matchAll(blocks[4])) {
    out.push({ specifier: m[1], names: [] });
  }
  // Silence eslint unused var (kept to document intent)
  void re;
  return out;
}

function splitBindings(inner) {
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
      return m ? m[1] : s;
    });
}

/**
 * True iff the specifier resolves to engines/_common/primitives/*
 * Matches:
 *   './_common/primitives/index.mjs'
 *   '../_common/primitives/index.mjs'
 *   '../../_common/primitives/ray-cast.runtime.mjs'
 *   '../_common/primitives/resource-consume.runtime.mjs'
 */
export function isPrimitivesImport(specifier) {
  return /(^|\/)_common\/primitives\/(index|[\w-]+\.runtime)\.mjs$/.test(specifier);
}
