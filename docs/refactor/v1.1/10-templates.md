# Phase 1 — 模板(Design / Decisions / Archetype Primers)

## Goal

落地三类**纯模板文件**,作为后续 Phase 的引导素材库:

- `templates/design-template.md` — DESIGN.md 编写骨架(4 必填 anchor + 跨品类样例)
- `templates/decisions-template.md` — decision log / rationale 写作骨架(Q&A + 实现期决策 + retrospective)
- `templates/archetype-primers/<X>.md` × 5 — 5 个品类知识文档(**仅按需加载**,不参与路由)

本 Phase 不动任何脚本、不复制到任何 case。Phase 3 的 `prepare_case_game.js` 才会把 design/decisions 模板加入 SCAFFOLD_FILES;primer 走按需(Phase A 模型识别 → `load_primer.js` 拉取),**不**自动复制。

> 上下文锚点:plan 文件 § "通用 DESIGN.md anchor 结构"、§ "24 条锁定决策" item 7-11、§ "Per-Phase 大纲" `10-templates.md`

## Pre-requisites

无。Phase 1 是依赖图的根节点。

## Files to create

| 路径 | 性质 | 估行 |
|------|------|---|
| `templates/design-template.md` | DESIGN.md 编写骨架 | ~80 行 |
| `templates/decisions-template.md` | decision log 编写骨架 | ~70 行 |
| `templates/archetype-primers/vampire-survivors.md` | 品类知识 | ~80 行 |
| `templates/archetype-primers/shooter.md` | 品类知识 | ~90 行 |
| `templates/archetype-primers/breakout.md` | 品类知识 | ~70 行 |
| `templates/archetype-primers/topdown.md` | 品类知识 | ~80 行 |
| `templates/archetype-primers/tower-defense.md` | 品类知识 | ~80 行 |

## Files to modify

无。Phase 3 才动 `prepare_case_game.js`。

## Forbidden

- 不修改 `templates/scaffold/`(Phase 2 才动)
- 不修改 `scripts/`(Phase 3 才动)
- 不修改 `SKILL.md`(Phase 4 才动)
- 不在任何模板里硬编码品类专属代码
- 不写旧 action-bias anchor 名(已替换为 `coreLoop` / `temporalShape`)

## Interface contracts

### `design-template.md`

文件本身就是模板内容 + 指引注释。结构如下:

````markdown
# DESIGN.md

> 这是本 case 的视觉与体验设计契约。worker 在 Phase A 必须把下列 4 个 anchor 写完整,
> Phase B 写代码时按这份文档调色 / 排版 / 选反馈。
>
> 必填 anchor: `visualIdentity` / `uiSurfaces` / `coreLoop` / `mustAvoid`
> 选填 anchor: `temporalShape`
>
> 不要使用旧 action-bias anchor 名
> (已废弃,会触发 warn-only 检查)。

## visualIdentity

```yaml
visualIdentity:
  palette:
    background: '#<hex>'    # 主背景
    primary: '#<hex>'       # 主前景 / 玩家 / 主体
    secondary: '#<hex>'     # 次前景 / 敌方 / 障碍
    accent: '#<hex>'        # 强调色 / 收集物 / 成功反馈
    danger: '#<hex>'        # 警告 / 失败 / 受伤
  motif: <一句话视觉气质锚点>
```

**意象锚点写作要求**:不写"暗黑风格"或"科技蓝",写一个**非数字世界的真实场景**(参考 design-style-thinking
方法论),例如"月下荒野中的篝火孤影"、"晨光透过白色纱帘的极简客厅"、"实验室冷光下的手术台"。

## uiSurfaces

```yaml
uiSurfaces:
  primary:
    description: <主 UI 表面 + 出现时机>     # 例: 全程显示的 HUD / 入场牌堆 / 棋盘
    elements: [<元素 1>, <元素 2>, ...]
  secondary:
    description: <次 UI 表面>                # 例: 暂停菜单 / 设置 / 商店
    elements: [...]
  feedback:
    description: <短暂反馈表面>              # 例: 得分跳动 / 提示弹幕 / 反馈文字
    elements: [...]
```

## coreLoop

```yaml
coreLoop:
  primaryAction: <玩家反复做的事>            # shooter: 瞄准 + 开火 / wordle: 提交猜测 / 建造: 放置建筑
  successSignal: <做对的瞬时反馈>            # 粒子+震屏 / 字母变绿 / 烟花+收益
  failureSignal: <失败/受挫的反馈>           # 屏幕红闪 / 红色提示 / 资源不足
  iterationFeel: <每次的感觉>                # 击毁的快感 / 缩小可能性 / 看城市变大
```

## temporalShape (选填)

```yaml
temporalShape:
  shape: <linear-escalation | wave-based | level-based | endless | sandbox | narrative-arc | session-bounded>
  description: <一段话>                      # 例: 30秒一波,每波怪物数量+5血量×1.15
```

## mustAvoid

至少 3 条,**必须**包含 `default-purple-blue-orbs`(防 AI 默认蓝紫圆点审美):

- default-purple-blue-orbs       # 不要用默认 0x4488ee 蓝 + 0x8844aa 紫 + 圆点
- <case 专属禁忌 1>
- <case 专属禁忌 2>
- ...

---

## 跨品类样例(参考用)

### 雷霆战机 (vertical scrolling shooter)

```yaml
visualIdentity:
  palette: { background: '#0a0a1a', primary: '#4af0ff', secondary: '#ff3344', accent: '#ffe070', danger: '#ff0066' }
  motif: 深空之中飞行员追逐微弱的星点燃料光,脚下是无止境的敌机潮
coreLoop:
  primaryAction: 瞄准 + 开火 + 闪躲
  successSignal: 击毁敌机 + 粒子爆炸 + 短震屏 + 飘分
  failureSignal: 全屏红闪 + iframe 1-2 秒 + 屏幕震
  iterationFeel: 弹幕清屏的爽快 + 武器升级带来的"挡得住更多"
temporalShape:
  shape: wave-based
  description: 每波 30-45 秒,数量 + 强度同时上升;每 5 波 boss
```

### Wordle (拼字)

```yaml
visualIdentity:
  palette: { background: '#ffffff', primary: '#787c7e', secondary: '#c9b458', accent: '#6aaa64', danger: '#787c7e' }
  motif: 报纸版面上的字谜,每个空格都是确定性逐渐显形
coreLoop:
  primaryAction: 输入 5 字母词 + 提交
  successSignal: 字母翻牌 + 颜色绿/黄/灰 + 行向下推进
  failureSignal: 不在词典 → 抖动一下 + 不消耗次数
  iterationFeel: 逐渐缩小可能空间,从混沌到收敛
temporalShape:
  shape: session-bounded
  description: 6 次机会,猜对即胜,猜满即败
```

### 城市建造 (sandbox)

```yaml
visualIdentity:
  palette: { background: '#a8d5e2', primary: '#82c91e', secondary: '#fab005', accent: '#fd7e14', danger: '#e03131' }
  motif: 童话风的早晨田园,玩家从空地上长出小镇
coreLoop:
  primaryAction: 选择建筑 + 拖到地块上 + 释放
  successSignal: 建筑落地动画 + 资源数字跳动 + 烟花
  failureSignal: 资源不足 → 红色 X 提示 + 建筑半透明回退
  iterationFeel: 看城市从荒地一步步长大
temporalShape:
  shape: sandbox
  description: 没有终点,玩家自定目标
```
````

(模板继续含:节奏游戏 / 解谜 / 吸血鬼幸存者 三个样例,每个用相同 yaml 结构,展示 anchor 的填法因品类而异。)

### `decisions-template.md`

文件本身就是模板内容。结构如下:

````markdown
# decisions.md

> **这是 decision log / rationale log,不是 chain-of-thought dump**。
>
> 仅记录:决策结论 / 依据 / 权衡 / 后续风险。不要求暴露推理过程,不要求"真实思考链"。
> 每条决策的目的是让其他人(或未来的自己)能复核为什么这样选,不是看你怎么想到的。

## A. 设计期决策(Phase A 写,5-15 条 Q&A)

格式:每条 Q&A 标 **来源标签** — `from-query`(用户原文显式) / `from-genre-knowledge`(品类公约推断) / `from-reasoning`(临场推理)。

### A.1 archetype 识别 — 来源: from-reasoning

**Q**: 用户 query 最接近哪个已知 archetype?

**A**: 例: "雷霆战机"是垂直滚动飞行射击,接近 shooter primer。
**已加载 primer**: `node scripts/load_primer.js cases/<id> --archetype shooter`
**(若不在 5 个已知 archetype 中)**: 不加载 primer,自行设计;在 retrospective 段记录是否需要新增 primer。

### A.2 视觉意象锚点 — 来源: from-reasoning

**Q**: 这个 case 的视觉气质用什么意象描述?

**A**: 例: "深空之中飞行员追逐微弱的星点燃料光"。

### A.3 ~ A.N 其他设计决策

按 Q&A 格式继续。例:配色为什么这样选 / HUD 信息密度怎么定 / 哪些反馈瞬间是核心。

---

## B. 实现期决策(Phase B 写,in-flight 增条)

每写一个新文件 / 重构一段 / 跳过一个复杂度,加一条:

### B.1 文件清单 — 来源: <from-plan / from-reasoning>

**决策**: 实际拆为 N 个文件 — `<file-1>` 负责 X / `<file-2>` 负责 Y / ...
**与 plan 的差异**: 例: plan 列了 6 文件,实际合并 EnemyManager + Spawner 为 1 个 — 因为两者状态紧耦合,拆开会引入循环依赖。
**风险**: 若后续 Spawner 逻辑独立化,需要拆分。

### B.2 ~ B.N 其他实现决策

例: 为什么用 Phaser.GameObjects.Group 不用自写 pool / 为什么 hit-stop 用 `time.timeScale` 而非自维护 paused / 哪些 visualTheme helper 选用了哪些没用。

---

## C. Retrospective(Phase C 后,可选,**强烈建议**)

不强制,但写了能进 Stage 2 backlog。读 `delivery.json.qualityHints` 后回顾:

### C.1 如果重来我会改的事

- 例: visualTheme.flashRing 我用了 1 次,应该在 boss 出场也用 → 当时没意识到 boss 出场需要额外提示
- 例: `coreLoop.iterationFeel` 写得太抽象,Phase B 写代码时没法直接转译成数值 → 下次写设计文档时同步给出"对应到代码的具体数值"

### C.2 视觉指标读后感

- `qualityHints.visual.colorCount` = 4 → 偏少;next pass 增加敌人差异化配色
- `qualityHints.rubric.visual-feedback` = 2/5 → 反馈不足,加强 hit-particle 与 damage-number

### C.3 scope 自评

- from-query 标的 N 项核心要求,全部在 mustHave / requiredMechanics
- from-genre-knowledge 标的 M 项,X 项做了 Y 项延后,延后原因: ...

---

## 命名约束

- ✅ "decision log" / "rationale" / "design notes"
- ❌ "真实思考链" / "private CoT dump" / "reasoning trace"

本文档是**外显决策**,不是私密推理复刻。
````

### `archetype-primers/<X>.md`

5 个文件 skeleton 一致。以 `shooter.md` 为例:

````markdown
# Shooter 品类 Primer

> 当 Phase A 模型识别 query 为 shooter 类(垂直滚动 / 横版 / 双摇杆 / 弹幕)时,worker 调
> `node scripts/load_primer.js cases/<id> --archetype shooter` 后,本文件被复制到
> `cases/<id>/.game/archetype-primer.md`。
>
> primer 是知识注入,不是路由系统。模型按需读;读后写决策日志;不参与 gate。

## 别名 / 常见游戏

- 中文: 飞机大战 / 雷霆战机 / 弹幕 / 战机射击 / 飞行射击 / STG
- 英文: shooter / shoot 'em up / shmup / vertical scrolling / horizontal scroller / bullet hell / danmaku / twin-stick shooter
- 经典作: 雷霆战机 / Strikers / 1942 / Raiden / Touhou / Ikaruga / 沙罗曼蛇 / Tyrian / Galaga / Geometry Wars

## 品类公约 (玩家会期待的特性)

### 核心机制
- 自动 / 半自动开火,玩家专注于**移动 + 闪避**;手动开火少见
- 子弹形态多样:直线 / 散射 / 锁定 / 弹幕 / 穿透 / 范围
- 敌机波次出现,有 boss 节点(每 N 波 / 每 N 秒)
- powerup 拾取强化武器(火力 / 副武器 / 屏幕清扫)
- **命中体积小于显示体积**(玩家友好,避免"看着没碰到也死了")

### 进阶机制
- 多周目:打通后难度上升再打
- 等级 / 武器升级:与 powerup 不同,等级随击杀数累计
- 二段攻击:普通弹 + 大招(屏幕清扫 / 短无敌 / 必杀)

## 经典反馈瞬间(coreLoop.successSignal / failureSignal 写作参考)

| 瞬间 | 视觉 | 听觉 | 触觉 |
|---|---|---|---|
| 击毁普通敌机 | 8-12 粒子爆炸 + 短闪光 | "嘭" 轻音 | 微震 (100, 0.005) |
| 击毁精英敌机 | 16-24 粒子 + 中等闪光 + 慢动作 1 帧 | "轰" 中音 | 中震 (200, 0.015) |
| 击毁 boss | 大爆炸链 (3-5 段) + 全屏白闪 + boss 残骸 | 长爆炸 + 胜利动机 | 强震 (500, 0.04) |
| 玩家受击 (有 iframe) | 全屏红闪 + 玩家闪烁 1-2 秒 | "滋" 警告音 | 受击震 (300, 0.02) |
| 玩家死亡 | 玩家爆炸 + 屏幕白闪 → 黑屏 | 死亡音 + 静音 1 秒 | 强震 (500, 0.04) |
| 拾取 powerup | 拾取者向 powerup 飞去 + 拾取闪光 | "叮" 上扬音 | 无 |
| boss 警告 | 顶部红条横幅 + 屏幕震动 | 警报循环 3 次 | 中震循环 |

## 常见 mistake(写代码前避坑)

1. 命中体积 = 显示体积 → 体感太苛刻;命中体积应该是显示体积的 50-70%
2. 敌机直线下来无变化 → 单调;至少 3 种轨迹(直 / 曲 / Z 字)
3. 子弹颜色不区分玩家 / 敌人 → 视觉混乱;玩家弹冷色 (蓝绿青) + 敌弹暖色 (红橙黄)
4. powerup 没有不同视觉 → 玩家不知道拾哪个;每种 powerup 颜色不同 + 闪烁不同
5. boss 没有 HP 条 → 不知道还要打多久;顶部或 boss 头顶 HP 条
6. 子弹没有差异化 → "升武器了但感觉没变";每级武器至少颜色 / 数量 / 速度三选一变化
7. 死亡后立即 game over → 玩家挫败;命数 ≥ 3,最后一命再 game over
8. 难度提升只靠"敌机更多" → 后期屏幕变弹幕地狱;数量 + 速度 + 弹道复杂度三轴均衡上升

## 数值起点参考

- 玩家移动速度: 200-300 px/s
- 普通敌机速度: 60-120 px/s
- 子弹速度: 玩家弹 400-600 / 敌弹 150-300 (视品类,弹幕系敌弹更慢更密)
- 普通敌机 HP: 1-3 击 (用玩家 1 级武器为基准)
- 精英 HP: 5-15 击
- Boss HP: 60-200 击
- 波次时长: 30-60 秒
- Boss 间隔: 每 3-5 波 / 每 90-150 秒

## 数据驱动 vs 硬编码

- 武器配置 / 敌人配置应该是 data file (json / ts const) 形态,方便调参
- AI / 弹道函数可以硬编码(直 / 曲 / Z 字 / 跟踪),没必要数据化

## 不要照搬

primer 是参考,不是法律。如果 case 的 query 明确说"我要的不是雷霆战机那种,我要的是慢节奏的战略射击",那就不要按本 primer 的快节奏数值起点写。读 primer 后**自己判断**哪些适用、哪些丢弃,在 decisions.md@A 写明丢弃理由。
````

(其他 4 个 primer 用类似结构填入对应品类内容:vampire-survivors / breakout / topdown / tower-defense。)

## Acceptance criteria

跑下列断言,全部通过:

1. ✅ `templates/design-template.md` 存在,grep 能找到 4 个 anchor 关键字 `visualIdentity` / `uiSurfaces` / `coreLoop` / `mustAvoid`
2. ✅ `templates/design-template.md` 不含旧 action-bias anchor 名(对应 grep 应该返回空)
3. ✅ `templates/design-template.md` 跨品类样例覆盖 ≥3 品类(雷霆战机 / Wordle / 城市建造 必含,其他可加)
4. ✅ `templates/decisions-template.md` 存在,含 A / B / C 三段位 + 命名约束段(禁用"真实思考链")
5. ✅ `templates/decisions-template.md` 第一题强制是 archetype 识别(A.1)
6. ✅ `templates/archetype-primers/` 下有 5 个 .md 文件 (vampire-survivors / shooter / breakout / topdown / tower-defense)
7. ✅ 每个 primer 含 6 个固定 section: 别名 / 品类公约 / 经典反馈瞬间 / 常见 mistake / 数值起点 / 不要照搬
8. ✅ 任何模板都不引入 lib/ 或 scripts/ 的依赖(只是 markdown,不引用代码)

## Out-of-scope

- 不写 `prepare_case_game.js` 或 `load_primer.js` 的代码(Phase 3)
- 不在任何 `cases/<id>/` 复制模板(本 Phase 不动 case)
- 不修改 SKILL.md(Phase 4)
- 不写 6 个 lib/ helper(Phase 2)

## Codex notes / Open questions

- **Q**: design-template.md 的"跨品类样例"该放几个?
  **A**: 至少 3 个(雷霆战机 / Wordle / 城市建造,体现 action / 拼字 / 沙盒三个截然不同的品类),最多 6 个(再加节奏 / 解谜 / 吸血鬼幸存者)
- **Q**: archetype-primer 写作精度?
  **A**: 目标:模型读 1 次能记住要点,写代码时不需要回查。每个 primer 70-90 行,数值起点要具体(给数字而非"较快"),反馈瞬间要可执行(说"粒子 + 短震 + 飘分"而非"有反馈")
- **Q**: 5 个 primer 之外的品类怎么办?
  **A**: load_primer.js 对未知 archetype 返回 stderr 提示但 exit 0,case 自行设计。retrospective 可记录"是否需要新增 primer",作为 Stage 2 backlog 输入。本 Phase **不**为新品类预留 primer 模板槽位。

## Phase 报告模板

完成时 stdout:

```
[v1.1 phase-1] STATUS=done
files-created:
  - templates/design-template.md
  - templates/decisions-template.md
  - templates/archetype-primers/vampire-survivors.md
  - templates/archetype-primers/shooter.md
  - templates/archetype-primers/breakout.md
  - templates/archetype-primers/topdown.md
  - templates/archetype-primers/tower-defense.md
files-modified: none
acceptance-passed: 8 / 8
follow-ups: none
blockers: none
```
