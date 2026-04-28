# Mechanic Primitives Catalog

本目录提供**玩法机械原语 (Mechanic Primitives)**：一组正交、可组合、带不变式的小规范。
Phase 3.0 "语义拆解" 把 PRD 编译为原语 DAG（`specs/mechanics.yaml`），Phase 3.5 用每个原语的 reference reducer 做 symbolic check，Phase 4 codegen 按原语为最小单位落实到引擎。

## 核心理念

- **原语粒度 < 50 条**，组合覆盖长尾游戏类型。
- 每个原语 = `spec.md`（语义合同 + 不变式 + 组合建议） + `reducer.js`（纯 JS 参考实现，≤200 行）。
- **原语只定义语义，不锁定引擎**。`spec.md` 末尾有 Engine Adaptation Hints，仅为建议。
- **不变式 (invariants)** 是 Phase 3.5 判定玩法结构是否可行的机械依据，取代当前"埋点覆盖率"作为产品真值来源。

## 目录

```
mechanics/
├── motion/
│   ├── parametric-track.md + .reducer.js   # 沿参数曲线运动（环、直线、自定义 f(t)）
│   ├── grid-step.md + .reducer.js          # 格子步进（四/八/跳跃）
├── spatial/
│   ├── grid-board.md + .reducer.js         # 离散二维网格容器
│   ├── ray-cast.md + .reducer.js           # 从 agent 投射方向，取第一个/所有命中
│   ├── neighbor-query.md + .reducer.js     # 邻居查询（4/8/hex）
├── logic/
│   ├── predicate-match.md + .reducer.js    # 字段匹配（颜色/类型/id）
│   ├── resource-consume.md + .reducer.js   # 数值消耗 & 归零触发
│   ├── fsm-transition.md + .reducer.js     # 状态机
├── progression/
│   ├── win-lose-check.md + .reducer.js     # 胜负判定
│   ├── score-accum.md + .reducer.js        # 分数累计
└── _index.yaml                             # 原语清单（版本 + 文件映射）
```

## 原语规范格式（硬约束）

每份 `<primitive>.md` 必须包含以下段落：

1. `# <id>@<version>` 标题
2. `## Semantic Contract` — 数学/语义定义（≤ 10 行）
3. `## Required State Fields` — 使用此原语的 entity 必须具备的字段
4. `## Params` — 原语可配置项
5. `## Invariants` — symbolic check 时机械验证的不变式
6. `## Discrete Events Exposed` — 原语对外发布的事件名
7. `## Common Composition` — 与哪些其他原语常见搭配
8. `## Engine Adaptation Hints` — 每引擎 ≤ 5 行实现建议（仅建议）

每份 `<primitive>.reducer.mjs` 必须导出：

```js
export const id = 'primitive-id';
export const version = 'v1';
// Pure reducer: (state, action, params) -> nextState
export function step(state, action, params) { /* ... */ }
// Invariant checkers: (state, params) -> { ok: boolean, violations: string[] }
export function checkInvariants(state, params) { /* ... */ }
// Which action types this primitive handles
export const handles = ['tick', 'user-click', ...];
// Which events this primitive can emit. Use exact names or "*" suffix for generated families.
export const emittedEvents = ['track.enter-segment', 'fsm.entered-*', ...];
```

## 接入流程

1. Phase 3.0 `mechanic-decomposer` 子 agent：读 PRD + 本目录 → 产出 `specs/mechanics.yaml`
2. Phase 3.5 `check_mechanics.js`：加载每个 node 的 reducer，跑 profile setup → 符号模拟 → 验证 invariants、rule/event-graph 的 `primitive-node-ref`、win-lose 可达
3. Phase 4 codegen：把 mechanics.yaml 的每个 node 翻译成引擎层代码，附 `// @primitive(<id>@vN): node-id=<node-name>` 注释；`check_implementation_contract.js --stage codegen` 会校验 1:1 覆盖
4. Phase 5：修复循环禁止改 mechanics.yaml（hash freeze）

## 新增原语流程

仅当现有原语组合**真的无法表达**某机械时才新增：

1. 在对应子目录写 `<name>.md` + `<name>.reducer.js`
2. 在 `_index.yaml` 注册
3. 在 `decomposer` prompt 中追加一行提示
4. 无需修改 codegen / checker / 其他原语（正交性保证）
