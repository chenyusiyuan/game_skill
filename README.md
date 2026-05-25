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
templates/archetype-primers/
templates/scaffold/    # KEEP scaffold + src/lib helper 文件
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
node scripts/load_primer.js cases/<slug> --archetype <vampire-survivors|shooter|breakout|topdown|tower-defense>
node scripts/validate_plan.js cases/<slug>

# Phase B helper
node scripts/prepare_case_game.js cases/<slug>

# Phase C
node scripts/check_delivery.js cases/<slug>
```

Phase A 先写 `docs/DESIGN.md`、`docs/decisions.md`，再写 `specs/plan.json`。Phase C 会把视觉 warn、rubric、scope 和 LOC 分层统计合并到 `eval/delivery.json.qualityHints`，作为后续演进输入；这些 quality hints 不改变 delivery verdict。

## 测试

```bash
npm test
npm run test:browser
```
