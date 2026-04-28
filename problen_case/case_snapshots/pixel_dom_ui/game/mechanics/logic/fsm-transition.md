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

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| 任意事件（通过 `event-trigger-map` 映射） | 无额外 payload 要求；事件的 `type` 会被映射为 trigger | resource-consume@v1（`resource.target-zero`）、predicate-match@v1（`match.hit`） |
| 携带 `ev.trigger` 的事件 | `ev.trigger`（string，直接用作 trigger 名） | 自定义事件 |
| 未映射事件 | 无 | fallback：`ev.type` 本身作为 trigger |

> **resolveAction 取值逻辑**：`trigger = params['event-trigger-map'][ev.type] || ev.trigger || ev.type`。先查 `event-trigger-map` 配置表（事件类型 → trigger 名），未命中则取 `ev.trigger` 字段，最后 fallback 到 `ev.type` 本身。因此 FSM 可以响应**任何事件**——只需在 `event-trigger-map` 中配置映射即可。

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `fsm.entered-<state>` | 无额外 payload（事件名已编码目标状态） | UI 切换场景、启动/停止 timer、spawner |
| `fsm.exited-<state>` | 无额外 payload（事件名已编码离开状态） | 清理前状态资源、暂停逻辑 |
| `fsm.invalid-trigger` | `{ from, trigger }`（当前状态 + 无效 trigger 名） | 日志 / 调试 / 错误处理 |

### DAG Wiring Rules
- ✅ 正确接法：`resource-consume@v1` 发出 `resource.target-zero` → 在 `event-trigger-map` 中配置 `{ "resource.target-zero": "all-blocks-clear" }` → FSM 收到 trigger `all-blocks-clear` 并执行状态转移
- ✅ 正确接法：直接用事件名作 trigger（如 transitions 中 `on: "match.hit"`），此时无需配置 `event-trigger-map`，`ev.type` 直接作为 trigger
- ❌ 常见接错：`event-trigger-map` 中的 key 拼写与上游事件 `type` 不一致（如写成 `target-zero` 而非 `resource.target-zero`）—— 导致映射失败，fallback 到 `ev.type`，与 transitions 中的 `on` 字段不匹配，触发 `fsm.invalid-trigger`
- ❌ 常见接错：transitions 中缺少对应 `(from, on)` 规则 —— FSM 处于状态 A 时收到 trigger B，但无 `{ from: A, on: B }` 规则，导致 `fsm.invalid-trigger` 而非预期的状态切换
- ❌ 常见接错：期望 FSM 传递上游事件的 payload（如 `targetId`）—— FSM 的 `entered/exited` 事件不携带上游 payload，如需传递需额外处理
