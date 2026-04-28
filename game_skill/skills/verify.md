---
name: game-phase-5-verify
description: "Phase 5: 校验。分层预算：冒烟 ≤2 轮、工程侧 ≤3 轮、产品侧 ≤10 轮、合规审计 ≤2 轮。各层全绿后生成 delivery.md 和 eval/report.json。"
---

# Phase 5: Verify（含 Delivery）

## 职责

验证 Phase 4 产出的 `game/` 工程能跑、能通玩法，并产出交付物。

**输出**：
- `eval/report.json`
- `docs/delivery.md`

其中“产品层”除玩法闭环外，还要检查 `must-have-features` 是否兑现或显式降级。

## 单一入口

正式交付只能由统一入口生成 `eval/report.json`：

```bash
node ${SKILL_DIR}/scripts/verify_all.js cases/${PROJECT} --profile ${PROJECT} --log ${LOG_FILE}
```

`verify_all.js` 顺序运行 mechanics / boot / project / playthrough / runtime_semantics / compliance，并把真实退出码写进 report。任一脚本失败时 report.status 必须是 `failed`。主 agent、子 agent 或人工修复循环都不得手写绿色 `eval/report.json`。

## 两种验证模式

Phase 5 必须先区分本轮是“分层诊断”还是“最终回归”：

| mode | 触发语义 | 执行方式 | 失败处理 |
|---|---|---|---|
| `verify-layered` | 用户说逐层确认、先定位问题、不要端到端 | 按下方层级单独运行脚本 | 第一处失败即停，汇报原因和下一层未跑 |
| `verify-e2e` / `full` | 用户要求最终交付、完整回归、正式验收 | 运行 `verify_all.js` | 可进入受预算约束的修复循环 |

`verify-layered` 禁止直接运行 `verify_all.js`，也禁止在一个失败后自动改代码再继续跑下一层。它的目的不是“刷绿”，而是把问题明确归因到 mechanics / data / contract / runtime / playthrough 的哪一层。

推荐分层顺序：

1. 玩法语义：`check_mechanics.js`
2. 数值可行性：读取 `specs/data.yaml balance-check` 并与代码关卡配置交叉核对
3. Contract/素材：`check_implementation_contract.js`、`check_asset_selection.js`、`check_asset_usage.js`
4. 冒烟：`check_game_boots.js`
5. 工程：`check_project.js`
6. 运行时语义：`check_runtime_semantics.js`
7. 产品走通：`check_playthrough.js`
8. 合规：`check_skill_compliance.js`

只有 1-8 全部通过，才建议切到 `verify-e2e` 跑统一入口生成正式 report。

## 分层预算

| 层 | 脚本 | 预算 | 理由 |
|---|---|---|---|
| 玩法语义 | `check_mechanics.js` | Phase 3/4 前置 | primitive DAG 可执行，至少一个 win scenario 可达 |
| 冒烟 | `check_game_boots.js` | ≤ 2 轮 | 最低门槛：游戏能起、无 console error、gameState 暴露 |
| 工程侧 | `check_project.js` | ≤ 3 轮 | 启动错、语法错、资源错，以及 contract / asset-selection / asset-usage gate |
| 产品侧 | `check_playthrough.js` | ≤ 10 轮 | 玩法 bug 修复更慢 |
| 合规审计 | `check_skill_compliance.js` | ≤ 2 轮 | spec ↔ code 绑定率 / state schema / 场景闭环，机械校验 |

执行顺序固定：**玩法语义 → 冒烟 → 工程 → 产品 → 合规**。`check_implementation_contract.js` / `check_asset_selection.js` / `check_asset_usage.js` 由工程侧脚本链式执行；只有定位单层失败时才单独运行。

## 流程

### Step 0：玩法语义

```bash
node ${SKILL_DIR}/scripts/check_mechanics.js cases/${PROJECT}
```

通过标准：

- `mechanics.yaml` 只使用已登记 primitive
- `grid-board + grid-projection track` 使用 `rect-loop`，不是 `ring`
- `ray-cast.coord-system=grid` 的上游 source 有 `gridPosition`
- hard-rule 全部映射到 invariant/field/nodes
- 至少一个 simulation scenario 到达 `win`

这一步失败时，优先回 Phase 3 修 mechanics / rule / event-graph；不要先改 case 代码。

### Step 1：冒烟

```bash
node ${SKILL_DIR}/scripts/check_game_boots.js cases/${PROJECT}/game/ --log ${LOG_FILE}
```

通过标准：

- 退出 0
- 0 条 console error
- body 有实际文本
- `window.gameState` 已定义

常见失败与修复：

| 信号 | 根因 | 修复 |
|---|---|---|
| file 模式下出现 CORS / ERR_FAILED | 本地 ES module / 相对 import 被拦截 | 改 `RUN: local-http`，或退回 classic/inline script |
| local-http 模式仍有 net error | 资源路径、import 路径、server root 不对 | 修正相对路径和入口 |
| body.innerText 为空 | 启动时抛 pageerror 阻塞渲染 | 读 pageerror 定位文件+行号 |
| gameState undefined | 未暴露 `window.gameState = state` | 在 state 初始化后补上 |

### Step 2：工程侧校验

```bash
node ${SKILL_DIR}/scripts/check_project.js cases/${PROJECT}/game/ --log ${LOG_FILE}
```

通过标准：

- HTML 合法
- 所有 `<script>` 引用的文件存在
- 所有 JS 文件 `node --check` 通过
- 含 `<!-- ENGINE: ... | RUN: ... -->` 标识
- CDN URL pin 到主版本
- `run-mode=file` 时不依赖本地 module src
- `specs/implementation-contract.yaml` 结构完整，contract 被代码实现
- local-file 素材选择合法且在业务代码中有真实消费证据

### Step 3：产品侧校验

```bash
node ${SKILL_DIR}/scripts/check_playthrough.js cases/${PROJECT}/game/ --profile ${CASE_ID} --log ${LOG_FILE}
```

**前置检查 A（必做）：数值平衡校验（可玩性）**

在运行 `check_playthrough.js` 之前，必须先验证关卡数值平衡。这是**纯数据校验**，不依赖多模态/截图，所有 LLM 都可以执行：

1. 读取 `specs/data.yaml` 的 `balance-check` 段
2. 对每个关卡验证 `supply >= demand`
3. 对每个关卡验证 `supply >= demand * 1.2`（容错余量）
4. 同时读取游戏代码中的实际数值（关卡配置、单位属性等），与 `balance-check` 交叉核对

```text
校验流程：
  1. 从 data.yaml balance-check 读取每个关卡的 supply/demand
  2. 从游戏代码（index.html / src/*.js）中 grep 关卡配置常量
  3. 核对两者是否一致
  4. 若 supply < demand → FAIL，必须修正代码中的数值
  5. 若 supply < demand * 1.2 → WARNING，建议调整
```

| 结果 | 处理方式 |
|---|---|
| 所有关卡 supply ≥ demand × 1.2 | ✅ 通过，继续 Playwright 校验 |
| 某关卡 supply < demand × 1.2 | ⚠ Warning，记录到 report，可继续 |
| 某关卡 supply < demand | ❌ **阻断**，必须修正代码数值后重跑（不算在 10 轮修复预算内） |

**交叉核对方法**（纯文本分析，无需运行游戏）：

```bash
# 从代码中提取关卡配置数值
grep -n "level\|ammo\|hp\|target\|block\|enemy\|count\|capacity" game/src/*.js game/index.html
# 与 data.yaml balance-check 的 supply/demand 对照
```

**前置检查 B（必做）：Profile 与 PRD @check 映射校验**

在运行 `check_playthrough.js` 之前，必须先验证 profile 的 assertions 是否覆盖了 PRD 中所有 `@check(layer: product)` 条目：

**推荐入口**：Phase 2 末尾已经用 `extract_game_prd.js --profile-skeleton` 产出了
`game_skill/skills/scripts/profiles/${PROJECT}.skeleton.json`（含每条 @check / hard-rule 的 stub + `check_id` 反向绑定 + `prd_hash`）。
Phase 5 的 profile 作者应当**从 skeleton 起步**，而不是从零手写：

```bash
# 从 skeleton 拷贝一份为正式 profile
cp game_skill/skills/scripts/profiles/${PROJECT}.skeleton.json game_skill/skills/scripts/profiles/${PROJECT}.json
# 然后在 ${PROJECT}.json 里逐条把 _todo 清除、把 setup / expect 填成真实断言
# _prd_method / _prd_expect 字段里保留了 PRD 原话，作为填断言的参考
```

每条 assertion 的 `check_id` 字段指向 PRD 中的 `@check.id`。`check_playthrough.js` 会：
- 用 `check_id` 做反向绑定（比 id/description substring 匹配更精准）
- 比对 `prd_hash`，PRD 变更时打出 `⚠ profile-drift` 警告
- 标记 `check_id` 指向不存在 @check 的 orphan assertion

**后续步骤**（即使不是从 skeleton 起的 profile，也必须对齐）：

1. 从 `docs/game-prd.md` 提取所有 `@check(...)` 条目，筛选 `layer: product` 的：
   ```bash
   grep -E "@check\(" docs/game-prd.md
   ```

2. 逐条核对：每个 `@check(layer: product)` 条目，在 `game_skill/skills/scripts/profiles/{case-id}.json` 的 `assertions` 中是否有对应的 assertion（优先查 `check_id` 字段，回退到 id/description 模糊匹配）。

3. **如果存在未覆盖的 @check 条目**：
   - 列出缺失清单
   - 为每条缺失的 @check 补写 assertion 到 profile.json
   - assertion 必须包含 `setup`（操作步骤：点击、等待等）；正式 profile 禁止写 `expect`
   - **核心交互类 @check 必须有真实的 setup 操作**，不能只做静态状态检查
   - **⚠ eval 直接赋值 gameState 不算"真实交互"**。`setup` 中只包含 `window.gameState.score += 10` / `window.gameState.phase = 'win'` 等直接赋值操作的，本质是"自己出题自己答"，无法验证游戏交互链路（如事件绑定、isProcessing 锁、粒子/动画是否报错等）
   - **真实交互**指以下任一；`window.gameTest.*` 只能辅助，不能替代：
     - `{ "action": "click", "selector": "..." }` —— 通过 Playwright 点击真实 UI 元素
     - `{ "action": "click", "x": 120, "y": 420 }` —— 通过 Playwright 点击 canvas/舞台坐标
     - `{ "action": "press", "key": "ArrowLeft" }` / `{ "action": "fill", "selector": "...", "value": "..." }`

4. **核心交互 assertion 的最低标准**：
   - 配对/匹配类游戏：至少一条"正确配对"断言 + 至少一条"错误配对"断言
   - 点击类游戏：至少一条"点击后状态变化"断言
   - 计时类游戏：至少一条"时间惩罚/奖励"断言
   - 通关类游戏：至少一条"通关流程"断言（从开始到 win/lose）
   - **所有引擎**：至少一条 assertion 的 setup 包含真实 `click` 操作；每条交互类 assertion 自身也必须包含真实 click/press/fill，不能只调游戏 API 函数

5. 补写示例——对于单词配对游戏，以下 assertion 模式是必需的：

   **DOM 游戏（推荐 click 真实 DOM 元素）：**
   ```json
   {
     "id": "match-success",
     "kind": "hard-rule",
     "description": "正确配对卡片后得分增加",
     "setup": [
       { "action": "eval", "js": "window._beforeScore = window.gameState.score" },
       { "action": "click", "selector": "[data-card-id='en-0']" },
       { "action": "click", "selector": "[data-card-id='zh-0']" },
       { "action": "wait", "ms": 500 }
     ],
     "expect": {
       "selector": "window.gameState.score > window._beforeScore",
       "op": "truthy",
       "value": true
     }
   }
   ```

   **Canvas/Pixi/Phaser 游戏（调用游戏暴露的 API 函数）：**
   ```json
   {
     "id": "match-success",
     "kind": "hard-rule",
     "description": "正确配对卡片后得分增加",
     "setup": [
       { "action": "eval", "js": "window._beforeScore = window.gameState.score; window.simulateCorrectMatch();" },
       { "action": "wait", "ms": 500 }
     ],
     "expect": {
       "selector": "window.gameState.score > window._beforeScore",
       "op": "truthy",
       "value": true
     }
   }
   ```

   **❌ 反模式（eval 直接赋值，不再允许作为交互类 assertion）：**
   ```json
   {
     "id": "match-success",
     "setup": [
       { "action": "eval", "js": "window.gameState.score += 10" }
     ],
     "expect": { "selector": "window.gameState.score", "op": "gt", "value": 0 }
   }
   ```
   > 这只测试了 JavaScript 的加法运算，不测试游戏的配对逻辑。

通过标准：

- Playwright headless 启动游戏无 console error
- 每条 `@check(layer: product)` 的 expect 满足
- 每条 `@constraint(kind: hard-rule)` 有对应断言通过
- `must-have-features` 都有可观察实现；若某项只能 lite 化，必须在 report 和 delivery 中写明

### Step 3.5：合规审计（硬门槛）

`check_project.js` 做的是"工程能不能跑"；`check_skill_compliance.js` 做的是"spec ↔ code 有没有脱节" —— 包括：

- **structure**：必需产物齐全 / ENGINE 标记 / 无残留 `specs/.pending/`
- **state**：`schemaVersion === 1` / expand subtasks 齐全 / 不处于 legacy migrate 状态
- **contract**：`implementation-contract.yaml` 存在，local-file 有语义绑定，required local-file 禁止静默 fallback
- **assets**：`assets.yaml` 的 `type: local-file` 条目代码引用率 ≥ 50%，原始绘制不能压倒素材加载
- **effects**：`rule.yaml` 声明的 visual 动词（`particle-burst` / `screen-shake` / `tint-flash` / …）至少有 50% 在代码里能找到对应 API 调用
- **events**：`scene-transitions` 的 to 目标都定义过；PRD 提到多关卡时代码必须有 `regenerateFloor/enterFloor/scene.restart` 之类的重建入口

```bash
node ${SKILL_DIR}/scripts/check_skill_compliance.js cases/${PROJECT} --log ${LOG_FILE}
```

通过标准：退出码 0（得分 ≥ 70 且无 severity=error）。预算 ≤ 2 轮；失败走常规修复循环（Step A 日志 / Step B 改代码 / Step C 重跑）。

> 此门槛**在产品侧通过之后**才跑。它不替代 `check_project.js`，而是在工程 / 玩法都绿以后做最后一层"结构兜底"，兜住 spec 绑定这种工程脚本抓不到的问题。

### Step 4：三层指标采集

通过后由 `verify_all.js` 生成 `eval/report.json`：

```json
{
  "case": "word-match-lite",
  "runtime": "dom-ui",
  "run_mode": "file",
  "timestamps": { "start": "...", "end": "..." },
  "chain_metrics": {
    "understand_rounds": 1,
    "clarify_triggered": false,
    "prd_check_rounds": 1,
    "support_level": "直接支持",
    "engine_chosen": "dom-ui"
  },
  "engineering_metrics": {
    "project_check_rounds": 1,
    "startup_errors": 0,
    "first_screen_errors": 0
  },
  "contract_metrics": {
    "contract_check_rounds": 1,
    "contract_errors": 0,
    "required_local_assets_consumed": "12/12",
    "runtime_asset_load_errors": 0
  },
  "product_metrics": {
    "playthrough_rounds": 2,
    "hard_rules_passing": "3/3",
    "checks_passing": "5/5",
    "prd_check_coverage": "4/4",
    "has_interaction_assertions": true,
    "balance_check": {
      "levels_checked": 3,
      "levels_passed": 3,
      "levels_warning": 0,
      "levels_failed": 0,
      "details": [
        { "level": 1, "supply": 12, "demand": 8, "margin": "50%", "verdict": "PASS" }
      ]
    }
  },
  "requirement_metrics": {
    "must_have_total": 3,
    "must_have_delivered": 3,
    "must_have_degraded": 0
  },
  "compliance_metrics": {
    "compliance_rounds": 1,
    "score": 95,
    "errors": 0,
    "warnings": 1,
    "failing_rules": []
  }
}
```

报告生成原则：`eval/report.json` 只能由 `verify_all.js` 汇总 verifier/check 脚本的真实结果。不得写“素材 404 是测试服务器限制”“视觉上已 fallback 所以通过”这类 LLM 自我解释；如果 check 有错误，report 必须保留错误并判失败。

### Step 5：生成 delivery.md

交付文档必须写清楚：

- 引擎与 `run-mode`
- 本地运行方式
- 已实现核心功能
- 延后 / 降级功能
- 已知限制

### Step 6：打 PRD / assets 快照（P2-1，为后续反馈分流做基线）

```bash
node ${SKILL_DIR}/scripts/prd_diff.js --snapshot cases/${PROJECT}
```

写到 state.json 的 `prdSnapshot` / `assetsSnapshot` 字段。之后用户如果提反馈，`prd_diff.js --diff` / `--classify` 会据此判断反馈类型（code-bug / design-change / art-change）并建议重跑路径，详见 SKILL.md 的「用户反馈修复」段。

---

## 失败处理

每次修复后、重跑校验前，**必须写一条 fix-applied 日志**：

```bash
echo '{"timestamp":"'$(date -u +%FT%TZ)'","type":"fix-applied","phase":"verify","step":"<boot|project|playthrough>","round":<N>,"failures":["<失败项>"],"fix_description":"<修了什么>","files_changed":["<文件>"]}' >> ${LOG_FILE}
```

- 冒烟 2 轮未过：失败并停下
- 工程侧 3 轮未过：失败并停下
- 产品侧 10 轮未过：失败并停下
- 合规审计 2 轮未过：失败并停下
- `check_playthrough.js` 退出 3（Playwright 缺失）→ 停下报用户，不做"人工走查代替"
- `check_playthrough.js` 退出 4（Profile 覆盖率不足或交互类 assertion 缺真实输入）→ **不进入修复循环**，停下补写 profile assertions 后重跑（不算在 10 轮内）；**不允许用 `--skip-coverage` 绕过**

---

## 手动复核建议

- `run-mode=file`：手动 `open game/index.html` 走一遍
- `run-mode=local-http`：在本地静态服务器下手动点一遍
- 检查视觉是否符合 `color-scheme`
- 检查 hard-rule 是否真的被遵守，而不是仅断言侥幸通过

---

## 输出清单

- [ ] `check_project.js` 退出 0
- [ ] `check_mechanics.js` 退出 0
- [ ] `check_playthrough.js --profile {case-id}` 退出 0
- [ ] `eval/report.json` 三层指标齐全，含 `run_mode`
- [ ] `must-have-features` 的兑现情况已写入 report/delivery
- [ ] `docs/delivery.md` 核心段落齐全（项目概述/本地运行/已实现功能/延后功能/已知限制/评估结果）
- [ ] `state.json` `verify.status = "completed"`
