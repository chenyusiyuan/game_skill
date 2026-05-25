# Phase 4 — SKILL.md 增段(Phase A/B/C SOP + Phaser 坑 + 决策日志原则 + 视觉信号)

## Goal

把 v1.1 的引导密度反映到 `SKILL.md`(单一真相源)。这个 phase 的产物**不是新文件**,而是对现有 SKILL.md 的**追加**:既有判定语义(milestone 反稀释 / smoke 取证 / case 隔离硬约束 / N19 演进环逻辑)**绝不动**,只**追加**新引导段。

> 上下文锚点:
> - plan 文件 § "通用 milestone/state 词汇" + § "SKILL.md Phaser 坑列表" + § "Per-Phase 大纲" `40-skill-md.md`
> - 现有 `SKILL.md`(单一真相源)
> - `evolution-docs/research-notes-phaser.md` § 6(完整 16 条 Phaser 坑)

## Pre-requisites

- Phase 1 完成(模板可被 SKILL.md Phase A 段引用)
- Phase 2 完成(lib/ 可被 SKILL.md Phase B 段引用)
- Phase 3 完成(qualityHints / hard gate / load_primer.js / scope-leak 等行为可被 SKILL.md 引用)

## Files to modify

| 路径 | 修改类型 |
|------|---------|
| `SKILL.md` | **追加**段;不改既有 Step 0 / Phase A acceptance 反稀释规则 / Phase B 既有写权限白名单 / Phase C 既有判定语义 |

## Forbidden

- 不改 SKILL.md 既有判定段的语义(只在每段尾追加新 SOP 步骤)
- 不改 acceptance 反稀释 5 条规则(它们是 plan.json 内部规则,与 v1.1 引导是正交的两层)
- 不改 case 隔离硬约束("禁止读 sibling case 源码" / "禁读 templates/")
- 不改 N19 演进环工序段
- 不在 SKILL.md 写完整 Phaser 16 坑(完整版留 `evolution-docs/research-notes-phaser.md`,SKILL.md 只放 10-12 条高频 + 链接)
- 不引入新 npm 依赖

## SKILL.md 改动清单(逐段)

### 改动 1:Phase A 段尾追加 v1.1 引导

在现有 Phase A 段末(plan.json 字段说明 + acceptance 反稀释规则之后)追加:

````markdown
---

## Phase A v1.1 引导密度(必填,plan.json 之前先做)

### A.0 工作 todo 列表(建议,不强制)

接到 query 后,**强烈建议**先用 `write_todos`(GLM / Kimi 等)/ `TaskCreate`(Claude Code / Codex)/ 等价工具列出 8-12 步工作清单,作为模型自己的执行 checklist。参考模板:

```
1. 读 query + 识别 archetype + (若适用)加载 primer
2. 写 docs/DESIGN.md(4 必填 anchor: visualIdentity / uiSurfaces / coreLoop / mustAvoid)
3. 写 docs/decisions.md@A(5-15 条 Q&A,标 from-query / from-genre-knowledge / from-reasoning)
4. 写 specs/plan.json(requiredMechanics[].derivedFrom 引用 DESIGN.md anchor)
5. 跑 validate_plan.js 校验通过(否则 generation-blocked: design-anchor-missing 必须 fix)
6. (Phase B) 起草文件清单 + 写 decisions.md@B 架构选择条目
7. (Phase B) 实现核心循环 + 引用 lib/ helper(visualTheme / inputController / hudBuilder / progressionMath ≥ 2 个)
8. (Phase B) 实现差异化内容(武器 / 敌人 / 关卡 / 反馈瞬间)+ 自评写 .game/rubric.json
9. (Phase B) tsc --noEmit + vite build 通过
10. (Phase C) 跑 check_delivery,确认 milestone 全亮 + qualityHints 容器写入
11. (Phase C 可选)写 decisions.md@C retrospective(读 qualityHints 后回顾)
```

**这不是契约,也不是 gate**。但 todo list 把工序"自我承诺"出来,显著降低跳步偷懒概率(线上 GLM / Kimi 都自发用了类似机制)。

对没有 todo 工具的模型,SKILL.md 的 Phase A/B/C 文档语义等价 — 只是工序可见性差一点,容易在长 session 中漏掉某步。

### A.1 archetype 识别 + on-demand primer

写 `cases/<id>/docs/decisions.md` 时,**第一题**是 archetype 识别:

> **Q**: 用户 query 最接近哪个已知 archetype?
>
> **A**: <写明判断,标 from-reasoning>

若识别为 {vampire-survivors, shooter, breakout, topdown, tower-defense} 之一,**强烈建议**:

```bash
node scripts/load_primer.js cases/<id> --archetype <X>
```

复制对应 primer 到 `cases/<id>/.game/archetype-primer.md`。读完 primer 再继续后续 Q&A 与 plan.json 编写。

若识别失败或不在 5 个内,不加载 primer,自行设计;在 retrospective 段(decisions.md C 段)记录是否需要新增 primer。

### A.2 写 docs/DESIGN.md(4 必填 anchor + 跨品类样例)

`prepare_case_game.js` 已经把 `templates/design-template.md` 复制到 `cases/<id>/docs/DESIGN.md`。worker 必须填完 4 个 anchor:

- `visualIdentity` (palette + motif)
- `uiSurfaces` (primary / secondary / feedback)
- `coreLoop` (primaryAction / successSignal / failureSignal / iterationFeel)
- `mustAvoid`(≥3 条,**必须**含 `default-purple-blue-orbs` 防 AI 默认蓝紫圆点审美)

可选 anchor:`temporalShape`。

> **禁用**:`feedbackMoments` / `progressionFeel.powerCurve` 等 action-bias 旧词(已废弃)。

意象锚点写作要求:不写"暗黑风格"或"科技蓝",写一个**非数字世界的真实场景**。参考线上 design-style-thinking 方法论:"晨光透过白色纱帘的极简客厅"、"月下荒野中的篝火孤影"、"实验室冷光下的手术台"。

### A.3 plan.json `derivedFrom` 必填

写 plan.json 时,`requiredMechanics[]` 每条必须有 `derivedFrom` 字段,引用 DESIGN.md 中实际存在的 anchor 路径。例:

```json
{
  "name": "auto-fire",
  "summary": "玩家武器自动开火",
  "derivedFrom": "coreLoop.primaryAction"
}
```

至少有一条引用以下 4 个稳定 anchor 之一:
- `visualIdentity.palette`
- `uiSurfaces.primary`
- `coreLoop.primaryAction`
- `mustAvoid.<具体禁忌>`

引用错误的 anchor 会触发 `generation-blocked: design-anchor-missing`,case 必须 fix 后再 deliver。

### A.4 写 decisions.md A 段(5-15 条 Q&A,来源标签)

每条 Q&A 标来源:`from-query`(用户原文显式)/ `from-genre-knowledge`(品类公约推断)/ `from-reasoning`(临场推理)。

**反逃逸规则**:`from-query` 标的核心要求**必须**出现在 `plan.json.requiredMechanics[].name` 或 `acceptance.mustHave[].text` 中。否则需在 decisions.md 显式写"降级理由"(说明为什么把用户明说的需求降级到 nonblockingTodos),否则触发 `scope-leak` warning。

### A.5 nonblockingTodos 0-8 灵活

- query 含明显扩展项(如"还可以加 X"、"未来可以 Y")时**建议** ≥3 条
- **不得**把 `coreLoop.*`(核心循环 / 核心反馈 / 核心 UI)等核心降级到 nonblockingTodos
- 上限 8 条;再多说明 plan 范围设计有问题
````

### 改动 2:Phase B 段尾追加 v1.1 引导

在现有 Phase B 段末追加:

````markdown
---

## Phase B v1.1 引导密度

### B.1 优先用 lib/ helper(避免低密度原语)

`prepare_case_game.js` 已经把以下 4 个 v1.1 默认 helper 复制到 `cases/<id>/game/src/lib/`:

- `visualTheme.ts` — 粒子 / 相机 / tween / 伤害字 / hit-stop / boss 出场(CANVAS-safe 核心 + WebGL FX optional)
- `inputController.ts` — WASD + 方向键 + 触摸虚拟摇杆
- `hudBuilder.ts` — meterBar / statusText / iconSlot
- `progressionMath.ts` — 纯函数曲线(linearRamp / waveScale / thresholdCurve / clamp / lerp)

**强烈建议**至少调用 2 个 helper(仅 import 不算调用)。可选用法:

```ts
import { ensureProceduralTextures, burstParticles, screenShake, damageNumber } from './lib/visualTheme';
import { meterBar } from './lib/hudBuilder';
import { waveScale, thresholdCurve } from './lib/progressionMath';

// scene.create()
ensureProceduralTextures(this);
const hpBar = meterBar(this, { x: 10, y: 10, width: 100, height: 12, color: 0xff4444 });

// 命中
burstParticles(this, enemy.x, enemy.y, { color: enemyColor });
damageNumber(this, enemy.x, enemy.y - 20, damage);
screenShake(this, 'micro');
```

helper 是引导,不是强制。case 完全可以自己写;但若你 case 没用 helper 又输出原语 add.circle 拼粒子,会触发 `qualityHints.warnings: ['low-helper-usage']`(warn-only,不阻塞)。

### B.2 写 decisions.md B 段(in-flight 实现期决策)

每写一个**新文件**或**重构一段**或**跳过一个复杂度**,在 `decisions.md` B 段加一条:

- 决策(做了什么)
- 与 plan 的差异(若有)
- 风险(若有)

例:

> **B.1 文件清单 — 来源: from-plan**
> 决策:实际拆为 5 个文件(plan 列了 6 个,合并 EnemyManager + Spawner)
> 差异:Spawner 状态与 EnemyManager 紧耦合,拆开会引入循环依赖
> 风险:若后续 Spawner 逻辑独立化,需要再拆

decisions.md 是 **decision log / rationale**,**不是** chain-of-thought dump。仅记结论 / 依据 / 权衡 / 后续风险,不要求暴露推理过程。

### B.3 implementationPlan 责任覆盖,不一对一文件名

`plan.json.implementationPlan[]` 给方向,不锁文件名。Phase B 允许调整文件清单,只要:
1. plan 列的所有 `purpose`(责任)在最终代码里都有对应文件承担
2. 调整理由写到 `decisions.md@B`

### B.4 LOC 软硬阈值(filesplit warn-only)

- 业务文件 LOC ≤ 600 软上限,> 600 触发 `qualityHints.warnings: ['file-loc-soft']`
- 业务文件 LOC > 900 触发 `qualityHints.warnings: ['file-loc-hard']`(强烈建议拆分,但仍可 deliver)
- MainScene 占比:占 game/src 总 LOC > 70% → `mainscene-occupancy-soft`;> 85% → `mainscene-occupancy-hard`
- **总 LOC < 900 时占比检查禁用**(小项目无需拆分)

### B.5 自评 rubric(交付前写到 .game/rubric.json)

写 `cases/<id>/.game/rubric.json`,6 维度 0-5 自评:

```json
{
  "content-density": 0..5,            // 内容种类丰富度(武器 / 敌人 / 关卡 / 道具)
  "mechanical-differentiation": 0..5, // 同类元素的机制差异(不只换皮)
  "visual-feedback": 0..5,            // 命中 / 死亡 / 升级 / 受伤的瞬时反馈密度
  "hud-information": 0..5,            // HUD 是否覆盖玩家所需的状态信息
  "feel-juice": 0..5,                 // tween / particle / shake / flash 的密度
  "genre-fitness": 0..5               // 与 query 隐含品类的契合度
}
```

缺字段触发 warn-only,不阻塞 delivery。
````

### 改动 3:Phase C 段尾追加 v1.1 引导

在现有 Phase C 段末追加:

````markdown
---

## Phase C v1.1 引导密度

### C.1 qualityHints 容器解读

delivery.json 现在含 `qualityHints` 顶层字段(由 `check_delivery.js` 聚合写入),包含 4 个子项:

| 子项 | 含义 |
|---|---|
| `visual` | `_visual_warn.js` 计算 final.png 的 colorCount / shapeRegions / hudOccupancy / centerActivity;失败时 `available=false, reason=...` |
| `rubric` | 读 case 的 .game/rubric.json,6 维度自评 |
| `scopeReport` | from-query / from-genre-knowledge / from-reasoning 计数 + scope-leaks + 显式 demoted |
| `loc` | 4 字段:scaffoldLoc / businessLoc / helperImportCount / helperCallCount(防止把模板体积当生成质量) |

**所有 qualityHints 子项都是 warn-only**,不影响 delivery verdict。verdict 仍按 milestone / canvas-change / state assertion 决定。qualityHints 是 Stage 2 backlog 的输入。

### C.2 视觉信号 — 默认走文本指标,vision-policy opt-in 多模态

链路默认**不**把 final.png 喂给模型(GLM 等纯文本模型不可用)。视觉信号走 `_visual_warn.js` 计算的文本指标。

支持多模态的模型可经 `cases/<id>/.game/vision-policy.json` opt-in 读图(具体协议见 `resolve_vision_policy.js`),但 case 业务**必须**能在纯文本指标的前提下也产出有意义的反馈。

### C.3 retrospective(可选,**强烈建议**)

delivery 后,worker 读 `delivery.json.qualityHints`,在 `decisions.md` C 段(retrospective)写:

- 视觉指标读后感(colorCount / hudOccupancy 等极端值的归因)
- "如果重来我会改"(进 Stage 2 backlog 的种子)
- scope 自评(from-query 都做了吗 / from-genre-knowledge 推迟了哪些)

retrospective 不强制,但写了能让 Stage 2 演进环的 backlog 更准。

### C.4 通过 ≠ 完成

`delivery-pass` 只表示**首交付证据通过**(主闭环可启动 + 接收输入 + 产生 milestone 证据)。它**不**表示:

- 用户需求已完整验收 → 留 evolution 演进环 Stage 2-5 处理
- 视觉表现已达标 → 看 qualityHints.visual + rubric.visual-feedback
- 内容密度已达标 → 看 qualityHints.rubric.content-density
- 体验已打磨 → 留 retrospective + Stage 5 美化

不要因为 milestone 都亮就认为 case 已经"做完了"。
````

### 改动 4:新增独立段"决策日志原则"

在 SKILL.md 末尾(`## 失败汇报` 之前或之后)插入新段:

````markdown
## 决策日志原则(decision log / rationale)

`cases/<id>/docs/decisions.md` 是 **decision log**,不是 **chain-of-thought dump**。

记录:

- 结论(做了什么决策)
- 依据(基于什么信息 / 约束 / 偏好)
- 权衡(考虑过的其他方案 + 为什么没选)
- 后续风险(若环境变化可能要回头改)

**不要求**:

- 暴露推理过程("我先想 A,然后改 B,然后又改 C")
- "真实思考链"(此命名已废弃,不要使用)
- 完整心理活动复刻

decisions.md 是给后续维护者(包括未来的自己)看的。它的功能是**让人能复核为什么这样选**,不是**让人围观你怎么想到的**。

格式分三段:

- **A 段(Phase A 写)**:设计期决策(5-15 条 Q&A,标 from-query / from-genre-knowledge / from-reasoning)
- **B 段(Phase B in-flight 写)**:实现期决策(架构选择 / 跳过的复杂度 / 文件清单变更理由)
- **C 段(Phase C 后写,可选)**:retrospective(qualityHints 读后感 + 如果重来我会改 + scope 自评)
````

### 改动 5:新增独立段"Phaser 3.90 常见坑"

在 SKILL.md 末尾插入新段:

````markdown
## Phaser 3.90 常见坑(Phase B 写代码时参考)

完整 16 条详见 `evolution-docs/research-notes-phaser.md` § 6。本段只列高频 10 条:

1. **ParticleEmitter** 用 `add.particles(x, y, key, config).explode(n)`,**不要** `manager.createEmitter()`(3.60 已删除会抛错)。粒子无素材时用 `lib/visualTheme.ts` 的 `ensureProceduralTextures(scene)` 自带贴图初始化
2. **FX 系统(Glow / Bloom / Pixelate)仅 WebGL 可用**,CANVAS 静默失败。`lib/visualTheme.ts` 的 `applyGlow / applyBloom` 自带 no-op fallback。**不要把 FX 当核心画面**;case 业务必须能没有 FX 也跑得起来
3. **Camera 重触发用 `force=true`**,否则正在跑的效果会忽略新调用。`lib/visualTheme.ts` 的 `screenShake / screenFlash` 自带 force
4. **`time.timeScale = 0.3`** 影响整个 scene,hit-stop 后**必须 reset**。`lib/visualTheme.ts` 的 `hitImpact` 自动 reset
5. **Container 内 input 不传播**:子对象 `setInteractive` 后,事件不冒泡到 container。要么子对象自己 setInteractive,要么扁平化(rect + text 平铺到 scene 顶层)
6. **`scene.restart()` 不清 tween/timer**,shutdown 钩子要 `tweens.killAll() + time.removeAllEvents()`,否则跨 scene 残留事件 + 内存泄漏
7. **Texture key 缺失静默失败**显示绿框。主动 `if (!textures.exists(key))` 检查,或用 `ensureProceduralTextures` 保底
8. **update 用 `entity.x += speed * delta / 1000`**,不要 `entity.x += speed`(后者随帧率变化)。delta-based update 是 Phaser 标准
9. **循环变量名不要和函数参数同名**(实战坑:`for (const dt of damageTexts) { dt.timer -= dt }` TS2363,因为 dt 在循环内被 shadow 成了 DamageText)
10. **`addKeys('W,A,S,D')`** 返回 `Record<string, Phaser.Input.Keyboard.Key>`,不是 `KeyKeys`。不要乱写类型断言

完整 16 条 + WebGL fallback 模式 + Arcade Body 类型坑 + Phaser 4 兼容等见 [`evolution-docs/research-notes-phaser.md`](../evolution-docs/research-notes-phaser.md) § 6。
````

### 改动 6:新增独立段"推荐 milestone / state 词汇"

在 SKILL.md `Phase A` 段尾(plan.json 字段说明附近)或独立段插入:

````markdown
## 推荐 milestone id 与 state schema(品类通用,Phase B emit 时优先)

### 推荐 milestone id

通用(任何品类都可以用):

| id | 含义 |
|---|---|
| `player-input` | 首次接收到玩家有效输入 |
| `progress-event` | 任何正向进度(击杀 / 拼对一字 / 建筑放置 / 闯关 / 收集) |
| `setback-event` | 任何负向事件(受伤 / 拼错 / 资源不足 / 失去一命) |
| `phase-transition` | 阶段 / 关卡 / 波次推进 |
| `session-resolved` | 会话终结(胜利 / 失败 / 通关 / 时限到) |

case 可以加自己的 milestone(如 `boss-spawn` / `weapon-acquisition` / `combo-achieved`),但优先用通用的。`check_delivery.js` 会从通用 milestone 派生信号(progress-velocity / setback-rate / phase-completion / resolved-distribution)写到 qualityHints。

### 推荐 window.__state schema

```typescript
window.__state = {
  session: {
    phase: 'menu' | 'playing' | 'paused' | 'ended-win' | 'ended-lose',
    elapsedMs: number
  },
  player: {
    progress: number,    // 主进度标量,品类决定含义(score / level / kills / ...)
    life?: number        // 生命 / 血量 / 尝试次数,无此概念省略
  }
  // 其他 genre-specific 字段按需添加
};
```

通用 schema 让 check_delivery.js 能跨 case 计算派生信号。case 可加自己的字段(如 `wave / killCount / weaponCount`),但保留 `session` / `player` 顶层结构。
````

### 改动 7:新增"视觉信号"段(整合视觉 warn / vision-policy / 文本指标)

可独立成段或并入 Phase C 段尾(看排版,推荐独立段更清晰):

````markdown
## 视觉信号(文本默认 / 多模态 opt-in)

链路对视觉的判定走两层,**默认全文本路径**:

```
final.png ──[_visual_warn.js 计算]──> 文本指标
                                       ├─ colorCount       # 颜色种类数
                                       ├─ shapeRegions     # 连通区域数
                                       ├─ hudOccupancy     # 边缘区域占比
                                       └─ centerActivity   # 中心区域活动指标

                                       ↓
                          delivery.json.qualityHints.visual (文本)
                                       ↓
                          模型 retrospective / Stage 2 backlog 输入
```

**Optional 多模态 opt-in**(走 `vision-policy.json`):

支持多模态的 case 模型可在 `.game/vision-policy.json` 设 `allowImageRead: true`,Phase D / retrospective 时可读 `eval/screenshots/final.png`。GLM 等纯文本模型仍只读文本指标。

**关键边界**:_visual_warn.js 计算失败(图片缺失 / 解析失败 / 依赖不可用)→ qualityHints.visual.available = false + reason,**不影响** Stage1 verdict。视觉指标全 warn-only,不阻塞 delivery。
````

## Acceptance criteria

跑下列断言,全部通过:

1. ✅ SKILL.md 含字符串 "decision log" 或 "rationale"
2. ✅ SKILL.md **不**含字符串 "真实思考链"(此命名已废弃)
3. ✅ SKILL.md 不含字符串 `feedbackMoments`(老 anchor)
4. ✅ SKILL.md Phase A 段含 `derivedFrom`、`coreLoop.primaryAction`、`mustAvoid` 关键字
5. ✅ SKILL.md Phase B 段含 `lib/visualTheme` 或 `lib/` 引用建议
6. ✅ SKILL.md Phase C 段含 `qualityHints` 与 `vision-policy` 字段名
7. ✅ SKILL.md 含 "Phaser 3.90 常见坑" 段,正好 10 条(或 10-12),末尾 link 到 `evolution-docs/research-notes-phaser.md`
8. ✅ SKILL.md 含 "推荐 milestone id" 表,5 条通用 milestone 全部存在(player-input / progress-event / setback-event / phase-transition / session-resolved)
9. ✅ SKILL.md 含 "决策日志原则" 段,显式禁用 "真实思考链" 命名
10. ✅ SKILL.md Phase A 段含 "工作 todo 列表" 子段(A.0),提到 `write_todos` / `TaskCreate` 工具,且明确标"建议,不强制"
11. ✅ SKILL.md 既有的 acceptance 反稀释 5 条规则段**完全不变**(diff 只有追加,没有修改)
12. ✅ SKILL.md 既有的 case 隔离硬约束 / 禁读列表段**完全不变**
13. ✅ SKILL.md 既有的 Step 0 工序段**完全不变**

## Out-of-scope

- 不改 Step 0 SOP(已在 N19 之前就锁定)
- 不改 acceptance 反稀释规则(那是 plan.json 内部规则)
- 不改 case 隔离硬约束
- 不动 N19 演进环段
- 不写完整 16 条 Phaser 坑(留 research-notes-phaser.md)
- 不在 SKILL.md 写 `objectPool / spatialGrid`(已 defer 到 v1.2)
- 不在 SKILL.md 写品类专属指南(违 Option C)

## Codex notes / Open questions

- **Q**: SKILL.md 已经很长(估 200+ 行),追加 ~150 行(改动 1-7)会不会更长?
  **A**: 是。但 v1.1 的引导密度本来就要靠 SKILL.md 承载,不能用其他文件替代(SKILL.md 是单一真相源)。压缩后 ~120 行追加,可接受。Codex 实施时**不**进一步压缩,因为每段都有具体作用
- **Q**: 改动 4-7 是独立段还是融入既有段?
  **A**: 改动 4(决策日志原则)、改动 5(Phaser 坑)、改动 7(视觉信号)推荐独立段(放在 SKILL.md 后半,在 N19 演进环段之前)。改动 6(milestone / state 词汇)可融入 Phase A 段尾或独立段,看哪个更顺
- **Q**: Phaser 坑列表选哪 10 条?
  **A**: 选实战中最容易咬人 + Phase B 写代码时最相关的。本文档已列 10 条候选。Codex 实施时不要新增、不要删减,按本清单
- **Q**: SKILL.md 改动需要 self-review 哪些?
  **A**: 跑 acceptance criteria 12 项 + 用 git diff 看改动是否仅在新增段(没有改既有段语义)

## Phase 报告模板

完成时 stdout:

```
[v1.1 phase-4] STATUS=done
files-modified:
  - SKILL.md  (+~150 行 v1.1 引导段;既有判定语义不变,验证通过 git diff)
acceptance-passed: 12 / 12
follow-ups:
  - 视情况后续把 SKILL.md Phaser 段进一步精简(现 10 条,若 PR review 觉得长可缩到 8 条)
blockers: none
```
