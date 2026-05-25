# Phase 3 — 脚本扩展(prepare / validate / check_delivery + 新增 _visual_warn / load_primer)

## Goal

把 Phase 1 的模板与 Phase 2 的 lib/ 串接到验证流程,加入 1 个 hard gate + 多个 warn-only signals + LOC 分层统计 + 按需 primer 加载机制。

**关键边界**:
- **唯一 hard gate**:`generation-blocked: design-anchor-missing`(plan.json `derivedFrom` 必须解析到实际 DESIGN.md anchor)
- 其他全 warn-only,经 `delivery.json.qualityHints` 反馈
- prepare_case_game.js **不**自动复制任何 primer(primer 走 on-demand load_primer.js)
- check_delivery.js LOC 分层统计**强制**写入 4 字段(防止把模板体积当生成质量)

> 上下文锚点:
> - plan 文件 § "24 条锁定决策" item 5, 11, 18, 19, 21
> - 现有 `scripts/prepare_case_game.js` / `validate_plan.js` / `check_delivery.js`(扫现状,看在哪里加分支)

## Pre-requisites

- Phase 1 完成(模板就位,Phase 3 prepare_case_game.js 要复制 design/decisions 模板)
- Phase 2 完成 + 链路作者 sign-off(lib/ 4 文件 known-good,Phase 3 prepare 要把它们加入 SCAFFOLD_FILES)

## Files to create

| 路径 | 性质 | LOC 估 |
|------|------|---|
| `scripts/_visual_warn.js` | internal helper(下划线前缀) — 读 final.png 产文本指标 | ~120 |
| `scripts/load_primer.js` | 顶层 CLI — 按需复制单个 archetype primer | ~50 |

## Files to modify

| 路径 | 修改类型 | 修改原则 |
|------|---------|---------|
| `scripts/prepare_case_game.js` | 扩 SCAFFOLD_FILES 数组 + 新建 `templates/<>` → `cases/<>/<>` 映射;**不**自动复制 primer | 仅追加文件,不改既有 KEEP 行为 |
| `scripts/validate_plan.js` | 新增 anchor xref 分支(产 `generation-blocked: design-anchor-missing`)+ scope-leak warn 分支 | 既有 plan-invalid 等错误码不动 |
| `scripts/check_delivery.js` | 写 `eval/delivery.json` 之前,聚合 qualityHints(visual + rubric + scopeReport + loc 分层) | 不改既有 verdict 判定逻辑 |

不动:`scripts/_baseline_writer.js` / `_evolution_log.js` / `triage_router.js` / `run_evolution.js` / `_stage_<n>_worker.js` / `_mustnot_evaluator.js` / `_delivery_runner.mjs` 等 N19 演进环工件。

## Forbidden

- 不在 prepare_case_game.js 加 archetype 关键词检测或自动复制 primer 的逻辑
- 不修改 milestone / smoke runner 既有规则
- 不修改 evidence reflection / acceptance 反稀释规则
- 不修改 `schemas/plan.schema.json`(本轮冻结;新增 derivedFrom 字段约束在文档中描述,留待 Phase 4 SKILL.md 同步,**不**写到 schema)
- 不引入新 npm 依赖
- 不让 _visual_warn.js 失败影响 Stage1 verdict(失败时 qualityHints.visual.available=false 并继续)

## Interface contracts

### `scripts/_visual_warn.js`

```js
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 读 cases/<id>/eval/screenshots/final.png 计算文本视觉指标。
 *
 * **失败时不抛错**:文件缺失 / 解析失败 / 依赖缺失 → 返回 { available: false, reason }
 * 这样 case 仍可正常 deliver,只是 qualityHints.visual 标 unavailable。
 *
 * @param {string} caseDir - 绝对路径
 * @returns {Promise<VisualMetrics>}
 */
export async function computeVisualWarn(caseDir) { ... }

/**
 * @typedef {Object} VisualMetrics
 * @property {boolean} available
 * @property {string} [reason]                    - available=false 时填
 * @property {number} [colorCount]                - 颜色种类数(5-bit quantize 后聚类)
 * @property {number} [shapeRegions]              - 连通区域数(粗略形状种类)
 * @property {number} [hudOccupancy]              - 边缘区域(top/bottom 10%)非空占比 0..1
 * @property {number} [centerActivity]            - 中心 30% 区域颜色变化指标 0..1
 * @property {string[]} [warnings]                - 极端值触发的 warning,e.g. ['colorCount-low', 'hud-empty']
 */
```

实现要点:
- 用 `node:fs` 读 PNG,用纯 JS 库解析(不要新增 npm 依赖;`png-js` 若已在 dep tree 可用,否则用 buffer 手解析或直接降级 available=false)
- 极端值 warning 阈值:colorCount < 5 → 'colorCount-low';shapeRegions < 8 → 'shapeRegions-low';hudOccupancy < 0.05 → 'hud-empty';centerActivity < 0.1 → 'center-static'
- **不**抛错。任何异常都 catch + 返回 `{ available: false, reason: <error.message> }`

### `scripts/load_primer.js`

```js
#!/usr/bin/env node
/**
 * 按需复制单个 archetype primer 到 case 的 .game/archetype-primer.md
 *
 * Usage: node scripts/load_primer.js cases/<id> --archetype <X>
 *
 * Behavior:
 *   - X ∈ {vampire-survivors, shooter, breakout, topdown, tower-defense}
 *     → 复制 templates/archetype-primers/<X>.md 到 cases/<id>/.game/archetype-primer.md
 *     → exit 0
 *   - X 不在 5 个内 → stderr 输出 "unknown archetype, no primer loaded" → exit 0(**不**报错)
 *   - cases/<id> 不存在 → exit 1
 *   - 已存在 .game/archetype-primer.md → 询问 / 默认覆盖(决策:默认覆盖,与 prepare_case_game.js 的 KEEP 行为一致)
 */
```

CLI 输出:

```
$ node scripts/load_primer.js cases/foo --archetype shooter
[load_primer] copied templates/archetype-primers/shooter.md -> cases/foo/.game/archetype-primer.md

$ node scripts/load_primer.js cases/foo --archetype racing
[load_primer] unknown archetype 'racing', no primer loaded
[load_primer] available archetypes: vampire-survivors, shooter, breakout, topdown, tower-defense
```

### `scripts/prepare_case_game.js` 扩展

现状(读 `prepare_case_game.js` 头 30 行可知):

```js
const SCAFFOLD_FILES = [
  ["index.html", "game/index.html"],
  ["package.json", "game/package.json"],
  ["tsconfig.json", "game/tsconfig.json"],
  ["vite.config.js", "game/vite.config.js"],
  ["main.ts", "game/src/main.ts"],
  ["milestone.ts", "game/src/milestone.ts"],
];
```

修改后:

```js
const SCAFFOLD_FILES = [
  ["index.html", "game/index.html"],
  ["package.json", "game/package.json"],
  ["tsconfig.json", "game/tsconfig.json"],
  ["vite.config.js", "game/vite.config.js"],
  ["main.ts", "game/src/main.ts"],
  ["milestone.ts", "game/src/milestone.ts"],
  // v1.1 新增:lib helper(全 KEEP scaffold 一部分)
  ["src/lib/visualTheme.ts", "game/src/lib/visualTheme.ts"],
  ["src/lib/inputController.ts", "game/src/lib/inputController.ts"],
  ["src/lib/hudBuilder.ts", "game/src/lib/hudBuilder.ts"],
  ["src/lib/progressionMath.ts", "game/src/lib/progressionMath.ts"],
];

// v1.1 新增:模板复制(template/<X>.md → cases/<id>/docs/<X>.md)
const TEMPLATE_FILES = [
  ["design-template.md", "docs/DESIGN.md"],
  ["decisions-template.md", "docs/decisions.md"],
];
```

KEEP_SCAFFOLD set 同步扩入 `src/lib/*.ts`(KEEP 语义:每次 prepare 都覆盖,确保 case-time lib/ 与 templates/scaffold/src/lib/ 一致)。

TEMPLATE_FILES 复制行为:
- 默认 `overwrite='kept-only'`:case 已有 docs/DESIGN.md → 不覆盖(让 worker 在上次基础上继续编辑);case 没有 → 复制模板
- 链路作者用 `--reset` 标志可强制覆盖(用于 reset case 起点)

**禁止**在 prepare_case_game.js 添加任何 archetype primer 复制逻辑;primer 走独立 load_primer.js。

### `scripts/validate_plan.js` 扩展

现状(粗读):AJV 校验 `specs/plan.json` 通过 schema,失败时输出 `generation-blocked: plan-invalid`。

新增分支(在现有校验通过后追加):

#### 分支 A — anchor xref hard gate(generation-blocked: design-anchor-missing)

逻辑:
1. 若 `cases/<id>/docs/DESIGN.md` 不存在 → 跳过此检查(DESIGN.md 缺失走 warn 而非 hard gate;hard gate 只针对"DESIGN.md 存在但 plan.json 引用错锚点"的情况)
2. 若存在,扫 `plan.json.requiredMechanics[].derivedFrom` 字段;每条引用必须能在 DESIGN.md 中精确定位 anchor(parse YAML / 找 markdown anchor)
3. 4 个稳定 anchor(`visualIdentity.palette` / `uiSurfaces.primary` / `coreLoop.primaryAction` / `mustAvoid.<X>`)必须至少有一个被引用
4. 任何 derivedFrom 字符串解析失败 → exit 1 + `generation-blocked: design-anchor-missing` + 列出失败的 derivedFrom 字符串与可用 anchor 列表

#### 分支 B — scope-leak warn(warning,不阻塞)

逻辑:
1. 若 `cases/<id>/docs/decisions.md` 存在,扫 A 段 Q&A 标 `from-query` 的条目
2. 每条 from-query 内容必须能在 `plan.json.requiredMechanics[].name` 或 `plan.json.acceptance.mustHave[].text` 中找到对应
3. 找不到对应 → 触发 scope-leak warning(写 stderr + 写到 validate-result.json,不 exit 1)
4. 例外:decisions.md 显式有"降级理由"段说明该 from-query 项被推迟到 nonblockingTodos,则不 warn

输出格式:

```
[validate_plan] WARN scope-leak: from-query "X" not in requiredMechanics or mustHave
                                  (no demote rationale found in decisions.md)
```

### `scripts/check_delivery.js` 扩展

现状:跑 delivery runner,产 `eval/delivery.json` 含 status / warnings / detail.runner / detail.diagnostic。

新增逻辑(在 delivery.json 写入前):

```js
import { computeVisualWarn } from './_visual_warn.js';

// ... 既有 delivery 计算 ...

// v1.1 新增:聚合 qualityHints
const qualityHints = {
  visual: await computeVisualWarn(caseDir),
  rubric: readRubricIfExists(caseDir),    // 读 .game/rubric.json 或返回 { available: false }
  scopeReport: readScopeReport(caseDir),  // 从 decisions.md 提取 from-query / from-genre-knowledge / from-reasoning 计数
  loc: computeLocBreakdown(caseDir),      // 4 字段,见下
};

deliveryRecord.qualityHints = qualityHints;
```

#### qualityHints.loc 计算(强制 4 字段)

```js
function computeLocBreakdown(caseDir) {
  // 1. 列 game/src/ 下所有 .ts 文件
  // 2. 把 game/src/lib/ + game/src/main.ts + game/src/milestone.ts 标 scaffold(KEEP)
  // 3. 其他 .ts 标 business
  // 4. 解析每个 business .ts 的 import 语句,统计 from './lib/...' 的 import 次数
  // 5. 解析每个 business .ts 的代码,grep 已 import 的 helper 函数名实际调用次数

  return {
    scaffoldLoc: <int>,         // KEEP 文件总行数
    businessLoc: <int>,         // worker 生成的总行数
    helperImportCount: <int>,   // import 的 lib helper 数(去重)
    helperCallCount: <int>,     // 实际调用次数(去重 helper 名,但同名多次调用算多次)
  };
}
```

**关键**:`helperImportCount` 与 `helperCallCount` 区分"挂个 import 凑数"vs"真在用"。后者 < 2 时触发 warn(写 qualityHints.warnings 里),不阻塞。

#### qualityHints.scopeReport 写入

```js
{
  available: boolean,
  fromQueryCount: number,         // decisions.md A 段 from-query 标的条目数
  fromGenreKnowledgeCount: number,
  fromReasoningCount: number,
  scopeLeaks: string[],           // validate_plan.js B 分支识别的 scope-leak 描述
  demoted: string[],              // decisions.md 显式标"降级理由"的条目
}
```

#### qualityHints.rubric 写入

读 `cases/<id>/.game/rubric.json`(若存在),期望结构:

```json
{
  "content-density": 0..5,
  "mechanical-differentiation": 0..5,
  "visual-feedback": 0..5,
  "hud-information": 0..5,
  "feel-juice": 0..5,
  "genre-fitness": 0..5
}
```

任何字段缺失 → `qualityHints.rubric.available = false, missing: [...]`(warn,不阻塞)。

#### delivery.json 最终结构

```json
{
  "status": "delivery-pass | delivery-with-warnings",
  "warnings": [...],
  "detail": { "runner": {...}, "diagnostic": {...} },
  "timestamp": "...",
  "qualityHints": {
    "visual": { "available": true, "colorCount": 7, "shapeRegions": 14, "hudOccupancy": 0.12, "centerActivity": 0.45, "warnings": [] },
    "rubric": { "available": true, "content-density": 4, "mechanical-differentiation": 3, ... },
    "scopeReport": { "available": true, "fromQueryCount": 8, "fromGenreKnowledgeCount": 12, "fromReasoningCount": 3, "scopeLeaks": [], "demoted": [...] },
    "loc": { "scaffoldLoc": 670, "businessLoc": 1240, "helperImportCount": 4, "helperCallCount": 11 }
  }
}
```

**verdict 判定不变**:仍按 milestone / canvas-change / state assertion 决定 `delivery-pass` vs `delivery-with-warnings` vs `chain-blocked`。`qualityHints` 是附加信息,**不影响**这些 verdict。

## Acceptance criteria

跑下列断言,全部通过:

1. ✅ `_visual_warn.js` 与 `load_primer.js` 文件存在
2. ✅ `prepare_case_game.js` SCAFFOLD_FILES 含 4 个 `src/lib/*.ts` + TEMPLATE_FILES 含 2 个模板
3. ✅ `prepare_case_game.js` **不**含字符串 `archetype-primer` 或 `archetype-primers`(确认 primer 不被 prepare 自动复制)
4. ✅ 跑 `node scripts/load_primer.js cases/<existing-case> --archetype shooter` → 复制成功 + exit 0
5. ✅ 跑 `node scripts/load_primer.js cases/<existing-case> --archetype racing` → stderr 提示 + exit 0(**不报错**)
6. ✅ 跑 `node scripts/validate_plan.js cases/vampire-glm`(现存 case)→ 通过(无 design-anchor-missing,因为 vampire-glm 没有 DESIGN.md → 跳过此检查)
7. ✅ 故意制造 `cases/<test-case>/docs/DESIGN.md` 与 `plan.json.derivedFrom: "visualIdentity.fakekey"` → validate_plan.js exit 1 + `generation-blocked: design-anchor-missing`
8. ✅ 跑 `node scripts/check_delivery.js cases/vampire-glm` → `delivery.json` 含 `qualityHints` 顶层字段 + 4 个子项(visual / rubric / scopeReport / loc)
9. ✅ `qualityHints.loc` 4 字段都有数值;`scaffoldLoc + businessLoc` 与实际 `game/src/**/*.ts` 总行数误差 < 5%
10. ✅ `qualityHints.visual.available` = true 或 false 都不影响 delivery verdict(把 final.png 删掉跑一次,确认 delivery 仍 pass)
11. ✅ scope-leak warn 不导致 exit 1(用一个 from-query 标但 mustHave 缺失的 decisions.md 跑 validate_plan.js,确认 stderr 出 warn 但 exit 0)

## Out-of-scope

- 不改 milestone / smoke runner 既有规则(不动 `_delivery_runner.mjs`)
- 不改 evidence reflection / acceptance 反稀释规则
- 不在 prepare_case_game.js 加 archetype 关键词检测
- 不修改 schemas/plan.schema.json(plan.schema 本轮冻结)
- 不让 _visual_warn 失败影响 Stage1 verdict
- 不写 SKILL.md 改动(Phase 4)

## Codex notes / Open questions

- **Q**: _visual_warn.js 不能引入新 npm 依赖,怎么解析 PNG?
  **A**: 三个可用方案:
    1. 检查 `package-lock.json`,看 phaser/playwright 是否传递依赖了 `pngjs` 或类似 → 直接 import
    2. 写一个最小的 PNG header 解析(只读 IHDR + 像素 buffer,不解 chunk)
    3. 若都不行,降级到"available=false, reason='no png parser available'",不阻塞 delivery
    选 1 优先;1 不可用退 2;2 失败退 3
- **Q**: load_primer.js 已有 archetype-primer.md 怎么办?
  **A**: 默认覆盖。Worker 在 Phase A 决定 archetype 后**只调一次** load_primer;如果中途换 archetype 是"我之前想错了"的场景,新 primer 覆盖旧 primer 是合理的
- **Q**: derivedFrom 引用怎么 parse?
  **A**: design-template.md 用 yaml block 包裹关键 anchor。validate_plan.js 用最小 yaml parser(可手写正则提取 `coreLoop.primaryAction:` / `mustAvoid:` 等 top-level keys 与 nested keys,不引入完整 yaml lib)。derivedFrom 字符串就是 dotted path 如 `coreLoop.primaryAction`,split('.') 后逐层查
- **Q**: helperCallCount 怎么算?
  **A**: 不需要 AST,grep 即可。先读 import 语句确定 import 的 helper 名字 set;然后在每个 business .ts 中正则 `\b(helper1|helper2|...)\s*\(` 计算调用次数。precision 不需要完美,粗略数足够给"是不是真在用"的信号
- **Q**: rubric.json 的写入由谁?
  **A**: case worker 在 Phase B 完成时手写。SKILL.md(Phase 4)会引导 worker 写。本 phase 只读 + 校验结构

## Phase 报告模板

完成时 stdout:

```
[v1.1 phase-3] STATUS=done
files-created:
  - scripts/_visual_warn.js
  - scripts/load_primer.js
files-modified:
  - scripts/prepare_case_game.js  (+SCAFFOLD_FILES 4 lib + TEMPLATE_FILES 2 docs)
  - scripts/validate_plan.js      (+anchor xref hard gate +scope-leak warn)
  - scripts/check_delivery.js     (+qualityHints aggregation +loc breakdown)
acceptance-passed: 11 / 11
follow-ups:
  - schemas/plan.schema.json 字段 (derivedFrom / nonblockingTodos 0-8) 推迟到下一轮 schema mint
blockers: none
```
