# mini-game

Natural-language web mini-game generation skill for Phaser3, TypeScript, and Vite.

## 入口

读 [SKILL.md](./SKILL.md)。流程是 Step 0 -> Phase A -> Phase B -> Phase C。

## 目录布局

```text
cases/                 # 用户 case；每 case 自包含 specs/ + game/ + eval/
docs/known-issues.md   # Phase B 卡住时的只读引导
evolution-docs/        # 首交付后的 Stage 2-5 演进设计说明
schemas/plan.schema.json
scripts/               # Step 0 + plan validate + prepare + delivery
templates/design-template.md
templates/decisions-template.md
templates/archetype-primers/  # OpenGame 五交互原型，不是游戏品类枚举
templates/scaffold/    # KEEP scaffold + src/lib helper 文件；src/lib/HELPERS.md 是 helper 选择索引
tests/                 # smoke tests
```

## 常用 CLI

```bash
# Step 0
node scripts/configure_eval_provider.js cases/<slug> --provider openrouter-api --default-from-policy
node scripts/resolve_vision_policy.js cases/<slug> --host-model <model> --requested unknown
node scripts/check_step0_confirmed.js cases/<slug>
node scripts/check_vision_policy.js cases/<slug>

# Phase A
node scripts/load_primer.js cases/<slug> --archetype <platformer|top_down|grid_logic|tower_defense|ui_heavy>
node scripts/load_primer.js cases/<slug> --clear  # 清空误选 primer 后可重选或保持 none
node scripts/write_phase_a_checklist.js cases/<slug> --query "<raw query>"
node scripts/validate_plan.js cases/<slug>

# Phase B helper
node scripts/prepare_case_game.js cases/<slug>

# Phase C
node scripts/check_delivery.js cases/<slug>
node scripts/check_preview.js cases/<slug>
node scripts/write_handoff.js cases/<slug>
node scripts/start_preview.js cases/<slug>

# Post-delivery evolution
node scripts/triage_router.js cases/<slug> --query "继续打磨收尾" --local
node scripts/run_evolution.js cases/<slug> --query "修复输入响应并美化 HUD" --local
```

`prepare_case_game.js` 会复制 `game/src/lib/HELPERS.md`。Phase B 先读这个索引，再按当前机制只打开相关 helper 源码，不需要把所有 helper 全部读进上下文。

Phase A 先写 `docs/DESIGN.md`、`docs/decisions.md`，再写 `specs/plan.json`。Phase C 会把视觉 warn、rubric、scope 和 LOC 分层统计合并到 `eval/delivery.json.qualityHints`，作为后续演进输入；这些 quality hints 不改变 delivery verdict。

当前链路默认生成桌面 Web 小游戏：标准 canvas 为 960×720，横向动作/竞速/射击等宽视野游戏可用 1280×720，紧凑谜题/棋盘/单屏教学可用 800×600 并在 `docs/decisions.md` 说明取舍；640×480、480×360 只用于 smoke viewport、旧 fixture 或明确复古低分辨率需求。

Phase C 分两层：`check_delivery.js` 判定自动证据，`check_preview.js` 判定能否启动试玩。只要 preview-ready，就应启动游戏、说明玩法和操作，并用 `write_handoff.js` 告知用户可以继续提 bug、需求新增、机制修改、手感/数值和素材/颜色/布局/UI 调整。

首交付后的 Stage 2-5 演进不会自动从 Phase C 触发；需要显式运行 `run_evolution.js`，并从最近一次 delivery 或 preview baseline、delivery/preview/runner、DESIGN / decisions 和 `qualityHints` 出发。

## Codex L3 手动评分 Prompt

这一段用于对旧链路或当前生成结果做人工 L3 评分。它不替代 `check_delivery.js` / `check_preview.js`，而是在可试玩之后，让 Codex 像真实用户一样打开游戏、操作验证，并给出 Visual Usability 和 Intent Alignment 两个 0-100 分。口径参考 OpenGame-Bench：VU 关注画面是否连贯、动态、可感知交互；IA 关注自然语言需求是否被满足。当前链路不做完整自动模拟时，IA 必须由 Codex 用 Computer Use 或浏览器工具实际试玩后判断。

```text
你是 mini-game 链路的 L3 手动评审员。请只评估，不修改任何游戏文件。

评审对象：
- case 路径：/Users/bytedance/Project/mini-game/cases/<slug>
- 原始用户需求：<粘贴原始 query；如果没有，请从 specs/plan.json、docs/DESIGN.md、docs/decisions.md 还原>
- 试玩入口：优先运行 `node scripts/start_preview.js cases/<slug>`，或读取 eval/preview.json / eval/handoff.json 的 launchCommand。

必须读取的材料：
1. specs/plan.json
2. docs/DESIGN.md
3. docs/decisions.md
4. eval/delivery.json
5. eval/preview.json
6. eval/handoff.json
7. game/src/ 中和主循环、输入、反馈、胜负、UI 相关的文件

必须执行的试玩步骤：
1. 启动或打开本地预览 URL。
2. 使用 Computer Use 或浏览器工具模拟真实用户，至少尝试所有声明的 controls。
3. 连续试玩 60-120 秒；如果游戏有明确回合、关卡、波次、胜负或升级目标，至少推进到一次可观察的状态变化。
4. 记录实际操作：按键、点击、拖拽、等待、重试、观察到的反馈。
5. 不要只根据截图或源码打分；如果无法启动，明确写 launch failure。

VU: Visual Usability，0-100 分。评估“用户看见的游戏是否清楚、动态、可交互”。
- 0-20：无法渲染、空白、崩溃，或主要画面不可读。
- 21-40：有画面但结构混乱、几乎静止、交互反馈不明显。
- 41-60：基本可读，有主角/目标/障碍或 UI，但动态、层次、反馈较弱。
- 61-80：画面连贯，元素角色清楚，有持续动画/反馈，玩家能理解如何玩。
- 81-100：视觉层次、动效、状态反馈、HUD/提示都清楚且有打磨感。

VU 分项建议：
- renderCoherence 25 分：画面完整、比例合理、没有明显遮挡/溢出/空白。
- visualHierarchy 25 分：玩家、目标、危险、奖励、UI 信息能快速区分。
- motionAndFeedback 25 分：输入、碰撞、得分、受伤、胜负、进度有可见反馈。
- interactionAffordance 25 分：用户能从画面和提示理解可操作对象与当前状态。

IA: Intent Alignment，0-100 分。评估“游戏是否实现了用户原始需求和设计锚点”。
先把需求拆成 requirement ledger，再逐项给 verdict。
建议权重：
- coreLoop 40 分：主玩法闭环、目标、失败/成功条件是否成立。
- requestedMechanics 30 分：用户明确要求的机制、敌人、道具、关卡、进度、数值是否存在。
- controlsAndFeedback 20 分：操作方式、响应性、状态反馈、可玩节奏是否符合描述。
- themeAndPresentation 10 分：题材、文本、视觉风格、UI 布局是否贴合需求。

单项 verdict：
- pass：完全满足，拿满该项权重。
- partial：有实现但不完整、不稳定或只在源码里存在，拿 40%-70% 权重。
- fail：缺失、不可触发、与需求冲突，拿 0 分。
- not_observable：试玩中无法判断；如果源码/plan 也无法佐证，按 fail；如果有明确证据但试玩窗口未覆盖，按 partial 并说明。

输出必须是中文，最后给 JSON：
{
  "case": "<slug>",
  "status": "scored | launch-failed | insufficient-evidence",
  "vu": {
    "score": 0,
    "breakdown": {
      "renderCoherence": 0,
      "visualHierarchy": 0,
      "motionAndFeedback": 0,
      "interactionAffordance": 0
    },
    "evidence": ["看到/操作到的具体证据"],
    "mainIssues": ["主要视觉可用性问题"]
  },
  "ia": {
    "score": 0,
    "requirements": [
      {
        "id": "r1",
        "text": "需求描述",
        "weight": 0,
        "verdict": "pass | partial | fail | not_observable",
        "evidence": "试玩或源码证据"
      }
    ],
    "mainIssues": ["主要需求对齐问题"]
  },
  "actionsTried": ["实际输入/点击/等待步骤"],
  "recommendedFollowUps": ["建议进入 Stage 2/3/4/5 的后续修改方向"]
}

评分纪律：
- VU 和 IA 分开打；漂亮但不符合需求不能抬高 IA，需求机制存在但画面不可理解不能抬高 VU。
- delivery-pass / preview-ready 只能作为证据，不等于 L3 高分。
- 如果自动检查失败但试玩可用，要诚实记录 evidence mismatch，不要直接判 0。
- 如果启动失败，status 写 launch-failed，并把 VU/IA 限制在 0-20。
- 不要为了评分修代码；发现 bug 只记录 recommendedFollowUps。
```

## 测试

```bash
npm test
npm run test:browser
```
