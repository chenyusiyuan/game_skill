# Spec Clarifications: pixel_canvas-001

## Status
asked

## Questions
- rule: @rule(position-attack)
  question: "小猪在传送带上的哪个位置触发攻击判定？"
  selected: "A. 每个格子位置触发"
  source: user

## Assumptions
- rule: @rule(position-attack)
  decision: "小猪移动到与棋盘每一行/列对齐的位置时，检查正对方向是否有目标块"
  reason: "PRD 强调当前位置/正对方向；每个格子触发更符合像素风格和位置依赖索敌的核心玩法"

- rule: @rule(attack-effect)
  decision: "攻击后小猪继续沿传送带移动，不停止"
  reason: "传送带是持续移动的，攻击只是经过判定点时的瞬时效果"

- rule: @rule(slot-recycle)
  decision: "小猪回到入口位置时判定为一圈完成"
  reason: "传送带是闭环，入口位置是最自然的判定点"

- rule: @rule(conveyor-turn)
  decision: "小猪到达传送带角落时立即转向，转向动画可忽略或简化为瞬移"
  reason: "简化实现复杂度，不影响核心玩法"

## Expand Notes
- mechanic-decomposer must map position-attack trigger to "on-grid-align" event.
- rule/event-graph expander must implement grid-align check every frame.
- Each pig tracks its last-attack-grid to avoid repeated attacks at same position.
