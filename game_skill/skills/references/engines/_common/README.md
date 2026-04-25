# 引擎共享层 `references/engines/_common/`

## 职责

把 5 条引擎（canvas / dom / phaser3 / pixijs / three）**语义相同、实现不同**的通用能力抽出来，统一成接口（interface），让：

- **codegen 子 agent** 只写业务代码、只调用共享接口（`getTexture('hero') / playEffect('screen-shake') / testHook.expose(...)`），不直接碰引擎 API
- **引擎 adapter** 负责把共享接口翻译成引擎原生 API
- **脚本**（`generate_registry.js` 等）能基于共享接口**自动产出**一部分原本靠 LLM 手写的胶水代码

## P1 范围（本次落地）

| 模块 | 解决什么问题 | 引擎无关部分 | 引擎特定 adapter |
|---|---|---|---|
| `registry.spec.js` | 素材退化为色块 | 数据驱动：由 `assets.yaml` → id 表 → `getTexture/getAudio/getSprite(id)` | `adapters/{engine}-registry.js` 把 id 翻译成引擎加载 API |
| `fx.spec.js` | 技能没特效 | 7 个标准动词 → 统一 `playEffect(name, ctx)` 入口 | `adapters/{engine}-fx.js` 翻译到引擎原生粒子/shake/tint |
| `test-hook.js` | Playwright 接入漂移 | `testHook.expose(name, fn)` / `testHook.gameState(ref)` 引擎无关包装 | 无需 adapter（纯 JS） |

后续 P2 再做的（不在本次范围）：
- `event-bus.js`（pub/sub 总线，引擎无关）
- `scene-manager.spec.js`（声明式 scene-transitions）

## 目录结构

```
references/engines/
├── _common/
│   ├── README.md                (本文件)
│   ├── registry.spec.js         接口定义 + 引擎无关工厂
│   ├── fx.spec.js               接口定义 + 标准动词白名单
│   └── test-hook.js             纯实现
├── canvas/
│   └── template/
│       ├── index.html
│       └── src/
│           ├── main.js          (业务入口；引用共享接口)
│           └── adapters/
│               ├── canvas-registry.js
│               └── canvas-fx.js
├── phaser3/
│   └── template/src/adapters/
│       ├── phaser-registry.js
│       └── phaser-fx.js
├── pixijs/
│   └── template/src/adapters/
│       ├── pixi-registry.js
│       └── pixi-fx.js
└── dom/
│   └── template/
│       └── (DOM 把 adapter 内联到 index.html 里，不拆多文件)
└── three/
    └── template/src/adapters/
        ├── three-registry.js    (含 GLTFLoader 加载 .glb/.gltf，texture 走 SRGB)
        └── three-fx.js          (tint-flash 作用于 Mesh.material.color；float-text 用 DOM 叠加)
```

## 契约要点

### 契约 1：asset registry

- codegen 禁止写 `this.load.image(...)` / `new Image()` / `Assets.load(...)` 等引擎原生加载语句
- 统一走：
  ```js
  import { createRegistry } from './adapters/<engine>-registry.js';
  const registry = await createRegistry(assetsManifest, { engine });
  const tex = registry.getTexture('hero-warrior-idle');
  ```
- `assetsManifest` 结构由 `scripts/generate_registry.js` 从 `specs/assets.yaml` 产出

### 契约 2：fx runtime

- codegen 禁止散写 `this.cameras.main.shake(...)` / `ColorMatrixFilter` / 手写 particle 循环
- 统一走：
  ```js
  import { playEffect } from './adapters/<engine>-fx.js';
  playEffect('screen-shake', { intensity: 3, duration: 150 });
  playEffect('particle-burst', { x, y, color: '#ff0', count: 12 });
  ```
- 动词表：`particle-burst / screen-shake / tint-flash / float-text / scale-bounce / pulse / fade-out`（和 `rule.yaml.visual` 里的动词一字一致）

### 契约 3：test hook

- 纯 JS，无 adapter。导出 `exposeTestHooks({ state, hooks })`，负责把 `window.gameState` / `window.gameTest.*` 按规范挂到 window。
- 替代 codegen 手写的 `window.gameState = state; window.simulateCorrectMatch = ...`

## 对 codegen 子 agent 的影响

Phase 4 codegen prompt 新增硬约束：

> 禁止在业务代码里直接调用引擎加载/特效 API。统一通过 `import { ... } from './adapters/<engine>-*.js'`。
> 违反此约束的生成结果会被 `check_skill_compliance.js` 的 `assets.local-file-bind-rate` / `effects.visual-verb-bind-rate` 规则判失败。

## 对校验器的影响

`check_skill_compliance.js` 的 `assets.*` / `effects.*` 规则需要在 P1-1 落地后**加权**：
- 代码里 grep 到 `getTexture(` / `playEffect(` = 绑定命中（替代原来按基础动词搜索）
- 旧的 fillRect / Graphics().rect() 规则保留作 fallback 检测