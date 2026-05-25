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
templates/scaffold/    # KEEP scaffold 文件
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
node scripts/validate_plan.js cases/<slug>

# Phase B helper
node scripts/prepare_case_game.js cases/<slug>

# Phase C
node scripts/check_delivery.js cases/<slug>
```

## 测试

```bash
npm test
npm run test:browser
```
