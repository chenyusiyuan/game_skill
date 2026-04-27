# Spec Clarifications: pixel_phaser-001

## Status
assumed

## Questions
(无用户提问，采用默认假设)

## Assumptions

### A1: 传送带离散化
- rule: @rule(conveyor-move), @rule(attack-check)
- decision: "传送带分为 4 个边区(上/右/下/左)，每边 N 个离散位置。小猪移动到每个位置时检查攻击机会。"
- reason: "PRD 强调位置正对方向判定；离散化避免连续碰撞检测复杂性，同时保留策略性。"

### A2: 攻击触发时机
- rule: @rule(attack-check)
- decision: "小猪每移动到新的棋盘边缘对齐位置时触发一次攻击判定，而不是每帧连续判定。"
- reason: "PRD 提到'当小猪移动到棋盘上边/右边/下边/左边时'；离散触发避免一帧多次攻击。"

### A3: 回收槽位选择
- rule: @rule(recycle-pig)
- decision: "小猪回收到第一个空闲等待槽(从左到右遍历)。"
- reason: "PRD 未指定原槽位回收；先到先得更简单，避免槽位记忆逻辑。"

### A4: 同帧结算顺序
- rule: @rule(attack-exec), @rule(recycle-pig)
- decision: "单帧内：移动 → 攻击判定 → 攻击执行 → 弹药检查 → 回收判定。"
- reason: "标准 ECS 顺序，避免攻击和回收同帧冲突。"

### A5: 传送带容量与位置数
- rule: @entity(conveyor)
- decision: "传送带容量=4只小猪。每边8个离散位置，共32个位置形成闭环。"
- reason: "PRD 指定容量上限；位置数需与棋盘尺寸匹配(5-7格)。"

## Expand Notes
- mechanic-decomposer must map `attack-check` to a position-change-triggered event, not continuous tick.
- rule.yaml must use discrete position indices for conveyor slots.
- event-graph.yaml must order: move → check → attack → recycle within single frame.
