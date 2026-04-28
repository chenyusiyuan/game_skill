/**
 * _primitive_runtime_map.js — single source of truth for the P1.1 runtime library
 *
 * Maps mechanics primitive id (as used in mechanics.yaml `primitive:` field)
 * to the runtime API function names business code must import.
 *
 * Consumed by:
 *   - check_implementation_contract.js (P1.4 gate: enrolled engines must import these)
 *   - future codegen tooling that materializes the runtime wiring
 *
 * Engine scope:
 *   Runtime wrappers are engine-agnostic (pure JS + trace push), but not every
 *   primitive is semantically applicable to every renderer. DOM UI has no
 *   native positional canvas/world model, so only logic/resource/state/lifecycle
 *   primitives are mandatory there. Spatial/motion primitives stay handwritten
 *   until an engine-specific runtime exists.
 */

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
  "slot-pool@v1": ["bindSlot", "unbindSlot"],
  "capacity-gate@v1": ["requestCapacity", "releaseCapacity"],
  "entity-lifecycle@v1": ["transitionLifecycle"],
  "cooldown-dispatch@v1": ["requestDispatch"],
});

export const FULL_RUNTIME_PRIMITIVES = Object.freeze(Object.keys(PRIMITIVE_RUNTIME_API));

export const DOM_UI_RUNTIME_PRIMITIVES = Object.freeze([
  "predicate-match@v1",
  "resource-consume@v1",
  "fsm-transition@v1",
  "win-lose-check@v1",
  "score-accum@v1",
  "slot-pool@v1",
  "capacity-gate@v1",
  "entity-lifecycle@v1",
  "cooldown-dispatch@v1",
]);

/**
 * Data-table for engine-aware primitive applicability.
 *
 * canvas/pixijs/phaser3 run 2D game loops with explicit geometry and can use
 * the full P1 runtime set. dom-ui only enforces pure logic/resource/progression
 * and lifecycle primitives; geometry/motion remain business-code specific.
 * three is intentionally absent until the 3D gap audit enrolls its logic subset.
 */
export const ENGINE_RUNTIME_PRIMITIVES = Object.freeze({
  canvas: FULL_RUNTIME_PRIMITIVES,
  pixijs: FULL_RUNTIME_PRIMITIVES,
  pixi: FULL_RUNTIME_PRIMITIVES,
  phaser3: FULL_RUNTIME_PRIMITIVES,
  phaser: FULL_RUNTIME_PRIMITIVES,
  "dom-ui": DOM_UI_RUNTIME_PRIMITIVES,
  dom: DOM_UI_RUNTIME_PRIMITIVES,
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
  return applicablePrimitivesFor(engine).size > 0;
}

export function applicablePrimitivesFor(engine) {
  const key = String(engine || "").toLowerCase();
  return new Set(ENGINE_RUNTIME_PRIMITIVES[key] ?? []);
}

export function isPrimitiveApplicableToEngine(primitiveId, engine) {
  return applicablePrimitivesFor(engine).has(primitiveId);
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
