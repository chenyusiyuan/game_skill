# 视觉风格推断与特效指南

> **重要变更**：visual-style 的 5 选 1 固定枚举（pixel-retro / cartoon-bright / minimal-modern / dark-neon / hand-drawn）已废弃。
> 新流程：Phase 2 从 brief 关键词自动推断 color-scheme，codegen 消费 color-scheme 硬值。

---

## 1. 配色推断流程

Phase 2 PRD 阶段，在写 front-matter 时自动推断配色方案：

### Step 1: 提取 theme-keywords

从 brief 和用户需求中提取 2-5 个主题关键词（中文或英文均可），例如：
- 用户说"做一个贪吃蛇游戏" → theme-keywords: [贪吃蛇, snake, 网格]
- 用户说"3D赛车游戏" → theme-keywords: [赛车, racing, 3D, 速度]
- 用户说"小学数学闯关" → theme-keywords: [数学, 教育, 闯关]
- 用户说"赛博风格的俄罗斯方块" → theme-keywords: [赛博, 霓虹, 俄罗斯方块]

### Step 2: 匹配色板

读取 `references/common/color-palettes.yaml`，将 theme-keywords 与每个 palette 的 keywords 做确定性打分：

| 信号 | 分数 | 说明 |
|---|---:|---|
| 用户明确视觉偏好命中（如"像素风"、"赛博风"、"水墨"） | +200 | 最高优先级，覆盖 genre 默认倾向 |
| theme-keyword 与 palette.keyword 精确命中 | +100 | 中文或英文完全一致 |
| theme-keyword 与 palette.keyword 语义近义命中 | +60 | 如"宇宙"→"太空"、"英语练习"→"学习" |
| 当前 genre 的默认 palette | +30 | 仅在无强视觉偏好时加分 |
| 多个关键词命中同一 palette | 累加 | 命中越多权重越高 |

Tie-break 必须固定：
1. 总分高者胜
2. 若用户有明确视觉偏好，匹配该偏好的 palette 胜
3. 若总分相同，按 `color-palettes.yaml` 中出现顺序靠前者胜（P0 → P1 → P2 → P3）
4. 无任何正分 → 使用 fallback-default（neutral-clean）

Genre 默认 palette 表：

| genre | default palette |
|---|---|
| board-grid | board-classic |
| platform-physics | adventure-outdoor |
| simulation | farm-cozy |
| strategy-battle | dungeon-dark |
| single-reflex | candy-pop |
| quiz-rule | campus-fresh |
| social-multi | party-social |
| edu-practice | campus-fresh |
| narrative | hand-drawn |

歧义词固定处理：
- `围棋`：若同时出现 `古风` / `水墨` / `中国风` / `书法`，选 `ink-scroll`；否则选 `board-classic`
- `地牢`：若同时出现 `像素` / `复古` / `8-bit`，选 `pixel-retro`；若同时出现 `暗黑` / `RPG` / `roguelike` / `魔王` / `宝箱`，选 `dungeon-dark`

### Step 3: 写入 PRD front-matter

```yaml
---
game-aprd: "0.1"
project: snake-classic-001
...
color-scheme:
  palette-id: snake-grid
  theme-keywords: [贪吃蛇, snake, 网格]
  primary: "#22c55e"
  secondary: "#15803d"
  accent: "#ef4444"
  background: "#0f172a"
  surface: "#1e293b"
  text: "#e2e8f0"
  text-muted: "#64748b"
  success: "#22c55e"
  error: "#ef4444"
  border: "#334155"
  font-family: '"Press Start 2P", "VT323", monospace'
  border-radius: "0"
  shadow: "none"
  fx-hint: pixel
---
```

**注意**：如果用户明确说了视觉偏好（如"赛博风格"、"像素风"、"暗色"），优先匹配对应色板，即使 genre 暗示了不同方向。

---

## 2. codegen 消费约定

### 2.1 配色消费

Phase 4 codegen 读 PRD 的 `color-scheme` 段 → 直接消费硬值：

- DOM 模板：Tailwind config extend + CSS 变量 `--color-primary: ${primary};`
- Canvas 模板：`ctx.fillStyle = color-scheme.primary;`
- Phaser / PixiJS：hex 转整数 `parseInt(primary.slice(1), 16)`
- Three.js：`new THREE.Color(primary)`

**禁止 codegen 自己发明配色**。color-scheme 里有什么就用什么。

### 2.2 字体消费

- font-family 直接写到 CSS / Phaser text style / Canvas ctx.font
- 如果 font-family 包含 Google Fonts（如 "Baloo 2"、"Press Start 2P"），在 HTML head 中加对应 `<link>` 引入
- 如果包含本地字体（如 "Kenney Future"），从 assets/library_2d/fonts/ 加载

### 2.3 圆角和阴影消费

- border-radius 和 shadow 直接应用到所有 UI 容器（面板、卡片、按钮）
- 值为 "0" 或 "none" 表示不使用
- 值包含不规则数字（如 "6px 10px 8px 12px"）表示手绘风格不规则圆角

---

## 3. 特效消费约定

### 3.1 特效预设选择

codegen 从 PRD 的 `color-scheme.fx-hint` 获取特效类型（soft/pixel/glow/bounce/ink），然后读 `references/common/fx-presets.yaml` 的对应预设段。

### 3.2 特效层级要求（不变）

| 层级 | 触发时机 | 效果要求 |
|---|---|---|
| **L0 基础** | 所有交互 | 色彩变化 + 缩放 |
| **L1 反馈** | 成功/失败判定 | L0 + 震动/闪烁 |
| **L2 奖励** | 得分/combo/升级 | L1 + 粒子爆发 |
| **L3 高潮** | 通关/boss击败/最终胜利 | L2 + 全屏粒子 + 滤镜 |

**规则**：
- Phaser / PixiJS / Three.js 项目必须覆盖 L0-L2
- DOM / Canvas 项目必须覆盖 L0-L1

### 3.3 粒子颜色原则

粒子颜色**永远**从当前 color-scheme 动态取，不硬编码：
- 主粒子色 = primary（60%）+ accent（30%）+ secondary（10%）
- 成功粒子 = success 色
- 失败粒子 = error 色

### 3.4 引擎特效能力矩阵（不变）

| 效果 | DOM | Canvas | Phaser 3 | PixiJS v8 | Three.js |
|---|---|---|---|---|---|
| 缩放/位移 tween | CSS transition | 手写插值 | `tweens.add()` | gsap / ticker | gsap / 手写 |
| 屏幕震动 | CSS transform | canvas 偏移 | `camera.shake()` | container 偏移 | camera 偏移 |
| 粒子爆发 | ❌ | 手写 | **内置 particles** | **@pixi/particle** | **Points / 自定义** |
| 色彩闪烁 | CSS animation | globalAlpha | **tween + tint** | **ColorMatrixFilter** | **material.color** |
| 模糊/发光 | CSS filter | ❌ | **pipeline/shader** | **BlurFilter/GlowFilter** | **UnrealBloomPass** |
| 拖尾 | ❌ | 手写残影 | **粒子 follow** | **粒子 follow** | **Trail mesh** |

---

## 4. 游戏事件 → 特效映射（通用，不变）

| 游戏事件 | 最低要求（L1） | 推荐（L2+） |
|---|---|---|
| 选中/悬停 | 缩放 1.05 + 边框高亮 | + tint 闪烁 + 光晕 |
| 配对成功 | 绿色闪光 + 淡出 | + 星星粒子 + 屏幕微震 |
| 配对失败 | 红色闪烁 + 抖动 | + 红色 tint + 屏幕微震 |
| 得分增加 | 飘字 +N | + 粒子尾迹 + 弹跳 |
| Combo 连击 | 文字放大 | + 粒子环绕 + 颜色渐变 |
| 时间警告 | 文字变红 + 脉冲 | + 屏幕边缘红晕 |
| 通关胜利 | 大文字 + 背景变色 | + 烟花粒子 + camera zoom |
| 游戏失败 | 文字 + 灰暗 | + desaturate filter + 碎片粒子 |

---

## 5. Kenney 素材消费约定（不变）

> ⚠️ **此章节是 codegen 的强制约束**。

Phase 4 codegen 读 `specs/assets.yaml` 时，对于 `type: local-file` 的素材：

- **路径**：`assets.yaml` 中的 `source` 是相对于项目根目录的路径
- **加载方式**（按引擎）：
  - DOM：`<img src="../../../{source}">` 或 CSS `background-image: url(...)`
  - Canvas：`new Image(); img.src = '../../../{source}'; await img.decode();`
  - Phaser：`this.load.image(id, '../../../{source}')`
  - PixiJS：`Assets.load({ alias: id, src: '../../../{source}' });`
  - Three.js：`new GLTFLoader().load('../../../{source}', callback);`
- **优先级**：local-file（必须使用）> generated > synthesized
- **降级**：仅当素材文件实际不存在时才可降级为程序化绘制，降级时必须 console.warn

---

## 6. 迁移说明

| 旧字段 | 新字段 | 说明 |
|---|---|---|
| `visual-style: pixel-retro` | `color-scheme.palette-id: pixel-retro` | 从枚举选择变为关键词推断 |
| `visual-style: cartoon-bright` | 按需匹配 `candy-pop` / `adventure-outdoor` / `campus-fresh` 等 | 不再有单一"卡通"选项 |
| `visual-style: minimal-modern` | `color-scheme.palette-id: neutral-clean` | 极简风变为默认兜底 |
| `visual-style: dark-neon` | `color-scheme.palette-id: cyber-neon` | 暗黑霓虹 |
| `visual-style: hand-drawn` | `color-scheme.palette-id: hand-drawn` | 保留 |
| `visual-style: auto` | 废弃 | 现在全部都是自动推断 |

Phase 1 的 AskUserQuestion 不再有"视觉风格"选项。如果用户主动说了风格偏好（如"像素风"），写入 brief 的 theme-keywords 中，Phase 2 自动匹配。

---

## 7. 相关文件

- `references/common/color-palettes.yaml` — 预设色板库（19+1 套）
- `references/common/fx-presets.yaml` — 特效预设库（5 种 fx-hint）
- 本文件 — 推断规则与 codegen 消费约定
