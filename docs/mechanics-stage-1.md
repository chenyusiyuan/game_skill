# Stage 1 链路重构 — 落地手册

## 这次重构做了什么（一句话）

把"玩法真值"从 Phase 5 的 `__trace` 覆盖率**前移**到 Phase 3.5 的原语符号执行。
不再枚举"整局模式"，而是用 **10 个正交 mechanic primitives** 的组合覆盖长尾游戏类型。

## 新增文件清单

| 路径 | 作用 |
|---|---|
| [game_skill/skills/references/mechanics/README.md](file:///Users/bytedance/Project/game_skill/game_skill/skills/references/mechanics/README.md) | 原语库导读 + 约定 |
| [game_skill/skills/references/mechanics/_index.yaml](file:///Users/bytedance/Project/game_skill/game_skill/skills/references/mechanics/_index.yaml) | 原语清单（decomposer/checker/codegen 共用） |
| `game_skill/skills/references/mechanics/motion/{parametric-track,grid-step}.{md,reducer.mjs}` | 运动类 |
| `game_skill/skills/references/mechanics/spatial/{grid-board,ray-cast,neighbor-query}.{md,reducer.mjs}` | 空间类 |
| `game_skill/skills/references/mechanics/logic/{predicate-match,resource-consume,fsm-transition}.{md,reducer.mjs}` | 逻辑类 |
| `game_skill/skills/references/mechanics/progression/{win-lose-check,score-accum}.{md,reducer.mjs}` | 进度类 |
| [game_skill/skills/scripts/check_mechanics.js](file:///Users/bytedance/Project/game_skill/game_skill/skills/scripts/check_mechanics.js) | Phase 3.5 symbolic check |
| [game_skill/skills/scripts/freeze_specs.js](file:///Users/bytedance/Project/game_skill/game_skill/skills/scripts/freeze_specs.js) | Phase 5 spec freeze / verify |
| [.claude/agents/mechanic-decomposer.md](file:///Users/bytedance/Project/game_skill/.claude/agents/mechanic-decomposer.md) | Phase 3.0 子 agent 定义 |

## 修改文件

- [game_skill/skills/SKILL.md](file:///Users/bytedance/Project/game_skill/game_skill/skills/SKILL.md)
  - Phase 3 拆成 3.0 / 3.x / 3.5
  - Phase 5 入口增加 step 1.5 调 `freeze_specs.js`，修复循环每轮 `--verify`
- [.claude/agents/engine-codegen.md](file:///Users/bytedance/Project/game_skill/.claude/agents/engine-codegen.md)
  - 输入契约新增 `【Mechanics】`
  - 允许读文件新增 mechanics catalog，禁止读 reducer.mjs
  - 执行步骤新增 Step 6「Mechanics 驱动实现」硬要求

## 端到端流程（新版）

```
Phase 1 → Phase 2 → Phase 3.0 (mechanic-decomposer)
                         ↓
                    specs/.pending/mechanics.yaml
                         ↓
                  Phase 3.x (5 个 expander 并发，rule/event-graph 读 mechanics.yaml)
                         ↓
                  Phase 3.5 (check_mechanics.js)
                         ↓ fail → Phase 3 整体 failed，报用户
                         ↓ pass
                  Phase 4 (engine-codegen，按原语 1:1 落代码，每个 node 加 @primitive 注释)
                         ↓
                  Phase 5 (freeze_specs.js freeze; 每轮修复循环前 --verify)
```

## POC 验证方法（在 canvas-001 上已跑通）

### 1. 确认原语库加载正常

```bash
node game_skill/skills/scripts/check_mechanics.js cases/canvas-001/
```

期望输出：
```
✓ loaded parametric-track@v1 reducer
... (6 个原语)
✓ invariant @constraint(position-dependent-attack) mapped: ...
✓ invariant @constraint(single-target-attack) mapped: ...
· scenario: happy-path-win
✓     outcome=win 符合 expected
✓     [invariant@parametric-track@v1] 91 snapshots, all invariants held
...
Mechanic check: pass
```

### 2. 反例（验证能抓错）

```bash
cp cases/canvas-001/specs/mechanics.yaml /tmp/m.yaml
# 把 attack-raycast 的 direction.mode 改成 fixed（违反 @constraint）
sed -i '' 's/mode: normal-to-track/mode: fixed/' cases/canvas-001/specs/mechanics.yaml
node game_skill/skills/scripts/check_mechanics.js cases/canvas-001/
# 期望：退出码 1，明确指出 constraint 违规 + 无法到达 win
cp /tmp/m.yaml cases/canvas-001/specs/mechanics.yaml
```

### 3. freeze 机制验证

```bash
node game_skill/skills/scripts/freeze_specs.js cases/canvas-001/           # 写入 freeze.json
node game_skill/skills/scripts/freeze_specs.js cases/canvas-001/ --verify  # → ✓ passed
echo "" >> cases/canvas-001/specs/mechanics.yaml
node game_skill/skills/scripts/freeze_specs.js cases/canvas-001/ --verify  # → ✗ FAILED (MODIFIED)
# 恢复
sed -i '' -e '$ d' cases/canvas-001/specs/mechanics.yaml
```

## 真正的 POC 跑法（pixel-flow 重做）

选一个你最受挫的 case（比如 pixel-flow-pixijs-001），从 Phase 3 开始重跑：

1. 删掉 `cases/pixel-flow-pixijs-001/specs/` 和 `game/`，保留 `docs/game-prd.md`
2. 主 agent 按新 SKILL.md 的 Phase 3.0 启动：
   ```
   subagent_type: game-mechanic-decomposer
   prompt:
     【PRD】cases/pixel-flow-pixijs-001/docs/game-prd.md
     【输出】cases/pixel-flow-pixijs-001/specs/.pending/mechanics.yaml
     【项目】pixel-flow-pixijs-001
     【引擎】pixijs
   ```
3. decomposer 返回 ok → 跑 Phase 3.x 五个 expander（prompt 里加 `【机械基线】`）
4. 跑 Phase 3.5：
   ```bash
   node game_skill/skills/scripts/check_mechanics.js cases/pixel-flow-pixijs-001/
   ```
5. 通过后才进 Phase 4；codegen 会按 mechanics.yaml 的 6-8 个 node 拆成 `src/mechanics/*.js`
6. Phase 5 入口 freeze；修复循环禁止改 specs

## 对你原痛点的直接解法

| 原痛点 | 新机制的解决路径 |
|---|---|
| domui 猪只走最上方传送带 | `parametric-track.checkInvariants` 的 `coverage` 规则会在模拟超过 1 圈后检查所有 segment 都被访问过；若 segments 设计不合理或 speed 方向错，Phase 3.5 就报错 |
| canvas 攻击方向不对 / 经过不攻击 | `ray-cast.direction.mode=normal-to-track` 是硬 invariant，segment-direction-map 由 PRD constraint 驱动；mode 错 → Phase 3.5 fail；覆盖漏段 → coverage invariant fail |
| canvas 拐角不平滑 | `parametric-track.periodicity` 要求 `P(0) == P(1)`，若用离散 segment/index 累加位置（旧实现方式），periodicity 会破裂；codegen 被要求用 `positionAt(t)` 的参数化表达，不能散写 `x += vx` |
| phaser / pixijs 死循环 | Phase 3.5 提前把玩法结构性错误揪出；Phase 5 freeze 禁止改 PRD/specs 绕过；rule-traces 不再是主真值（由原语 invariants 取代） |

## 新增原语的流程（稳态预计每月 0-2 个）

1. `references/mechanics/<category>/<name>.md` + `<name>.reducer.mjs`
2. 追加到 `_index.yaml`
3. 在 [.claude/agents/mechanic-decomposer.md](file:///Users/bytedance/Project/game_skill/.claude/agents/mechanic-decomposer.md) 的"识别规则"段加一行 PRD 短语映射
4. 无需改 `check_mechanics.js`、`engine-codegen`、其他原语（正交性保证）

## 已知限制（Stage 2 再补）

- `check_mechanics.js` 的 orchestrator 依赖 reducer 导出的 `resolveAction` / `applyEffects` / `emittedEvents` 钩子；新增 primitive 时必须在 reducer 里声明这些钩子与事件清单。
- `ray-cast` 的 pixel-mode 未实现 reducer（只实现 grid-mode，POC 足够）
- mechanic-decomposer 还没做 PRD 反确认交互，可能产出不理想的 DAG（建议 Stage 2 引入 AskUserQuestion 确认关键原语选择）

## 回滚

Stage 1 的所有新东西对老 case **可显式兼容**：
- 默认情况下缺 `mechanics.yaml` 会 hard fail；只有迁移老 case 时可显式传 `--allow-missing-mechanics` 跳过。
- `freeze_specs.js` 是独立脚本，不运行就不生效
- Phase 3.0 / 3.5 未完成不会影响 Phase 3.x 并发 expander（事务语义保留）

完全回滚只需：删 `references/mechanics/` + `check_mechanics.js` + `freeze_specs.js`，并把 SKILL.md / engine-codegen.md / 新 agent 的改动 revert。
