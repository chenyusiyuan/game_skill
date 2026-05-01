# 素材层重构 TODO（POC 后重启）

## 审计结论（2026-05-01）

对照 `eval/design/素材层重构.md` 的 P0/P1/P2 计划，现状如下：

### ✅ 已落地（约 60%）

| 计划 | 状态 |
|---|---|
| P0.1 `check_asset_usage` per-asset required 消费绑定 | ✅ |
| P0.2 `renderSlot()` wrapper（canvas/dom-ui/pixijs） | ✅ |
| P0.3 `window.__assetUsage` runtime trace | ✅ |
| P1.1 `visual-slots.yaml` + generate/check 脚本 | ✅ |
| P1.4 `check_asset_selection` allowed/disallowed slot 硬规则 | ✅ |
| P1.5 `decor > 40%` 核心实体非空时 fail | ✅ |

### ❌ 未落地（按影响排序）

| # | 计划 | 缺口 | 优先级 |
|---|---|---|---|
| 1 | P0.4 `check_asset_rendered.js` | must-render 素材的 runtime 可见性硬闸缺失 | **高** |
| 2 | P1.3 `generate_implementation_contract.js` 去掉 `inferRole` | 核心素材 slot 语义仍靠字符串推断 | 中 |
| 3 | P1.2 `semantic-slot` / `state-driven` 进 schema | 字段可选，易被模型忽略 | 中 |
| 4 | P2.1 `_asset-index.yaml`（asset-level 而非 pack-level） | 素材选择精度上限低 | 低 |
| 5 | P2.2 tilemap 编号素材做 asset-level 标签 | 同上 | 低 |
| 6 | P2.3 `check_visual_semantics.js` 作为 Phase 3 gate | 素材语义校验缺失 | 低 |

## 当前决策

**暂不做**。理由：POC 未验证玩法层之前，素材层质量不是瓶颈。

- P0.4 的影响："不用素材"堵了约 70%，还有 30% 可能被"代码引用了但未真实渲染"漏过。在玩法层本身还没跑通前，这层缺口暴露不出来。
- P1.3 的影响：核心素材用错的场景需要真实 case 跑出来才能观察，当前纸上讨论无法判断收益。
- P2 整块是"素材选对不选对"的质量问题，优先级最低。

## 重启触发条件

满足任一：

1. POC 跑通 Stage 1 → Stage 2，出现"生成的游戏视觉不达标但 check 全绿"的真实案例
2. 某类玩法（如棋盘类）反复在素材层翻车
3. 团队扩充，有专人负责素材链路

## 关联文档

- 设计文档：`eval/design/素材层重构.md`（739 行完整方案）
- 基线审计：`eval/design/asset_chain_baseline_audit.md`
- 现有素材 SOP：`game_skill/skills/expand.md` / `game_skill/skills/codegen.md` §3.1
- 现有 check 脚本：
  - `check_asset_usage.js` / `check_asset_selection.js` / `check_asset_paths.js`
  - `check_visual_slots.js` / `generate_visual_slots.js`
  - `_asset_strategy.js` / `_visual_primitive_enum.js`
