# Guardrails — pixel_dom_ui

**Phase 4/5 agent 开工前必读**。
这份文件由 Phase 2 机械抽取，列出 PRD 中不可偏离的玩法硬约束。
/compact 会保留这份文件，请随时回读对齐。

## Must-have features
- 四周传送带
- 颜色匹配攻击
- 小猪单位系统
- 等待槽回收
- 中央棋盘目标块
- 位置依赖索敌
- 胜负条件

## Hard rules（禁区）
- **no-auto-aim**: 禁止全屏自动索敌
- **single-target**: 禁止多目标攻击
- **no-penetration**: 禁止穿透攻击
- **not-match3**: 禁止做成三消

## 核心 @rule（按 PRD 顺序，最多 10 条）
- `match-attack`: "target = getFirstBlockInDirection(pig.position, pig.direction)"
- `match-attack-hit`: "target.hp -= 1 ; pig.ammo -= 1 ; if target.hp <= 0 → removeBlock(target)"
- `pig-recycle`: "pig.position = -1 ; slot.pig = pig"
- `pig-exhaust`: "pig.position = -1 ; pig = null"
- `win-check`: "if state.blocksRemaining == 0 → state.phase = 'win'"
- `lose-check`: "if state.availablePigs == 0 && state.blocksRemaining > 0 → state.phase = 'lose'
- `conveyor-capacity`: "if conveyorPigs.length >= MAX_CONVEYOR → return ; else → deployPig()"

## 操作指引
- codegen 必须在每条 @rule 触发处 `window.__trace.push({rule, before, after, t})`
- 不允许为了过校验而改 profile 或 check 脚本
- Must-have features 不得降级；若做不到，返回 failed 并报 user
