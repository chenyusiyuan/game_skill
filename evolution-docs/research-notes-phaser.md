# Phaser 3.90 调研笔记 (for v1.1 lib/ 设计)

> 调研日期:2026-05-25
> 仓库当前 Phaser 版本:`3.90.0` (`/Users/bytedance/Project/mini-game/node_modules/phaser/package.json`)
> 目标:为 v1.1 的 `templates/scaffold/src/lib/` helper 设计提供事实底座,避免靠模型脑内印象。

## 1. 关键事实 (引擎能力)

### 1.1 ParticleEmitter (3.60+ 统一 API)

3.60 起 `ParticleEmitterManager` 被**移除**。旧的 `manager.createEmitter()` 写法抛错。当前正确用法:

```ts
// 一次性爆散 (one-shot)
const emitter = scene.add.particles(0, 0, '__white_circle', {
  speed: { min: 30, max: 120 },
  scale: { start: 0.6, end: 0 },
  lifespan: 400,
  blendMode: 'ADD',
  emitting: false      // 关键:不让它自动持续发射
});
emitter.explode(20, hitX, hitY);
scene.time.delayedCall(500, () => emitter.destroy());
```

要点:
- `add.particles(x, y, texture, config)` 直接返回 emitter
- 必须有 texture key — 我们没素材时,用 `Graphics.generateTexture()` 提前生成
- `{ emitting: false }` 才能做 explode(否则会同时持续流)
- 旧代码若有 `manager.createEmitter()` 写法 → **必须重写**

关键事件:`'start' | 'explode' | 'deathzone' | 'stop' | 'complete'`

### 1.2 FX System (3.60+ WebGL-only)

支持效果:Barrel / Bloom / Blur / Bokeh / Circle / ColorMatrix / Displacement / Glow / Gradient / Pixelate / Shadow / Shine / Vignette / Wipe

**Pre FX**(更便宜,纹理大小 framebuffer):仅可用于 `Image / Sprite / TileSprite / Text / RenderTexture / Video`

**Post FX**(更贵,canvas 大小):任何 GameObject + Cameras

```ts
// Glow on a sprite
sprite.preFX.addGlow(0xffe070, 32);   // color, outerStrength

// Bloom on camera
camera.postFX.addBloom(0xffffff, 1, 1, 1, 1, 4);

// Pixelate
sprite.postFX.addPixelate(8);

// Color matrix (vintage)
const cm = sprite.postFX.addColorMatrix();
cm.sepia();
```

**重要陷阱**:
- **CANVAS renderer 静默忽略 FX**。helper 必须检测 `scene.game.renderer.type === Phaser.WEBGL`,CANVAS 时 no-op fallback
- `setFXPadding(padding)` 防止 glow / shadow 被裁剪
- Phaser 4 已经把 `preFX/postFX` 改名为 `filters.internal/external` — 我们锁 3.90,不去 4

### 1.3 Camera 效果 (always available)

| 效果 | 签名 | 推荐数值 |
|---|---|---|
| `shake(duration, intensity, force, cb, ctx)` | 默认 100ms / 0.05 | 微震 `(100, 0.005)` / 受击 `(200, 0.01)` / 死亡 `(300, 0.02)` / 爆炸 `(500, 0.04)` |
| `flash(duration, r, g, b, force, cb, ctx)` | 默认 250ms / 白 | 命中白闪 `(80, 255,255,255)` / 受伤红闪 `(150, 255,0,0)` / 拾取白闪 `(300, 255,255,255)` |
| `fade / fadeIn / fadeOut(duration, r, g, b, ...)` | 默认 1000ms / 黑 | 场景过渡 `(400-1000)` |
| `pan(x, y, duration, ease, force, cb)` | 默认 1000ms / Linear | Boss 出场 `(2000, 'Power2')` |
| `zoomTo(zoom, duration, ease, force, cb)` | 默认 1000ms | 配合 pan 做 boss reveal |

陷阱:
- **再次触发同效果必须传 `force = true`**,否则正在跑的 effect 会忽略新调用
- `intensity > 0.05` 主观上让人晕(超过视口 5%)
- 用事件常量 `Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE`,不要用字符串
- `time.timeScale = 0.3` 影响整个 scene(可做 hit-stop),不要 forget reset

### 1.4 Hit-stop 模式 (juice 标配)

```ts
function hitStop(scene: Phaser.Scene, intensity = 0.015, duration = 120) {
  scene.cameras.main.shake(150, intensity);
  scene.cameras.main.flash(80, 255, 255, 255);
  scene.time.timeScale = 0.3;
  scene.time.delayedCall(duration, () => { scene.time.timeScale = 1; });
}
```

### 1.5 对象池

社区主流:`Phaser.GameObjects.Group` with `classType + maxSize + runChildUpdate`。
poke-survivors (3.90 真实 VS clone) 用此模式做 `enemyProjectiles` 共享池(maxSize: 60)。

```ts
const pool = scene.add.group({
  classType: Phaser.GameObjects.Image,
  maxSize: 60,
  runChildUpdate: false
});
// 取
const obj = pool.get(x, y, 'bullet');
if (obj) { obj.setActive(true).setVisible(true); }
// 还
obj.setActive(false).setVisible(false);
```

### 1.6 输入

- 键盘:`scene.input.keyboard.createCursorKeys()` + `addKeys('W,A,S,D')`
- 触摸虚拟摇杆:无内建,社区写法是 canvas-based dropleft style(poke-survivors 有 `src/ui/VirtualJoystick`)
- 手柄:`scene.input.gamepad.pad1`

### 1.7 程序化纹理生成 (无素材时关键)

```ts
function ensureProceduralTextures(scene: Phaser.Scene) {
  if (!scene.textures.exists('__white_circle')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture('__white_circle', 16, 16);
    g.destroy();
  }
  // 同理 __white_square, __white_star, __white_diamond
}
```

ParticleEmitter / Image / Sprite 都可以用这些生成的 key。

## 2. 真实 Phaser-VS clone 结构 (poke-survivors, Phaser 3.90)

```
src/
├── attacks/          # 1 file per weapon (77 个)
├── audio/            # 程序化 SFX (Web Audio API,无音频文件)
├── data/             # 数据 (registry / categories / evolutions)
├── entities/         # Player / Enemy / Boss / Pickup / Destructible
├── scenes/           # Boot → Title → Select → Game + UI scenes
├── systems/          # Collision / Spawn / Pickup / SpatialHashGrid
├── ui/               # MiniMap / VirtualJoystick / HUD
├── i18n/             # 国际化
├── utils/            # (具体内容未公开,但目录存在)
├── config.ts         # 全局常量
└── types.ts          # TS 类型
```

通用 attack interface:`{ type, level, update(), upgrade(), destroy() }`

性能优化:
- SpatialHashGrid 做 O(1) 邻近查询(100+ 实体场景必备)
- 共享 projectile pool maxSize 60
- VFX gating:`shouldShowVfx()` 全局开关,低端机降级

启示:
- 真实 Phaser 游戏**没有** "visualTheme.ts" 这种 helper — 各家自己写
- 但**通用模式**确实存在(对象池 / 空间哈希 / 程序化 SFX),可以抽出来

## 3. 官方模板现状

`phaserjs/template-vite-ts` 是官方推荐(已升 Phaser 4)。结构极简:

```
src/
├── main.ts            # bootstrap
├── game/
│   ├── main.ts        # game config + start
│   └── scenes/        # 所有 scene
```

**没有 lib/ 或 helpers/** — 官方不在模板里塞 helper。

启示:lib/ 是我们的**主动选择**,不是 Phaser 社区惯例。这意味着:
- helper 设计要谨慎,不要硬塞品类倾向
- helper 必须 genre-agnostic 才合理(不然就是品类专属 scaffold,违背 Option C)

## 4. 修订后的 lib/ 接口设计

基于以上发现,原 5 helper 升级为 6 helper:

### 4.1 visualTheme.ts (~220 LOC)

```ts
// === 程序化纹理(必须在使用其他 helper 前调用一次)===
export function ensureProceduralTextures(scene: Phaser.Scene): void;

// === 粒子(用 3.60+ 统一 API)===
export function burstParticles(
  scene: Phaser.Scene,
  x: number, y: number,
  opts?: {
    color?: number;        // tint
    count?: number;        // 默认 12
    speed?: { min: number; max: number };
    lifespan?: number;
    scale?: { start: number; end: number };
    blendMode?: 'ADD' | 'NORMAL' | 'MULTIPLY';
  }
): void;

// === 命中飘字 ===
export function damageNumber(
  scene: Phaser.Scene,
  x: number, y: number, value: number | string,
  opts?: { color?: string; fontSize?: string; rise?: number; duration?: number }
): void;

// === Camera 效果包装(带防误触)===
export function screenShake(
  scene: Phaser.Scene,
  preset: 'micro' | 'hit' | 'death' | 'explosion' | { duration: number; intensity: number }
): void;

export function screenFlash(
  scene: Phaser.Scene,
  color: 'white' | 'red' | 'green' | 'gold' | { r: number; g: number; b: number },
  duration?: number
): void;

// === 命中复合(shake + flash + hit-stop)===
export function hitImpact(
  scene: Phaser.Scene,
  preset: 'light' | 'medium' | 'heavy'
): void;

// === FX 包装(自带 WebGL fallback)===
export function applyGlow(
  target: Phaser.GameObjects.GameObject,
  color: number, strength?: number
): unknown | null;   // 非 WebGL 返回 null

export function applyBloom(
  target: Phaser.GameObjects.GameObject | Phaser.Cameras.Scene2D.Camera,
  color?: number, strength?: number
): unknown | null;

// === 扩散光圈 ===
export function flashRing(
  scene: Phaser.Scene,
  x: number, y: number, color: number,
  opts?: { startRadius?: number; endRadius?: number; duration?: number }
): void;

// === 升级闪光(camera flash + 中心扩散)===
export function levelUpFlash(scene: Phaser.Scene, color?: number): void;

// === Boss 出场(camera shake + flash + 警告 overlay)===
export function bossEntry(scene: Phaser.Scene, opts?: { color?: number; durationMs?: number }): void;
```

### 4.2 inputController.ts (~120 LOC)

```ts
export class InputController {
  constructor(scene: Phaser.Scene, opts?: {
    enableKeyboard?: boolean;     // 默认 true (WASD + arrows)
    enableTouch?: boolean;         // 默认 true (虚拟摇杆 + tap actions)
    enableGamepad?: boolean;       // 默认 false (需要时打开)
    actionBindings?: Record<string, string[]>;  // e.g. { fire: ['SPACE', 'pointer1'] }
  });

  axes2D: Phaser.Math.Vector2;          // -1..1 normalized,合并所有输入源
  isActionDown(action: string): boolean;
  onActionDown(action: string, cb: () => void): void;
  onActionUp(action: string, cb: () => void): void;
  destroy(): void;                       // 必须调用,scene shutdown 时
}
```

### 4.3 hudBuilder.ts (~150 LOC)

```ts
export function meterBar(
  scene: Phaser.Scene,
  opts: {
    x: number; y: number; width: number; height: number;
    color?: number;            // 主色
    bgColor?: number;          // 背景色
    showText?: boolean;
    label?: string;
    fixedToCamera?: boolean;   // 默认 true
  }
): {
  setValue(value: number, max: number): void;
  destroy(): void;
};

export function statusText(
  scene: Phaser.Scene,
  opts: { x: number; y: number; label: string; color?: string; fontSize?: string }
): { setText(s: string): void; destroy(): void };

export function iconSlot(
  scene: Phaser.Scene,
  opts: { x: number; y: number; size: number; iconText?: string; level?: number }
): { setLevel(n: number): void; setActive(active: boolean): void; destroy(): void };
```

### 4.4 objectPool.ts (~80 LOC)

```ts
// 包装 Phaser.GameObjects.Group,提供 typed get/release
export function createPool<T extends Phaser.GameObjects.GameObject>(
  scene: Phaser.Scene,
  classType: new (scene: Phaser.Scene, ...args: unknown[]) => T,
  maxSize: number
): {
  get(x: number, y: number, ...rest: unknown[]): T | null;
  release(obj: T): void;
  forEachActive(cb: (obj: T) => void): void;
  countActive(): number;
  destroy(): void;
};
```

### 4.5 progressionMath.ts (~60 LOC, 纯函数)

```ts
export function linearRamp(t: number, from: number, to: number): number;
export function exponentialRamp(value: number, growth: number, ticks: number): number;
export function thresholdCurve(level: number, base: number, growth: number): number;  // XP 累计阈值
export function waveScale(wave: number, perWaveMultiplier: number): number;            // 1 + (wave-1) * mul
export function clamp(value: number, min: number, max: number): number;
export function lerp(a: number, b: number, t: number): number;
```

### 4.6 spatialGrid.ts (~80 LOC, 新增,based on poke-survivors 经验)

```ts
// 100+ 实体场景的 O(1) 邻近查询
export class SpatialHashGrid<T> {
  constructor(cellSize: number);
  insert(item: T, x: number, y: number): void;
  remove(item: T, x: number, y: number): void;
  query(x: number, y: number, radius: number): T[];
  clear(): void;
}
```

**何时使用 spatialGrid?** 同屏实体 > 50 个时(VS 类生存 / 大量子弹 / 群战)。其他游戏(puzzle / 拼字 / 文字)用不到,不 import 即可。

## 5. 修订后 lib/ 与 v1.1 plan 的对账

| v1.1 原计划 | 调研后修订 |
|---|---|
| visualTheme.ts ~150 LOC | ~220 LOC,加 hitImpact / bossEntry / Glow Bloom 包装 + WebGL fallback |
| inputController.ts ~80 LOC | ~120 LOC,加 action bindings 抽象 |
| hudBuilder.ts ~120 LOC | ~150 LOC,接口收敛为 meterBar/statusText/iconSlot 三类 |
| objectPool.ts ~60 LOC | ~80 LOC,基于 Phaser.GameObjects.Group |
| progressionMath.ts ~50 LOC | ~60 LOC,加 lerp / clamp |
| ❌ 没有 spatialGrid | ✅ 新增 ~80 LOC |

总 LOC:**460 → 690**,6 个文件。

## 6. SKILL.md 待补的 Phaser 坑(基于研究 + kimi 经验)

```markdown
## Phaser 3.90 常见坑(Phase B 写代码时参考)

### API 选择
1. ParticleEmitter 用 `add.particles(x, y, key, config).explode(n)` 不要 `manager.createEmitter`(3.60 已删除,会抛错)
2. FX (Glow / Bloom / Pixelate) 仅 WebGL renderer 可用,CANVAS 静默忽略;helper 自带 fallback
3. cameras 效果再次触发用 `force = true`,否则 silent ignore
4. 用事件常量 `Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE`,不要用字符串
5. `time.timeScale = 0.3` 影响整个 scene,做 hit-stop 后**必须 reset**

### Container 与 input
6. Container 内子对象 `setInteractive` 后 input 不传播到 container,要么子对象自己 setInteractive,要么扁平化(rect + text 平铺到 scene 顶层)

### 生命周期
7. `scene.restart()` 不会清 tween/timer,要在 shutdown 钩子手动 `tweens.killAll()` + `time.removeAllEvents()`
8. Scene 间共享 emitter / pool 要在 shutdown 显式 destroy,否则跨 scene 引用会泄漏

### 物理
9. Container 的 body 是 `Arcade.Body` 不是 `Sprite Body`,API 略有差异;要 `physics.add.existing(container)` 后再 `setCircle/setSize`
10. Arcade.overlap 与 collide 区别:overlap 不阻挡,collide 阻挡;穿透型武器要用 overlap

### 资源
11. Texture key 缺失静默失败(显示绿框),用 `if (!textures.exists(key))` 主动检查
12. ParticleEmitter 必须有 texture,无素材时用 `make.graphics().generateTexture()` 程序化生成

### update / 帧率
13. update 里的 `delta` 是 ms,不要写 `entity.x += speed`,要 `entity.x += speed * delta / 1000`
14. requestAnimationFrame 在 tab 失焦时会暂停,scene `pause()` + `resume()` 时第一帧 delta 可能极大,做 dt 上限 clamp `dt = Math.min(delta / 1000, 0.05)`

### 类型
15. `addKeys('W,A,S,D')` 返回类型 `Record<string, Phaser.Input.Keyboard.Key>`,不是 `KeyKeys`
16. 循环变量名不要和函数参数同名(kimi 实战踩过 `for (const dt of damageTexts) { dt.timer -= dt }` TS2363)
```

约 16 条,~50 行。

## 7. 调研结论 (要点)

1. **Phaser 3.90 能力远高于裸 Canvas**,但需要正确 API 才能发挥(ParticleEmitter unified / FX / cameras 效果)
2. **CANVAS renderer 是 FX 的 silent killer**,helper 必须 fallback
3. **lib/ 设计可行且必要**,但 helper 数量从 5 → 6(加 spatialGrid),且都需要 Phaser-aware 写法,不是包装原语
4. **真实 Phaser 游戏的 helper 都是各家自写**,我们的 lib/ 是主动整理的"通用最小集",不是 community 标准
5. **Phaser 4 已发布并改了 FX API**,但 3.90 是当前稳定线,我们锁 3.90 不冒进
6. **SKILL.md 的 Phaser 坑列表**有具体素材(基于研究 + kimi 实战),~16 条 ~50 行可以一次说清

## 8. 来源

- [Phaser 3 官方模板 phaserjs/template-vite-ts](https://github.com/phaserjs/template-vite-ts)
- [poke-survivors (Phaser 3.90 + TS + Vite VS clone)](https://github.com/giovanneluna/poke-survivors)
- [Phaser ParticleEmitter changelog 3.60](https://github.com/phaserjs/phaser/blob/master/changelog/3.60/ParticleEmitter.md)
- [Phaser FX Concepts](https://docs.phaser.io/phaser/concepts/fx)
- [Phaser Cameras docs](https://docs.phaser.io/phaser/concepts/cameras)
- [generalistprogrammer.com — camera effects values](https://generalistprogrammer.com/tutorials/phaser-platformer-tutorial)
- [emanueleferonato.com — VS prototype in Phaser](https://emanueleferonato.com/2024/11/29/quick-html5-prototype-of-vampire-survivors-built-with-phaser-like-the-original-game/)
- [phaser3-juice-plugin (per-sprite juice)](https://github.com/RetroVX/phaser3-juice-plugin)
