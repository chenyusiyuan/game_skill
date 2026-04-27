# Spec Clarifications: pixel_dom_ui

## Status
asked

## Questions
- rule: game-config
  question: "传送带容量、等待槽数量、移动速度、弹药初始值这些数值怎么配置？"
  selected: "默认数值"
  source: user

## Assumptions
- rule: @rule(conveyor-capacity)
  decision: "传送带容量 = 4 格（每边 1 格）"
  reason: "默认数值，确保有足够策略空间同时避免过于复杂"

- rule: @rule(pig-recycle)
  decision: "等待槽数量 = 5 格"
  reason: "默认数值，允许玩家储备一定数量的小猪进行策略调度"

- rule: movement-speed
  decision: "小猪移动速度 = 每秒 1 格"
  reason: "默认数值，给玩家足够时间观察和决策"

- rule: ammo-initial
  decision: "小猪初始弹药 = 3-5（按关卡配置）"
  reason: "默认数值范围，可根据关卡难度调整"

- rule: @rule(match-attack)
  decision: "攻击判定触发时机：小猪每移动到新的传送带格子时检查一次"
  reason: "PRD 明确'位置依赖索敌'，每个格子对应一个攻击判定点"

- rule: @rule(match-attack-hit)
  decision: "目标选择：只处理正对方向的第一个未消除目标块"
  reason: "PRD 明确'当前方向第一个目标块'，符合 hard-rule 位置依赖索敌"

- rule: board-size
  decision: "棋盘大小：第一关 6x6，第三关 7x7"
  reason: "PRD @level 参数已明确指定"

- rule: color-count
  decision: "颜色数量：第一关 2 色，第二关 3 色，第三关 4 色"
  reason: "PRD @level 参数已明确指定"

## Expand Notes
- mechanic-decomposer must use these numerical configs in mechanics.yaml
- rule.yaml must reference conveyor-capacity=4 and wait-slots=5
- event-graph.yaml must ensure attack-check triggers on each conveyor-grid position
- Phase 4 codegen must implement movement-speed as configurable (ticks per grid)
