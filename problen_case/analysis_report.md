# Pixel Flow Problem Case Analysis

Date: 2026-04-27

## Executive Verdict

The current Pixel Flow generation chain is not playability-complete. It can produce structured specs, contracts, assets, profiles, and reports, but it still fails to guarantee that the generated game is basically playable.

The strongest evidence is that manual review found severe gameplay failures across Canvas, DOM UI, PixiJS, and Phaser. The failures share chain-level causes:

1. The mechanics contract uses the wrong trigger for grid-position attacks.
2. Runtime visual position and logical grid position can diverge.
3. Verification can be bypassed by weak profiles, missing runtime probes, and hand-written green reports.
4. Symbolic mechanics checks pass static invariants without proving live movement -> attack -> block removal.

## Problem Cases

### Canvas: `cases/pixel_canvas`

Observed symptoms:

- Start page button visual is missing or not loaded correctly in the manual screenshot.
- Pig movement is too fast.
- Red pig removed a red block that should not have been reachable from its current conveyor position.
- Level resources are insufficient to clear the board.
- Retry returns immediately to the result screen because resources/state are not reset.

Code evidence:

- Copied mechanics file: `problen_case/case_snapshots/pixel_canvas/specs/mechanics.yaml`
- `conveyor-track` only produces `track.enter-segment` and `track.loop-complete`.
- `attack-raycast` is triggered by `track.enter-segment`.
- Copied implementation: `problen_case/case_snapshots/pixel_canvas/game/index.html`
- The update loop attacks only inside `if (prevSegmentId !== pig.segmentId)`, so the pig attacks on side changes rather than at every grid-aligned attack position.

Why this matters:

Pixel Flow requires attack checks whenever the pig passes a board-aligned position on a side. Segment transition means only four attack opportunities per loop, not one per row/column alignment.

### DOM UI: `cases/pixel_dom_ui`

Observed symptoms:

- Pig attack range is wrong.
- Bottom and left direction/position appear reversed.
- Earlier automated loops got stuck in repeated modify/test/fail cycles.

Code evidence:

- Copied mechanics file: `problen_case/case_snapshots/pixel_dom_ui/specs/mechanics.yaml`
- It repeats the same root issue: `attack-raycast trigger-on: [track.enter-segment]`.
- Copied implementation: `problen_case/case_snapshots/pixel_dom_ui/game/index.html`
- `getGridPosition()` already reverses bottom and left:
  - bottom maps to `col: cols - 1 - floor(progress * cols)`
  - left maps to `row: rows - 1 - floor(progress * rows)`
- `renderPigs()` reverses bottom and left again:
  - bottom uses `(cols - 1 - col)`
  - left uses `(rows - 1 - row)`

Why this matters:

The game displays one apparent pig position but raycast uses a different logical grid projection. This directly explains wrong attack range and bottom/left inversion.

### PixiJS: `cases/pixel_pixijs`

Observed symptoms:

- Clicking a waiting pig makes it disappear.
- It does not appear on the conveyor.
- Other pigs become unclickable or the game becomes inert.
- Resources are still not sufficient or not validated as a real playable solution.

Verification evidence:

- Copied report: `problen_case/case_snapshots/pixel_pixijs/eval/report.json`
- This one is a real `verify_all.js` report and it fails.
- Failed areas include:
  - mechanics: `event-graph.yaml` missing `modules[]`
  - project: missing rule trace calls for multiple rules
  - playthrough: missing `--profile`
  - asset runtime: must-render assets missing runtime evidence
  - runtime semantics: missing probes and no replayable primitive trace

Why this matters:

PixiJS proves that when the newer verifier is actually run, it can catch major failures. The broader chain problem is that other cases still present green reports without the same verification standard.

### Phaser: `cases/pixel_phaser`

Observed symptoms:

- Dead pig visual does not reliably disappear.
- Attack range appears wrong; manual review described it as only diagonal positions attacking.

Code evidence:

- Copied mechanics file: `problen_case/case_snapshots/pixel_phaser/specs/mechanics.yaml`
- It also uses `attack-raycast trigger-on: [track.enter-segment]`.
- Copied implementation: `problen_case/case_snapshots/pixel_phaser/game/src/scenes/PlayScene.js`
- `updateConveyorPigs()` updates `pig.gridPosition` only when `oldSegmentId !== newSegmentId`.
- `onEnterSegment()` then raycasts based on that segment transition.
- `getGridPositionFromT()` converts world track coordinates into board row/col with `Math.floor((x - BOARD_OFFSET_X) / CELL_SIZE)`, which can produce out-of-grid or edge-derived coordinates depending on exact track geometry.
- Exhausted pigs use a fade-out effect with `destroyOnEnd: false` in one branch before actual conveyor removal, leaving room for visual lifecycle mismatch.

Why this matters:

The Phaser case demonstrates that even a real `verify_all.js` report can pass many structural checks while failing product-level playability because the profile and runtime semantics checks do not assert concrete visual/logical outcomes.

## Shared Root Cause

### 1. Wrong Event Contract

The copied cases all encode position-based attack as:

```yaml
attack-raycast:
  trigger-on: [track.enter-segment]
```

But the gameplay needs:

```yaml
attack-raycast:
  trigger-on: [track.attack-position]
```

or an equivalent event emitted every time the pig enters a board-aligned attack coordinate.

The reference reducer already has the right primitive event:

- `game_skill/skills/references/mechanics/motion/parametric-track.reducer.mjs`
- It emits `track.attack-position` when `attackPositionKey` changes.

But both agent examples still show the wrong pattern:

- `game_skill/agents/mechanic-decomposer.md`
- `.claude/agents/mechanic-decomposer.md`

Both examples use:

```yaml
produces-events: [track.enter-segment, track.loop-complete]
...
trigger-on: [track.enter-segment]
```

This means Codegen is following an upstream bad example rather than randomly making a renderer mistake.

### 2. Symbolic Mechanics Does Not Prove Live Cadence

The mechanics checker can pass because it verifies static mapping and selected symbolic scenarios, but it does not prove:

- track movement emits attack opportunities at every grid-aligned side position;
- each emitted attack position triggers exactly one raycast;
- raycast target matches the visible pig projection;
- a matching first target causes block hp/alive/state and visual removal to change.

This is why `track.enter-segment` can survive validation even though it is too coarse for the game.

### 3. Runtime Visual-Logic Consistency Is Missing

The DOM UI double-reversal is the clearest example:

- logic grid projection is reversed for bottom/left;
- render projection reverses again;
- raycast uses logic while the player sees render.

The current chain needs a runtime assertion that visible pig position, `pig.gridPosition`, and raycast start cell are mutually consistent.

### 4. Reports Can Be Green Without Being `verify_all.js`

Canvas and DOM UI reports have custom/hand-written shapes and do not declare `generated_by: verify_all.js`.

PixiJS and Phaser reports use `verify_all.js`; PixiJS fails clearly, while Phaser still exposes gaps in profile/runtime coverage.

Accepting non-`verify_all` green reports makes the final delivery status unreliable.

### 5. Profiles Are Not Strong Product Tests

The copied profiles are useful as interaction scaffolds, but they do not consistently prove:

- a click deploys a pig onto the conveyor;
- the displayed pig aligns with its grid position;
- one pass over an attack position produces one raycast;
- a matching first target loses hp or disappears;
- an unreachable target remains alive;
- resources are sufficient for at least one start-to-win sequence;
- retry fully resets resources and board state.

Without these assertions, manual playability can fail while automated checks still look mostly green.

## Recommended Next Fix Direction

Do not patch individual generated games first. Fix the chain contract and gates.

Priority order:

1. Change mechanic decomposition examples and hard checks so grid-projected `parametric-track@v1 + ray-cast@v1` uses `track.attack-position`, not `track.enter-segment`.
2. Add a mechanics checker rule: if `ray-cast.coord-system = grid` and source is a grid-projected track, then `track.enter-segment` is not an acceptable attack trigger.
3. Add a runtime visual-logic gate: pig visual position, `gridPosition`, segment direction, and raycast first-hit cell must match.
4. Make `verify_all.js` report the only acceptable eval report format for generated cases.
5. Strengthen playthrough profiles with real product assertions, including at least one start-to-win sequence without `forceWin()`.
6. Add balance/playability gate: resource supply must not merely exceed hp demand; it must be solvable under first-hit/no-penetration/order constraints.
