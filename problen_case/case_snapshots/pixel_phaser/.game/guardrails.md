# Guardrails — pixel_phaser-001

**Phase 4/5 agent 开工前必读**。
这份文件由 Phase 2 机械抽取，列出 PRD 中不可偏离的玩法硬约束。
/compact 会保留这份文件，请随时回读对齐。

## Must-have features
- 四周环形传送带
- 颜色匹配攻击
- 等待槽回收
- 多关卡递进
- 容量管理

## Hard rules（禁区）
- **no-global-autoaim**: 禁止全屏自动索敌
- **no-multi-attack**: 禁止一次攻击多块
- **no-penetration**: 禁止穿透攻击
- **core-mechanics**: 核心玩法约束

## 核心 @rule（按 PRD 顺序，最多 10 条）
- `dispatch-pig`: "pig.position = conveyor ; pig.conveyorSlot = firstEmptySlot ; conveyor.pigs.pus
- `dispatch-cleanup`: "waiting-slot.slots[clickedIndex] = null"
- `conveyor-move`: "for each pig in conveyor.pigs → pig.conveyorSlot = (pig.conveyorSlot + speed *
- `attack-check`: "target = findFirstBlockInDirection(pig.position) ; if target.color == pig.color
- `attack-exec`: "target.hp -= 1 ; pig.ammo -= 1 ; if target.hp <= 0 → target.cleared = true"
- `attack-aftermath`: "play attack animation ; if pig.ammo <= 0 → remove pig from conveyor"
- `recycle-pig`: "pig.position = waiting ; pig.conveyorSlot = -1 ; find empty waiting-slot → plac
- `win-check`: "state.phase = win ; state.gameOver = true"
- `lose-check`: "state.phase = lose ; state.gameOver = true"

## 操作指引
- codegen 必须在每条 @rule 触发处 `window.__trace.push({rule, before, after, t})`
- 不允许为了过校验而改 profile 或 check 脚本
- Must-have features 不得降级；若做不到，返回 failed 并报 user
