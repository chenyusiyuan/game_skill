---
name: game-phase-2-strategy
description: "Phase 2 末尾的 strategy 回写：根据 genre 从 engines/_index.json 推荐 runtime，结合 delivery-target 和 must-have-features 判定 support-level，固化当前交付范围和 risk-note，写回 GamePRD 的 front-matter。不再是独立阶段。"
---

# Phase 2.x: Strategy（GamePRD 末尾回写）

## 职责

GamePRD 主体生成后，在**同一阶段末尾**回写以下 front-matter 字段：

- `delivery-target`: `prototype` / `playable-mvp` / `feature-complete-lite`
- `must-have-features`: 用户这一版明确要保留的功能
- `nice-to-have-features`: 有更好、可后放的功能
- `support-level`: 直接支持 / 降级支持 / 暂不支持
- `engine-plan`: `{ runtime, reason, version-pin }`
- `mvp-scope`: 本版本**实际交付范围**（历史字段名，现用于表示当前交付范围，不等于永远做最小版）
- `risk-note`: 已识别的风险

**不再作为独立阶段**——state.json 里没有 `strategy` 阶段，回写完成即 `prd.status = completed`。

---

## 流程

### Step 0：读功能优先级与交付目标

优先读取 Phase 1 `ClarifiedBrief` 或 GamePRD front-matter 中的：

- `delivery-target`
- `must-have-features`
- `nice-to-have-features`
- `cut-preference`

若缺失，按以下规则推断：

- 用户明确说“demo / 原型” → `prototype`
- 普通短 query → `playable-mvp`
- 长规格、多系统、强参考对象 → `feature-complete-lite`

### Step 1：engine 验证与确认

Phase 1 末尾用户已通过 AskUserQuestion 选择了引擎（写入 brief.md），此处验证选择的合理性。

**前置：3D / 2D 维度门控（最高优先级）**

从 brief.md 的 ClarifiedBrief 读取 `is-3d` 并回写到 GamePRD front-matter。路由规则：

| is-3d | runtime 允许值 | 禁止值 |
|---|---|---|
| `true` | 仅 `three` | `phaser3`/`pixijs`/`canvas`/`dom-ui` |
| `false` | `phaser3`/`pixijs`/`canvas`/`dom-ui` 之一 | `three` |

违反路由 → 直接把 `support-level` 置为 `暂不支持` 或回到 clarify 重新问，**不得**跳过该门控。
这个校验也会被 `check_game_prd.js` 的 FM016 规则兜底阻断。

**引擎匹配度验证**（仅在路由合法后执行）：

从 GamePRD 的 `@game.genre` 读取类型；从 `references/engines/_index.json` 的 `best-fit` 字段确认用户选择是否匹配：

```js
// 伪代码
const genre = gamePrd.game.genre;
const userRuntime = gamePrd.game.runtime;
const is3d = gamePrd.frontMatter.isThreeD;
const engines = readEnginesIndex();
// 3D 路径只考虑 dimension=3d 的引擎；2D 路径排除它们
const pool = engines.filter(e => is3d ? e.dimension === "3d" : e.dimension !== "3d");
const candidates = pool.filter(e => e["best-fit"].includes(genreToCnLabel(genre)));
```

**验证规则**：

| 情况 | 处理 |
|---|---|
| `is-3d` 与 `runtime` 路由冲突（2D/3D 不匹配） | **直接阻断**：回到 clarify 重新问或判定为暂不支持 |
| 用户选的 runtime 在 best-fit 候选中 | 确认，记到 engine-plan.reason |
| 用户选的 runtime 不在候选中但无 hard-rule 冲突 | 保留用户选择，在 risk-note 中提示"非最佳匹配" |
| 用户选的 runtime 与 hard-rule 有冲突 | 在 risk-note 中标注风险，降级为候选中最安全的引擎 |
| 用户 query 中未指定且 Phase 1 漏问 | 按优先级自动选：is-3d=false → dom-ui > canvas > phaser3 > pixijs；is-3d=true → three |

### Step 2：support-level 判定

对照 `references/common/support-levels.md`：

| Level | 判定条件 |
|---|---|
| 直接支持 | 有适配引擎 + 无 hard-rule 能力冲突 + **所有 must-have-features 都能在当前 delivery-target 下落地** |
| 降级支持 | 需要压缩内容量/复杂度，或某些 must-have-feature 只能做 lite 版实现 |
| 暂不支持 | 需要 WebGL 3D、多人联机、原生移动端特性、大型 AI、训练模型等超出 V0 能力 |

**暂不支持时**：写明原因到 `risk-note`，task_done 停下等用户处理（如接受降级或换方案）。

### Step 3：确定交付范围（不是默认最小 MVP）

基于 `delivery-target`、`must-have-features`、`nice-to-have-features` 和 `cut-preference`，在 GamePRD 的 §3 章节明确：

- **本版本必须做**：`must-have-features`
- **本版本尽量做**：`nice-to-have-features`
- **本版本后放**：可以延迟实现的内容

裁剪顺序必须遵守：

1. 先缩**内容量**（关卡数、敌人数、词库量）
2. 再缩**变体深度**（职业数、词缀数、技能分支）
3. 再缩**表现层**（动画、粒子、UI 装饰）
4. **最后才允许动 `must-have-features`，且必须显式写入 risk-note，必要时回问用户**

同时填 front-matter `mvp-scope` 字段（列表形式）。

### Step 4：risk-note 填写

扫描以下风险源：

- 引擎已知 LLM 易错点（读 `engines/{runtime}/guide.md` 的"LLM 易错点"章节，挑 1-2 条高风险）
- hard-rule 校验难度（如"禁止全屏自动索敌"需要 Playwright 断言才能验证）
- 资源依赖（如依赖外部 CDN 图片可能失败）
- 若按当前 delivery-target 仍需裁掉用户点名功能，用户可能不满意的点

每条 risk-note 一句话。

### Step 5：回写 front-matter

```yaml
delivery-target: feature-complete-lite
must-have-features: [点击配对, 3关卡递进, 结果页重试/下一关]
nice-to-have-features: [连击加分, 卡片翻转动画]
support-level: 直接支持                   # 直接支持 | 降级支持 | 暂不支持
is-3d: false                              # 必须与 brief.ClarifiedBrief 一致；true 要求 runtime=three
engine-plan:
  runtime: dom-ui
  reason: "edu-practice + 点击交互 + 无实时循环，DOM 最稳，LLM 首轮正确率最高"
  version-pin: "@tailwindcss/browser@4"
mvp-scope: [3关卡, 默认词库, 点击配对, 倒计时, 分数统计, 结果页, 重试, 下一关]
risk-note:
  - "Tailwind v4 浏览器 CDN 的 @apply 不支持，模型可能误用；guide.md 已提示"
  - "连击规则（连续匹配 3 次 +5 分）在 Playwright 中需要场景化断言"
```

### Step 6：重新跑 check_game_prd.js

```bash
node ${SKILL_DIR}/scripts/check_game_prd.js docs/game-prd.md
```

退出 0 → prd.status = completed；否则修正后重试。

---

## 与 `_index.json` 的协作

读取示例：

```bash
cat ${SKILL_DIR}/references/engines/_index.json | jq '.engines[] | select(."best-fit" | contains(["教育练习型"]))'
```

**推荐时注意**：

- `version-pin` 直接从 `_index.json.engines[].version-pin` 复制到 `engine-plan.version-pin`
- **不要**写 `@latest` / 不锁版本的写法
- 若用户要新引擎（未登记），拒绝，提示用户按 `_adding-new-engine.md` 先登记

---

## 不重新开阶段的原因

早期链路里 Strategy 是独立阶段，但它现在做的是**在不丢失用户预期的前提下**完成 3 件事：选引擎、打 support-level、确定当前交付范围。独立开阶段让对话多一次 task_done 噪音，没有实际价值，因此仍合并到 PRD 末尾。

---

## 禁止事项

- ❌ 看到复杂需求就默认降成最小闭环
- ❌ 静默删除 `must-have-features`
- ❌ 用“这是 MVP”作为省略用户点名功能的默认理由
- ❌ 在 `delivery-target = feature-complete-lite` 时仍按 `prototype` 心态写 PRD

---

## 输出清单

- [ ] `delivery-target` 已确定并写回
- [ ] `must-have-features` / `nice-to-have-features` 已写回
- [ ] `docs/game-prd.md` 的 front-matter 含 `support-level`、`engine-plan.{runtime,reason,version-pin}`、`mvp-scope`、`risk-note`
- [ ] `support-level != "暂不支持"`（否则 task_done 停下）
- [ ] `engine-plan.runtime` 在 `_index.json` 白名单内
- [ ] `check_game_prd.js` 退出 0
- [ ] `state.json` `prd.status = "completed"`，同时记录 `prd.runtime` 字段供 Phase 4 用
