# Phase 2 — scaffold/src/lib/ 4 默认 Helper

## Goal

落地 4 个 v1.1 默认 genre-agnostic Phaser helper,作为 Phase B 写代码时的高密度起点。所有核心 helper 必须 **CANVAS-safe**(headless smoke 用 CANVAS renderer,WebGL FX 仅作 optional 增强)。

实施完成后,链路作者必须**一次性**预验证(tsc + CANVAS smoke + 人眼复核),通过后 helper 视为 known-good 契约,case-time 不再重复验证。

> 上下文锚点:
> - plan 文件 § "修订后 lib/ 接口" + § "24 条锁定决策" item 14-16
> - `evolution-docs/research-notes-phaser.md` § 1(Phaser API 事实)、§ 4(完整接口)、§ 7(调研结论)

## Pre-requisites

- Phase 1 完成(模板已就位)。本 Phase 不依赖 Phase 1 的 markdown 内容,但流程序上 Phase 1 必须先完成

## Files to create(v1.1 默认 4 个)

| 路径 | LOC 估 | 性质 |
|------|------|---|
| `templates/scaffold/src/lib/visualTheme.ts` | ~220 | CANVAS-safe 视觉 helper(粒子/相机/tween/伤害字/光圈/hit-stop/boss 出场)+ optional FX fallback |
| `templates/scaffold/src/lib/inputController.ts` | ~120 | WASD + 方向键 + 触摸虚拟摇杆 + action bindings |
| `templates/scaffold/src/lib/hudBuilder.ts` | ~150 | meterBar / statusText / iconSlot |
| `templates/scaffold/src/lib/progressionMath.ts` | ~60 | 纯函数,无 Phaser 依赖 |

总 LOC ≤ 600(实测预估 550)。

## Files to modify

无。Phase 3 才动 `prepare_case_game.js` 把 lib/ 加入 SCAFFOLD_FILES。

## Forbidden

- 不创建 `templates/scaffold/src/lib/objectPool.ts`(已 defer 到 v1.2)
- 不创建 `templates/scaffold/src/lib/spatialGrid.ts`(已 defer 到 v1.2)
- 不创建任何品类专属 helper(violate Option C 通用最小集)
- 不引入新 npm 依赖(全用现有 phaser 3.90.0)
- 不在 helper 里硬编码 case-specific 配色 / 数值
- 不让 helper 依赖 case 的 asset(必须用 `ensureProceduralTextures(scene)` 自带 graphics 生成的纹理)
- 不让 visualTheme 核心 helper 依赖 WebGL renderer(FX 只能作 optional)

## Interface contracts

### `visualTheme.ts`

文件顶部 doc:

```ts
/**
 * v1.1 default visual helper. CANVAS-safe core + optional WebGL FX fallback.
 *
 * **核心 helper(都在 CANVAS renderer 下可见效)**:
 *   - ensureProceduralTextures
 *   - burstParticles, damageNumber, flashRing, levelUpFlash
 *   - screenShake, screenFlash, screenFadeOut
 *   - hitImpact, bossEntry
 *
 * **FX fallback(仅 WebGL renderer 生效,CANVAS 静默 no-op,返回 null)**:
 *   - applyGlow, applyBloom
 *
 * 业务代码必须在没有 FX 的前提下也跑得起来。FX 仅作画面增强,不作核心。
 */
```

完整接口签名:

```ts
import Phaser from 'phaser';

// === 程序化纹理(必须在使用粒子相关 helper 前调用一次)===
/**
 * 在 scene.textures 中注册以下 keys(若未存在):
 *   '__white_circle' (16x16, 实心白圆)
 *   '__white_square' (16x16, 白色方块)
 *   '__white_diamond' (16x16, 白色菱形)
 *   '__white_star' (16x16, 5 角星)
 * 这些是 ParticleEmitter 的 fallback texture;case 业务代码也可直接用。
 */
export function ensureProceduralTextures(scene: Phaser.Scene): void;

// === 粒子(用 3.60+ 统一 API,CANVAS-safe)===
export interface BurstParticleOpts {
  texture?: '__white_circle' | '__white_square' | '__white_diamond' | '__white_star' | string;
  color?: number;             // tint, default 0xffffff
  count?: number;             // default 12
  speed?: { min: number; max: number };  // default { min: 30, max: 120 }
  lifespan?: number;          // ms, default 400
  scale?: { start: number; end: number };  // default { start: 0.6, end: 0 }
  blendMode?: 'ADD' | 'NORMAL' | 'MULTIPLY';  // default 'ADD'(WebGL 才出加法,CANVAS 走 NORMAL)
}

/**
 * 一次性爆散粒子。内部用 add.particles(...).explode(count) +
 * 500ms 后自动 destroy emitter。
 * CANVAS-safe: blendMode=ADD 在 CANVAS 下退化为 NORMAL,粒子仍然可见。
 */
export function burstParticles(scene: Phaser.Scene, x: number, y: number, opts?: BurstParticleOpts): void;

// === 命中飘字(CANVAS-safe)===
export interface DamageNumberOpts {
  color?: string;             // CSS color, default '#ffe070'
  fontSize?: string;          // default '14px'
  rise?: number;              // px, default 40
  duration?: number;          // ms, default 600
  fontStyle?: string;         // default 'bold'
}

/**
 * 飘字: text.setOrigin(0.5).setDepth(1000),
 *       tween: y -= rise, alpha → 0, scale 1.2x → 1x,
 *       完成后 destroy。
 */
export function damageNumber(scene: Phaser.Scene, x: number, y: number, value: number | string, opts?: DamageNumberOpts): void;

// === 扩散光圈(CANVAS-safe)===
export interface FlashRingOpts {
  startRadius?: number;       // default 6
  endRadius?: number;         // default 24
  duration?: number;          // ms, default 300
  alpha?: number;             // start alpha, default 0.8
}

/**
 * 命中光圈或 powerup 拾取效果: 圆从小变大 alpha 从 0.8 → 0,
 * 完成后 destroy。
 */
export function flashRing(scene: Phaser.Scene, x: number, y: number, color: number, opts?: FlashRingOpts): void;

// === 升级闪光(CANVAS-safe)===
/**
 * camera flash + 中心爆裂粒子 + flashRing。常用于经验升级、关卡达成。
 */
export function levelUpFlash(scene: Phaser.Scene, color?: number): void;

// === 相机效果包装(CANVAS-safe)===
export type ShakePreset = 'micro' | 'hit' | 'death' | 'explosion';

/**
 * 相机震屏。预设值参考 Phaser 社区推荐:
 *   micro    -> (100ms, 0.005)
 *   hit      -> (200ms, 0.01)
 *   death    -> (300ms, 0.02)
 *   explosion-> (500ms, 0.04)
 * 自带 force=true,允许在已有效果上叠加。
 */
export function screenShake(scene: Phaser.Scene, preset: ShakePreset | { duration: number; intensity: number }): void;

export type FlashColor = 'white' | 'red' | 'green' | 'gold';

/**
 * 相机闪屏。预设:
 *   white  -> 全屏白闪 80ms (命中)
 *   red    -> 红闪 150ms (受伤)
 *   green  -> 绿闪 200ms (拾取 / 升级)
 *   gold   -> 金闪 300ms (重大成就)
 */
export function screenFlash(scene: Phaser.Scene, color: FlashColor | { r: number; g: number; b: number }, duration?: number): void;

/**
 * 相机淡出过渡。常用于 game over → menu 转场。
 * 自动监听 FADE_OUT_COMPLETE 事件并触发回调。
 */
export function screenFadeOut(scene: Phaser.Scene, duration: number, color: number, onComplete?: () => void): void;

// === 命中复合(hit-stop,CANVAS-safe)===
export type HitImpactPreset = 'light' | 'medium' | 'heavy';

/**
 * 复合命中反馈:
 *   light:    shake micro + flash white 80ms                    (无 hit-stop)
 *   medium:   shake hit + flash white 80ms + timeScale 0.4 100ms
 *   heavy:    shake explosion + flash gold 300ms + timeScale 0.3 150ms
 * **关键**:hit-stop 后必须自动 reset timeScale = 1。
 */
export function hitImpact(scene: Phaser.Scene, preset: HitImpactPreset): void;

// === Boss 出场(CANVAS-safe)===
export interface BossEntryOpts {
  warningColor?: number;      // default 0xcc2233
  durationMs?: number;        // total duration, default 1200
}

/**
 * Boss 出场反馈: camera flash red + camera shake + 顶部红条 1200ms 后淡出。
 * 顶部红条用 Graphics.fillRect 实现(CANVAS-safe),不依赖 BitmapText。
 */
export function bossEntry(scene: Phaser.Scene, opts?: BossEntryOpts): void;

// === FX 包装(WebGL only,CANVAS 静默 no-op,不作核心)===
/**
 * 在 target 上挂载 Phaser.FX.Glow 效果。
 * **WebGL only**:CANVAS renderer 下返回 null,业务代码必须能在没有 glow 的前提下运行。
 *
 * Pre FX(便宜)适用于:Image / Sprite / TileSprite / Text / RenderTexture / Video。
 * 其他 GameObject 类型走 Post FX(更贵)。
 */
export function applyGlow(target: Phaser.GameObjects.GameObject, color?: number, strength?: number): unknown | null;

/**
 * 在 target 上挂载 Phaser.FX.Bloom 效果。
 * **WebGL only**:CANVAS renderer 下返回 null。
 */
export function applyBloom(target: Phaser.GameObjects.GameObject | Phaser.Cameras.Scene2D.Camera, color?: number, strength?: number): unknown | null;
```

### `inputController.ts`

```ts
import Phaser from 'phaser';

export interface InputControllerOptions {
  enableKeyboard?: boolean;     // default true: WASD + arrows
  enableTouch?: boolean;         // default true: 虚拟摇杆 + tap actions
  enableGamepad?: boolean;       // default false (需要时打开)
  /**
   * 自定义 action 绑定。例:
   *   { fire: ['SPACE'], pause: ['ESC', 'P'], primary: ['pointer1'] }
   * 默认 actions: { primary: ['SPACE', 'pointer1'], pause: ['ESC'] }
   */
  actionBindings?: Record<string, string[]>;
}

export class InputController {
  /**
   * 归一化的 2D 轴:键盘 + 摇杆合并后映射到 [-1, 1] x [-1, 1]。
   * 每帧从 update 里读 controller.axes2D.x / .y 直接当 velocity 输入。
   */
  axes2D: Phaser.Math.Vector2;

  constructor(scene: Phaser.Scene, opts?: InputControllerOptions);

  /** 在 scene.update 末尾调一次,刷新 axes2D 与 action 状态 */
  update(): void;

  /** 当前帧是否按住某 action */
  isActionDown(action: string): boolean;

  /** 注册按下回调(在 scene 的 input event 上 wire) */
  onActionDown(action: string, callback: () => void): void;

  /** 注册抬起回调 */
  onActionUp(action: string, callback: () => void): void;

  /**
   * 必须在 scene shutdown 时调用,防止跨 scene 事件残留。
   * 内部清理:keyboard listener / pointer listener / 虚拟摇杆 graphics 销毁
   */
  destroy(): void;
}
```

### `hudBuilder.ts`

```ts
import Phaser from 'phaser';

export interface MeterBarOpts {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: number;            // 默认 0x44cc44 (绿)
  bgColor?: number;          // 默认 0x222244 (深蓝)
  borderColor?: number;      // 默认 0xffffff
  showText?: boolean;        // 默认 true: 显示 "current/max" 文字
  textColor?: string;        // 默认 '#ffffff'
  label?: string;            // 默认空: 例 "HP" / "XP"
  fixedToCamera?: boolean;   // 默认 true (HUD 不随镜头滚动)
}

export interface MeterBarHandle {
  setValue(current: number, max: number): void;
  setColor(color: number): void;     // 用于按 hp 比例动态变红
  destroy(): void;
}

/**
 * 通用 meter:HP / XP / mana / 进度条都用它。
 * 内部:Graphics(背景 + 前景填充)+ Text(label + 数值),全部 setScrollFactor(0)。
 */
export function meterBar(scene: Phaser.Scene, opts: MeterBarOpts): MeterBarHandle;

export interface StatusTextOpts {
  x: number;
  y: number;
  label?: string;            // 例: "Lv" / "Wave" / "Score"
  fontSize?: string;          // 默认 '13px'
  color?: string;            // 默认 '#ffffff'
  fontStyle?: string;        // 默认 'bold'
  fixedToCamera?: boolean;   // 默认 true
}

export interface StatusTextHandle {
  setText(value: string | number): void;
  destroy(): void;
}

/**
 * 文字状态显示:Level / Wave / Score / Kills 等单一数值。
 * 自动加 label prefix(若提供)。
 */
export function statusText(scene: Phaser.Scene, opts: StatusTextOpts): StatusTextHandle;

export interface IconSlotOpts {
  x: number;
  y: number;
  size: number;              // 方形边长
  iconText?: string;         // 短文字代替图标(因为我们没有 sprite asset)
  iconColor?: string;        // 默认 '#ffffff'
  bgColor?: number;          // 默认 0x222244
  borderColor?: number;      // 默认 0x6666cc
  level?: number;            // 默认 0: 不显示等级数字
  fixedToCamera?: boolean;
}

export interface IconSlotHandle {
  setLevel(level: number): void;
  setActive(active: boolean): void;  // active 时边框高亮
  destroy(): void;
}

/**
 * 武器槽 / 道具槽:小方块 + 文字(代替 icon)+ level 角标。
 */
export function iconSlot(scene: Phaser.Scene, opts: IconSlotOpts): IconSlotHandle;
```

### `progressionMath.ts`

```ts
/**
 * v1.1 progression / curve 工具函数。
 * 全部纯函数,无 Phaser 依赖。可在任何模块 import。
 */

/** 线性插值: t∈[0,1] 时返回 from..to */
export function linearRamp(t: number, from: number, to: number): number;

/** 指数增长: value 经过 ticks 次后,每次 × growth */
export function exponentialRamp(value: number, growth: number, ticks: number): number;

/**
 * XP 累计阈值: level → 升到该 level 所需的总 XP。
 * thresholdCurve(1, 10, 1.4) = 10
 * thresholdCurve(2, 10, 1.4) = 14
 * thresholdCurve(3, 10, 1.4) = 19.6 (≈20)
 */
export function thresholdCurve(level: number, base: number, growth: number): number;

/**
 * 波次缩放因子: wave → 1 + (wave-1) * perWaveMultiplier
 * waveScale(1, 0.15) = 1
 * waveScale(2, 0.15) = 1.15
 * waveScale(5, 0.15) = 1.6
 */
export function waveScale(wave: number, perWaveMultiplier: number): number;

/** 标准 clamp */
export function clamp(value: number, min: number, max: number): number;

/** 标准 lerp(同 linearRamp,提供别名) */
export function lerp(a: number, b: number, t: number): number;

/** 取 [min, max] 区间随机数(包含两端) */
export function randRange(min: number, max: number): number;

/** 取 [min, max] 区间整数随机 */
export function randInt(min: number, max: number): number;
```

## Pre-validation(链路作者必须做,**实施前一次性**)

链路作者(人)必须在合并 v1.1 PR 前完成下面三步,sign-off 通过后 helper 才视为 known-good 契约:

### 步骤 1 — TS 编译

```bash
cd templates/scaffold
npx tsc --noEmit
```

期望:0 error。若有 type 错误,修到 0 再继续。

### 步骤 2 — CANVAS smoke scene 视觉复核

新建一个临时 case `cases/_v1.1-lib-smoke/`(merge 时删除),跑一个 scene 触发所有核心 helper:

```ts
// cases/_v1.1-lib-smoke/game/src/main.ts
import Phaser from 'phaser';
import {
  ensureProceduralTextures,
  burstParticles, damageNumber, flashRing, levelUpFlash,
  screenShake, screenFlash, hitImpact, bossEntry
} from './lib/visualTheme';
import { meterBar, statusText, iconSlot } from './lib/hudBuilder';
import { InputController } from './lib/inputController';

class SmokeScene extends Phaser.Scene {
  create() {
    ensureProceduralTextures(this);
    const cx = 240, cy = 180;

    // 触发各 helper(按 200ms 序列)
    this.time.delayedCall(200, () => burstParticles(this, cx, cy, { color: 0x44ff88 }));
    this.time.delayedCall(500, () => damageNumber(this, cx, cy - 20, 99));
    this.time.delayedCall(800, () => flashRing(this, cx, cy, 0xffe070));
    this.time.delayedCall(1100, () => screenShake(this, 'hit'));
    this.time.delayedCall(1400, () => screenFlash(this, 'red'));
    this.time.delayedCall(1700, () => hitImpact(this, 'medium'));
    this.time.delayedCall(2300, () => bossEntry(this));
    this.time.delayedCall(3500, () => levelUpFlash(this, 0xffe070));

    // HUD
    const hp = meterBar(this, { x: 10, y: 10, width: 100, height: 12, color: 0xff4444 });
    hp.setValue(75, 100);
    statusText(this, { x: 10, y: 30, label: 'Lv', fontSize: '13px' }).setText(5);
    iconSlot(this, { x: 10, y: 50, size: 32, iconText: '🗡', level: 3 });
  }
}

new Phaser.Game({
  type: Phaser.CANVAS,    // 强制 CANVAS,验证核心 helper 在 CANVAS 下都可见
  width: 480, height: 360,
  scene: [SmokeScene]
});
```

跑 `npm run dev`,**链路作者人眼**确认:

- [ ] 0.2s 起绿色粒子爆散
- [ ] 0.5s 起 "99" 上飘金色文字
- [ ] 0.8s 起黄色光圈扩散
- [ ] 1.1s 起屏幕震动
- [ ] 1.4s 起红屏闪
- [ ] 1.7s 起命中复合(震 + 白闪 + 慢动作)
- [ ] 2.3s 起 boss 出场(红屏 + 震 + 顶部红条)
- [ ] 3.5s 起升级金光
- [ ] 全程 HUD 正常显示 HP 条 / Lv 5 / 武器槽

### 步骤 3 — WebGL FX fallback 复核(可选增强)

把上面 SmokeScene 的 `Phaser.CANVAS` 改成 `Phaser.WEBGL`,在末尾加:

```ts
const dummy = this.add.image(cx, cy + 60, '__white_circle').setScale(2).setTint(0xff4444);
applyGlow(dummy, 0xffe070, 32);     // WebGL 下应该看到金色 glow
applyBloom(this.cameras.main);       // WebGL 下应该看到整屏微 bloom
```

**链路作者**确认:

- [ ] WebGL 下 dummy 周围有可见 glow
- [ ] WebGL 下整屏有微 bloom
- [ ] 把 type 切回 Phaser.CANVAS,**不抛错**(applyGlow / applyBloom 返回 null,业务继续)

### 步骤 4 — 删除临时 case

merge 前删掉 `cases/_v1.1-lib-smoke/`。

## Acceptance criteria

跑下列断言,全部通过:

1. ✅ 4 个 ts 文件存在 + 文件路径与本文档一致
2. ✅ `cd templates/scaffold && npx tsc --noEmit` 返回 0 error
3. ✅ visualTheme.ts 文件顶部 doc 明确区分"核心 CANVAS-safe helper"与"FX optional fallback"
4. ✅ 4 个文件总 LOC ≤ 600(用 `wc -l` 验)
5. ✅ 没有任何文件 import `objectPool` 或 `spatialGrid`(确认未误 ship 推迟项)
6. ✅ progressionMath.ts 不含 `import Phaser`(确认纯函数无引擎依赖)
7. ✅ 每个 helper 函数都有 JSDoc 注释 + 参数类型 + 返回类型
8. ✅ 链路作者完成 Pre-validation 步骤 1-4 的 sign-off(在 PR 描述记录人眼复核截图或确认)

## Out-of-scope

- 不写任何 helper 的 internal 实现细节(让 Codex 实施时按签名 + JSDoc 写;本文档只锁接口和 CANVAS-safe 边界)
- 不让任何 case 立刻引用这些 helper(Phase 3 prepare_case_game.js 才把 lib/ 加入 SCAFFOLD_FILES)
- 不修改 SKILL.md(Phase 4)
- 不 ship objectPool / spatialGrid(已 defer 到 v1.2,接口存档在 `evolution-docs/research-notes-phaser.md` § 4)
- 不写 archetype-specific helper(违 Option C)

## Codex notes / Open questions

- **Q**: visualTheme.ts 用 ParticleEmitter 还是手动 add.circle 循环?
  **A**: 必须用 ParticleEmitter (3.60+ unified API):`scene.add.particles(x, y, texture, config).explode(count)`,500ms 后 destroy。**禁用** `manager.createEmitter()`(3.60 已删除会抛错)
- **Q**: blendMode='ADD' 在 CANVAS 下不生效怎么办?
  **A**: Phaser CANVAS renderer 静默回退到 NORMAL,粒子仍然可见,只是没加法亮度。这是 acceptable trade-off。不要为此改用 WebGL
- **Q**: hudBuilder 用 BitmapText 还是 Text?
  **A**: 用 Text(`scene.add.text`)。BitmapText 需要 bitmap font asset,case 没有这个素材
- **Q**: inputController 的虚拟摇杆怎么画?
  **A**: 用 Graphics + Pointer,不依赖外部 plugin。摇杆只在 enableTouch=true 且检测到 touch start 时显示;键盘 only 模式不画
- **Q**: progressionMath 真有必要吗?随便写也就 5-10 行。
  **A**: 是的。统一函数名(thresholdCurve / waveScale)让 case 之间的曲线 vocab 一致,后续 Stage 2 调参时知道改哪里
- **Q**: lib 总 LOC 600 是硬上限吗?
  **A**: 软上限。允许 +10% 浮动 (660),超过则触发"是不是又滑回小型框架库"的反思 — 链路作者人工 review 是否能 inline / 合并函数减少。**必须**在 PR 描述附 LOC 计数表

## Phase 报告模板

完成时 stdout:

```
[v1.1 phase-2] STATUS=done
files-created:
  - templates/scaffold/src/lib/visualTheme.ts
  - templates/scaffold/src/lib/inputController.ts
  - templates/scaffold/src/lib/hudBuilder.ts
  - templates/scaffold/src/lib/progressionMath.ts
files-modified: none
acceptance-passed: 8 / 8
pre-validation-signoff: <author>, <date>, screenshots in PR
follow-ups: none (objectPool/spatialGrid deferred to v1.2)
blockers: none
```
