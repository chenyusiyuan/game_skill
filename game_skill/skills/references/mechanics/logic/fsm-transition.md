# fsm-transition@v1

## Semantic Contract

有限状态机：entity 在有限个 state 中切换，切换由显式 trigger 触发。
用于"游戏阶段管理"、"agent AI 状态"、"UI 流程"等。

## Required State Fields

| 字段 | 类型 | 含义 |
|---|---|---|
| `state` | string | 当前状态（必须在 params.states 中） |

## Params

```yaml
states: [idle, playing, paused, win, lose]
initial: idle
transitions:
  - from: idle
    on: start
    to: playing
  - from: playing
    on: pause
    to: paused
  - from: playing
    on: all-blocks-clear
    to: win
  - from: playing
    on: out-of-pigs
    to: lose
```

## Invariants

1. **reachability**: 从 initial 出发必须可达每个显式 states（否则 states 里多余）
2. **deterministic**: 同一 (state, trigger) 至多有一条 transition
3. **closed**: 所有 transition 的 from/to 必须在 states 中

## Events

| 事件 | 触发条件 |
|---|---|
| `fsm.entered-<state>` | 进入某 state |
| `fsm.exited-<state>`  | 离开某 state |
