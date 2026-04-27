# Guardrails — pixel_pixijs-001

**Phase 4/5 agent 开工前必读**。
这份文件由 Phase 2 机械抽取，列出 PRD 中不可偏离的玩法硬约束。
/compact 会保留这份文件，请随时回读对齐。

## Must-have features
- 四周环形传送带
- 颜色匹配攻击
- 有限弹药小猪
- 等待槽回收系统
- 3阶段关卡递进
- 胜负判定

## Hard rules（禁区）
- **no-global-autoaim**: 禁止全屏自动索敌
- **single-target-attack**: 单目标攻击
- **no-pierce-attack**: 禁止穿透攻击
- **core-mechanics**: 核心玩法约束
- **not-match3-tower-defense**: 游戏类型约束

## 核心 @rule（按 PRD 顺序，最多 10 条）
- `pig-deploy`: "pig.state = 'on-belt' ; conveyor.pigs.push(pig) ; slot.pig = null ; slot.occupi
- `pig-move`: "pig.position.slot += 1"
- `pig-move-edge`: "pig.position.slot = 0 ; pig.position.edge = nextEdge(pig.position.edge)"
- `pig-attack`: "target = findFirstBlock(pig.position)"
- `pig-attack-hit`: "pig.ammo -= 1 ; target.hp -= 1"
- `block-remove`: "target.removed = true"
- `pig-recycle`: "pig.state = 'recycled' ; conveyor.pigs.remove(pig)"
- `pig-recycle-slot`: "slot = findEmptySlot() ; slot.pig = pig ; slot.occupied = true"
- `pig-exhaust`: "pig.state = 'exhausted' ; conveyor.pigs.remove(pig)"
- `win-check`: "gameState.phase = 'win'"

## 操作指引
- codegen 必须在每条 @rule 触发处 `window.__trace.push({rule, before, after, t})`
- 不允许为了过校验而改 profile 或 check 脚本
- Must-have features 不得降级；若做不到，返回 failed 并报 user
