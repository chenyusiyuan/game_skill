# Pixel Flow Problem Case Evidence Pack

This folder captures the failing Pixel Flow generation cases and the current root-cause analysis for follow-up LLM review.

## Contents

- `case_snapshots/pixel_canvas/`: full snapshot of the current Canvas case.
- `case_snapshots/pixel_dom_ui/`: full snapshot of the current DOM UI case.
- `case_snapshots/pixel_pixijs/`: full snapshot of the current PixiJS case.
- `case_snapshots/pixel_phaser/`: full snapshot of the current Phaser case.
- `profiles/`: current related playthrough profiles copied from `game_skill/skills/scripts/profiles/`.
- `analysis_report.md`: problem symptoms, code evidence, and chain-level diagnosis.
- `claude_history_key_snippets.md`: key Claude Code session claims and contradictory validation evidence.

## Why This Exists

Manual playability review found that none of the new Pixel Flow cases is basically acceptable:

- Canvas: pig attack does not reliably happen; retry/resource behavior is broken.
- DOM UI: pig attack range is wrong; bottom/left visual direction is reversed.
- PixiJS: waiting pig disappears after click and does not enter the conveyor; verification report is failed.
- Phaser: dead pig visual can remain; attack appears to trigger from wrong/diagonal positions.

The important finding is that these are not isolated renderer bugs. The chain allows wrong mechanics contracts, weak runtime assertions, and green hand-written delivery reports to pass as if the game were playable.

## Commit Note

When committing the broader fix branch, include this folder in addition to existing code changes so other LLMs can inspect the exact failing artifacts.
