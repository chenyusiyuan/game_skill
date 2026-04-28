# Asset Chain Baseline Audit

Date: 2026-04-28

Scope: `assets/library_2d/catalog.yaml` and `assets/library_3d/catalog.yaml`. This audit checks each pack for style/genre coverage, slot constraints (`allowed-slots` / `disallowed-slots` at pack or family level), and `semantic-tags` at pack or family level.

Notes:
- `allowed-slots` includes current checker names such as `ui-button` / `color-unit` and, where requested by the P3 prompt, future semantic aliases such as `button` / `colored-unit` / `character`.
- Mixed packs are intentionally not guessed at pack level. They are marked as needing family/frame split metadata.
- Audio and font packs are recorded as support packs; visual slot semantics do not directly apply to them.

| Library | Pack | suitable-styles / suitable-genres | allowed/disallowed slots | semantic-tags | Action / Risk |
| --- | --- | --- | --- | --- | --- |
| 2D | `ui-pack` | OK | family-level | missing | 已有 family slot；semantic-tags 仍缺，后续可按 buttons/icons/checks 细分。 |
| 2D | `ui-pixel-adventure` | OK | family-level | family-level | 本轮补按钮段 tile_0013-0021 family semantic-tags + slots；其余面板/数字/图标仍需细分。 |
| 2D | `game-icons` | OK | family-level | missing | 已有 family slot；semantic-tags 仍缺，后续可补 icon/hud-readout。 |
| 2D | `board-game-icons` | OK | family-level | missing | 已有 family slot；semantic-tags 仍缺，包内含骰子/棋子/奖杯等多语义。 |
| 2D | `sprites-platformer` | OK | missing | missing | 混合角色/敌人/地形/道具/机关，未猜 pack-level；需要 family split。 |
| 2D | `sprites-platformer-pixel` | OK | pack-level | pack-level | 本轮按 character pack 补 pack-level semantic-tags + slots。 |
| 2D | `sprites-medieval` | OK | missing | missing | 混合建筑/地形/自然/兵种，未猜 pack-level；需要 family split。 |
| 2D | `sprites-tower-defense` | OK | missing | missing | 混合塔/地形/装饰，未猜 pack-level；需要 family split。 |
| 2D | `sprites-puzzle` | OK | family-level | missing | 已有 ball/element/button family slots；semantic-tags 仍缺。 |
| 2D | `tiles-dungeon` | OK | family-level | pack-level | 已有 tile family；本轮补 dungeon semantic-tags，并加入 background-tile/target-block/button 语义别名。 |
| 2D | `tiles-town` | OK | family-level | missing | 已有 tile family；semantic-tags 仍缺，包内 NPC/动物/交通不宜 pack-level 猜。 |
| 2D | `tiles-platformer-pixel` | OK | family-level | missing | 已有 tile family；semantic-tags 仍缺，包内也含 HUD/敌人/道具。 |
| 2D | `tiles-roguelike-dungeon` | OK | missing | missing | 整张 dungeon spritesheet，角色/地形/道具混合，未猜 pack-level；需要 atlas frame metadata。 |
| 2D | `tiles-roguelike-characters` | OK | pack-level | pack-level | 本轮按 character spritesheet 补 pack-level semantic-tags + slots。 |
| 2D | `cards` | OK | family-level | missing | 已有 family slot；semantic-tags 仍缺，可补 playing-card/card-back。 |
| 2D | `audio-ui-clicks` | OK | missing | missing | 音频包：slot 语义不适用视觉 primitive；保留 recommended 语义。 |
| 2D | `audio-ui-interface` | OK | missing | missing | 音频包：slot 语义不适用视觉 primitive；保留 recommended 语义。 |
| 2D | `audio-sfx` | OK | missing | missing | 音频包：slot 语义不适用视觉 primitive；保留 recommended 语义。 |
| 2D | `mobile-controls` | OK | missing | missing | 输入控件混合按钮/摇杆/dpad；需要 family split 后再补。 |
| 2D | `input-prompts` | OK | missing | missing | 输入提示图标，缺 family semantic-tags；不承担 core gameplay slot。 |
| 2D | `fonts` | MISSING | missing | missing | 字体包无 suitable-styles/genres；按非视觉 support pack 记录。 |
| 3D | `blaster` | OK (3D catalog no suitable-styles) | missing | missing | 武器/弹药/装备混合，未猜 slot。 |
| 3D | `blocky-characters` | OK (3D catalog no suitable-styles) | pack-level | pack-level | 本轮按 character pack 补 pack-level semantic-tags + slots。 |
| 3D | `car` | OK (3D catalog no suitable-styles) | missing | missing | 车辆/路障/道具混合，需 vehicle slot 决策。 |
| 3D | `castle` | OK (3D catalog no suitable-styles) | missing | missing | 城墙/塔楼/门/装饰混合，需 scene-structure slot 决策。 |
| 3D | `city-commercial` | OK (3D catalog no suitable-styles) | missing | missing | 建筑/设施混合，需 building/decor slot 决策。 |
| 3D | `city-industrial` | OK (3D catalog no suitable-styles) | missing | missing | 建筑/管道/设施混合，需 building/decor slot 决策。 |
| 3D | `city-roads` | OK (3D catalog no suitable-styles) | missing | missing | 道路模块，候选 road/track/terrain 语义需 3D slot 决策。 |
| 3D | `cube-pets` | OK (3D catalog no suitable-styles) | missing | missing | 宠物角色包，但 pet vs character/core-unit 需用户确认，未猜。 |
| 3D | `fantasy-town` | OK (3D catalog no suitable-styles) | missing | missing | 建筑/植被/装饰/NPC 混合，未猜 pack-level。 |
| 3D | `food` | OK (3D catalog no suitable-styles) | missing | missing | 食物对象包，需 collectible/prop slot 决策。 |
| 3D | `graveyard` | OK (3D catalog no suitable-styles) | missing | missing | 墓碑/围栏/枯树/装饰混合，未猜 pack-level。 |
| 3D | `mini-dungeon` | OK (3D catalog no suitable-styles) | missing | missing | 墙/地板/门/宝箱/火把混合，需 3D dungeon tile/prop family split。 |
| 3D | `modular-dungeon` | OK (3D catalog no suitable-styles) | missing | missing | 走廊/房间/楼梯混合，需 3D scene-graph slot 决策。 |
| 3D | `modular-space` | OK (3D catalog no suitable-styles) | missing | missing | 太空站模块，需 3D scene-graph slot 决策。 |
| 3D | `nature` | OK (3D catalog no suitable-styles) | missing | missing | 树/石/草/桥/水/地形混合，未猜 pack-level。 |
| 3D | `pirate` | OK (3D catalog no suitable-styles) | missing | missing | 船/码头/宝箱/大炮混合，未猜 pack-level。 |
| 3D | `platformer` | OK (3D catalog no suitable-styles) | missing | missing | 地形/跳台/金币/旗帜/障碍混合，需 family split。 |
| 3D | `prototype` | OK (3D catalog no suitable-styles) | missing | missing | 灰盒几何体/坡道/台阶/栅栏，需 prototype/terrain slot 决策。 |
| 3D | `racing` | OK (3D catalog no suitable-styles) | missing | missing | 赛道/护栏/观众席/路标混合，需 road/track slot 决策。 |
| 3D | `space` | OK (3D catalog no suitable-styles) | missing | missing | 飞船/陨石/太空站/地形混合，未猜 pack-level。 |
| 3D | `survival` | OK (3D catalog no suitable-styles) | missing | missing | 帐篷/营火/工具/栅栏/箱子混合，未猜 pack-level。 |
| 3D | `tower-defense` | OK (3D catalog no suitable-styles) | missing | missing | 塔楼/地形/敌人/武器混合，需 family split。 |
| 3D | `animated-protagonists` | OK (3D catalog no suitable-styles) | pack-level | pack-level | 本轮按 character pack 补 pack-level semantic-tags + slots。 |
| 3D | `animated-survivors` | OK (3D catalog no suitable-styles) | pack-level | pack-level | 本轮按 character pack 补 pack-level semantic-tags + slots。 |
| 3D | `audio-ui-clicks-3d` | OK (3D catalog no suitable-styles) | missing | missing | 音频包：slot 语义不适用视觉 primitive；保留 recommended 语义。 |
| 3D | `audio-ui-interface-3d` | OK (3D catalog no suitable-styles) | missing | missing | 音频包：slot 语义不适用视觉 primitive；保留 recommended 语义。 |
| 3D | `audio-sfx-3d` | OK (3D catalog no suitable-styles) | missing | missing | 音频包：slot 语义不适用视觉 primitive；保留 recommended 语义。 |
| 3D | `fonts-3d` | MISSING suitable-genres | missing | missing | 字体包无 suitable-genres 以外语义；按 support pack 记录。 |

## Filled In This Pass

- `ui-pixel-adventure`: added exact button family entries for `tile_0013.png` through `tile_0021.png`, with `semantic-tags: [button, ui-control]`, `allowed-slots: [ui-button, button]`, and color/terrain disallows.
- `tiles-dungeon`: added pack/family semantic tags and included `background-tile`, `target-block`, and `button` aliases while preserving current checker-compatible `terrain-cell`, `background`, and `ui-button` slots.
- Character packs `sprites-platformer-pixel`, `tiles-roguelike-characters`, `blocky-characters`, `animated-protagonists`, and `animated-survivors`: added pack-level semantic tags plus character/color-unit slot constraints.
- `check_asset_selection.js`: now validates both pack-level and first matching family-level slot constraints.

## Deferred / Needs Decision

- Mixed 2D packs such as `sprites-platformer`, `sprites-medieval`, `sprites-tower-defense`, and `tiles-roguelike-dungeon` need family/frame metadata before slot constraints can be safe.
- Mixed 3D packs such as `mini-dungeon`, `modular-dungeon`, `platformer`, `racing`, `tower-defense`, and `nature` need 3D slot taxonomy alignment with the paused three-engine primitive gap work.
- `cube-pets` could be treated as `character` or a separate `pet` slot; left unchanged until that semantic decision is explicit.

