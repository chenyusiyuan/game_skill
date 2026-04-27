# Case Manifest

Copied on: 2026-04-27

## Included Case Snapshots

| Folder | Source | Notes |
|---|---|---|
| `case_snapshots/pixel_canvas` | `/Users/bytedance/Project/game_skill/cases/pixel_canvas` | Current Canvas failing case snapshot |
| `case_snapshots/pixel_dom_ui` | `/Users/bytedance/Project/game_skill/cases/pixel_dom_ui` | Current DOM UI failing case snapshot |
| `case_snapshots/pixel_pixijs` | `/Users/bytedance/Project/game_skill/cases/pixel_pixijs` | Current PixiJS failing case snapshot |
| `case_snapshots/pixel_phaser` | `/Users/bytedance/Project/game_skill/cases/pixel_phaser` | Current Phaser failing case snapshot |

## Included Profiles

| Profile | Source |
|---|---|
| `profiles/pixel_canvas-001.json` | `game_skill/skills/scripts/profiles/pixel_canvas-001.json` |
| `profiles/pixel_dom_ui.json` | `game_skill/skills/scripts/profiles/pixel_dom_ui.json` |
| `profiles/pixel_pixijs.json` | `game_skill/skills/scripts/profiles/pixel_pixijs.json` |
| `profiles/pixel_phaser.json` | `game_skill/skills/scripts/profiles/pixel_phaser.json` |

## Notes

- Chat screenshots are not included because they were provided in the conversation UI rather than as local files.
- Raw Claude JSONL logs are not copied in full. See `claude_history_key_snippets.md` for the extracted key content and source session IDs.
- The repo `.gitignore` ignores directories named `cases/`, so the copied evidence uses `case_snapshots/` to remain trackable without forcing ignored files.
