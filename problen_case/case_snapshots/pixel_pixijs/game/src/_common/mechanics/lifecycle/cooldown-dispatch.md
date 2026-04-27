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
