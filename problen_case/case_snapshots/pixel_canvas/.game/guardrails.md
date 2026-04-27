# Guardrails — pixel_canvas-001

**Phase 4/5 agent 开工前必读**。
这份文件由 Phase 2 机械抽取，列出 PRD 中不可偏离的玩法硬约束。
/compact 会保留这份文件，请随时回读对齐。

## Must-have features
- 四周环形传送带（小猪沿外圈移动）

## Hard rules（禁区）
- **no-global-autoaim**: 禁止全屏自动索敌
- **no-multi-attack**: 禁止一次攻击多个块
- **no-pierce-attack**: 禁止穿透攻击
- **conveyor-required**: 必须有传送带机制
- **slot-recycle-required**: 必须有等待槽回收

## 核心 @rule（按 PRD 顺序，最多 10 条）
- `dispatch-pig`: "pig.onConveyor = true ; pig.x = conveyor.entryX ; pig.y = conveyor.entryY"
- `dispatch-pig-2`: "pig.direction = 'top' ; conveyor.pigs.push(pig) ; wait-slot.slots[slotIndex] =
- `conveyor-move`: "for each pig in conveyor.pigs → pig.x += speed * cos(direction)"
- `conveyor-move-y`: "for each pig in conveyor.pigs → pig.y += speed * sin(direction)"
- `conveyor-turn`: "pig.direction = nextDirection(pig.direction)"
- `position-attack`: "target = findFirstBlockInDirection(pig) ; if target != null && target.color ==
- `attack-effect`: "block.hp -= 1 ; pig.ammo -= 1 ; if block.hp <= 0 → block.cleared = true"
- `find-top-block`: "for col from pig.col to board.cols-1 → find first !cleared block in that column
- `find-right-block`: "for row from 0 to pig.row → find first !cleared block in that row"
- `find-bottom-block`: "for col from pig.col to 0 → find first !cleared block in that column"

## 操作指引
- codegen 必须在每条 @rule 触发处 `window.__trace.push({rule, before, after, t})`
- 不允许为了过校验而改 profile 或 check 脚本
- Must-have features 不得降级；若做不到，返回 failed 并报 user
