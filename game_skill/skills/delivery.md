---
name: game-phase-5-delivery
description: "Phase 5 的 Delivery 子步骤：基于 verify 通过后的工程代码和 report.json，生成 docs/delivery.md 与可选 README 补充。"
---

# Phase 5.x: Delivery

## 职责

在 verify 阶段通过后，生成**简洁且可执行**的交付文档。

## 输出

### docs/delivery.md

```markdown
# {项目名} 交付文档

## 项目概述
- 产品名称：{project}
- 游戏类型：{genre}
- 目标平台：{platform}
- 引擎：{runtime}（pin {version-pin}）
- 运行模式：{run-mode}

## 本地运行
- 若 `run-mode=file`：直接 `open game/index.html`
- 若 `run-mode=local-http` 且使用项目根素材库：在项目根目录启动本地静态服务器后访问 `/cases/{project}/game/`

## 项目结构
game/
├── index.html
├── src/               # 如有
└── assets/            # 如有

## 已实现核心功能
- `must-have-features` 中已交付的功能

## 延后 / 降级功能
- 未完整交付的 `nice-to-have-features`
- lite 版交付的 `must-have-features`

## 已知限制
- MVP / lite 范围外内容
- risk-note
- 当前校验未覆盖场景

## 评估结果
- 见 `eval/report.json`
```

### README.md（可选）

若 workspace 已有 README.md，**不要覆盖**，在末尾追加 `## 游戏说明`。

若没有，可新建简短版：

```markdown
# {项目名}

{one-line description}

## 运行
- `run-mode=file`：`open game/index.html`
- `run-mode=local-http`：`cd <project-root> && python3 -m http.server 8080`，访问 `/cases/{project}/game/`

## 详细文档
- `docs/game-prd.md`
- `docs/delivery.md`
- `eval/report.json`
```

## 写作原则

1. **简洁**：不超过 1 页 A4
2. **不重复**：技术细节放 GamePRD，不在 delivery 重复
3. **突出可运行**：让用户一眼知道该怎么启动
4. **指标具体**：用数字，不用形容词
5. **兑现预期**：点名功能哪些交付、哪些延期/降级要清楚

## 输出清单

- [ ] `docs/delivery.md` 存在且核心段落齐全
- [ ] `run-mode` 与实际启动方式一致
- [ ] 若无 README.md，已新建简短版
- [ ] 文档内所有引用路径均真实存在
- [ ] `must-have-features` 的实现状态清晰可见
