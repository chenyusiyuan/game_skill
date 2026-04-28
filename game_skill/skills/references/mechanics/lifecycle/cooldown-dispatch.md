# cooldown-dispatch@v1

## Semantic Contract

输入节流门。一个 "dispatch" 源（典型：玩家点击）能否触发下游动作，取决于：
1. 当前**冷却中**？若冷却未过则拒绝；
2. 下游**允许**接收该 event？（输入仅能触发白名单内的 lifecycle transition / pool bind /
   gate request，**不能**越权直接改 win/lose/score）；
3. 触发成功后进入 cooldown，直到 `cooldown-ms` 过去。

典型用例：
- Pixel Flow "点击派发一只小猪"——点击过于频繁不应 spawn 多只
- 技能冷却、攻击间隔
- 模态对话框的"再次确认"防抖

## Required State Fields

```yaml
dispatcher:
  id: dispatch-pig
  lastFiredAt: number | null   # performance.now() 时间戳
  cooldownMs: 250              # 冷却窗口
```

## Params

```yaml
cooldown-ms: 250
# 白名单：允许派发的事件形态；任何不在列表里的 event 被 reducer 拒绝，
# 避免业务让"点击"直接改 score/win
allowed-events:
  - kind: "lifecycle-event"          # 对应 entity-lifecycle 的 transition 事件
    event: "dispatched"
  - kind: "pool.request-unbind"
  - kind: "capacity.request"
# 显式 black-list（硬禁事件种类）；默认包含下列：
forbidden-kinds:
  - "state.win-set"
  - "state.lose-set"
  - "state.score-set"
  - "__trace.push"
on-dispatch:   [<action-id>, ...]
on-rejected-cooldown: [<action-id>, ...]
on-rejected-forbidden: [<action-id>, ...]
```

## Invariants

1. **cooldown-respected**: 两次 `dispatch.fired` 事件的时间差 ≥ `cooldown-ms`。
2. **whitelist-only**: `dispatch.fired` 中的 `downstream` event kind 必须 ∈
   `allowed-events`；否则 reducer 返回 `dispatch.rejected-forbidden` 且不改状态。
3. **forbidden-blacklist**: `dispatch` 的 downstream 不得是 `state.win-set` /
   `state.lose-set` / `state.score-set` / `__trace.push` 这些直接篡改终局的 kind。
4. **no-downstream-bypass**: reducer 不直接执行 downstream（downstream 由上层调度器按
   emitted events 派发）；cooldown-dispatch 只负责判决与 bookkeeping。

## Discrete Events Exposed

| 事件 | 触发条件 |
|---|---|
| `dispatch.fired` | 冷却已过 + 白名单通过 + downstream emitted |
| `dispatch.rejected-cooldown` | 冷却未到 |
| `dispatch.rejected-forbidden` | downstream kind 不在白名单（或在黑名单） |

## Common Composition

- UI 点击事件 → `cooldown-dispatch.request` → `capacity-gate.request` → `entity-lifecycle.transition(active)`
- "按空格攻击" → `cooldown-dispatch.request` → `resource-consume`

## Engine Adaptation Hints

- 业务层**不得**绕过 cooldown-dispatch 自己维护 `lastClickAt`——冷却由 primitive
  集中管理。
- `performance.now()` 在测试里需 seed；P1 runtime 会接受 `ctx.now` 注入，默认用
  `performance.now() || Date.now()`。

## Event Interface Contract

### As Consumer (trigger-on)
| 事件 | 必须携带的 payload | 来源示例 |
|---|---|---|
| `dispatch.request` | `{ now: number, downstream: { kind, event? }, dispatcherId? }` | UI 层玩家点击 / 键盘输入事件 |

> `resolveAction` 将 `dispatch.request` 映射为 `{ type: 'request', now, downstream, dispatcherId }`。`downstream` 描述意图触发的下游事件类型，须通过白名单校验。

### As Producer (produces-events)
| 事件 | 携带的 payload | 典型下游 |
|---|---|---|
| `dispatch.fired` | `{ at: number, downstream: { kind, event? } }` | capacity-gate@v1（`capacity.request`）；slot-pool@v1（`pool.request-unbind`）；entity-lifecycle@v1（`lifecycle.event`） |
| `dispatch.rejected-cooldown` | `{ remainingMs: number }` | UI 冷却提示（如按钮灰显倒计时）|
| `dispatch.rejected-forbidden` | `{ downstream?, reason: string }` | UI 错误提示 / 调试日志 |

### DAG Wiring Rules
- ✅ 正确接法：UI 点击 → `dispatch.request` → `dispatch.fired` → `capacity-gate.request` → `entity-lifecycle.transition(active)`
- ✅ 正确接法：`allowed-events` 白名单限制 downstream.kind 为 `lifecycle-event` / `pool.request-unbind` / `capacity.request` 等安全事件
- ❌ 常见接错：downstream.kind 设为 `state.win-set` / `state.score-set`——被 forbidden-blacklist 拦截，产出 `dispatch.rejected-forbidden`
- ❌ 常见接错：绕过 cooldown-dispatch 由业务层自己维护 `lastClickAt`——冷却必须由 primitive 集中管理
