---
name: engine-three
description: "Three.js 引擎规范。适用于 is-3d=true 的 3D 展示 / 轻量 3D 小游戏 / 第一人称走格子 / 3D 平台跳跃。默认 run-mode=local-http，必须用 importmap + ESM + 多文件结构。2D 项目禁止选此引擎。"
---

# Three.js 引擎指南（pin `three@0.160`）

## 激活条件（硬性）

仅当 GamePRD front-matter `is-3d: true` 时才能使用此引擎；反之 `runtime: three` 要求 `is-3d: true`。违反会被 `check_game_prd.js` 的 FM016 阻断。

2D 项目一律走 `phaser3` / `pixijs` / `canvas` / `dom-ui`，不要强上 Three.js。

## 选型建议

| 场景 | 推荐度 |
|---|---|
| 3D 第一人称走迷宫 / 走格子 | ✅ 最佳（PointerLockControls） |
| 3D 平台跳跃（超级马里奥 64 类） | ✅ 可用，需离散 AABB 碰撞 |
| 3D 展示型 / 模型浏览器 | ✅ 最佳 |
| 3D 赛车 / 驾驶 | ✅ 可用（Kit + 轻物理） |
| 3D 塔防 / 俯视 3D | ✅ 可用 |
| 3D FPS / 连续物理 | ⚠️ 降级支持（裁剪到小场景） |
| 2D 任何类型 | ❌ 不得使用 |
| 规则问答型 / 剧情互动型 / 教育练习型 | ❌ 不得使用 |

## 技术栈

- CDN 版本锁：importmap 指向 `https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js`
- addons 路径前缀：`three/addons/` → `https://cdn.jsdelivr.net/npm/three@0.160/examples/jsm/`
- 默认 `run-mode=local-http`（importmap + ESM 不兼容 file:// 协议）
- 推荐多文件：`src/main.js` + `src/state.js` + `src/scenes/*.js` + `src/adapters/*.js`
- 必须暴露 `window.gameState`、`window.app`、`window.gameTest`
- **严禁**：`three@latest`、CDN 不加版本、`require("three")`、预期用户 npm install

## 最小骨架代码

**index.html**（必须含 importmap）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<!-- ENGINE: three | VERSION: three@0.160 | RUN: local-http -->
<meta charset="UTF-8">
<title>{GAME_TITLE}</title>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160/examples/jsm/"
  }
}
</script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./src/main.js"></script>
</body>
</html>
```

**src/state.js**

```js
export const state = {
  phase: "ready",
  scene: "MainScene",
  score: 0,
  isProcessing: false,
};
window.gameState = state;
```

**src/main.js**（renderer + camera + loop）

```js
import * as THREE from "three";
import { state } from "./state.js";
import { MainScene } from "./scenes/MainScene.js";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("root").appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.1, 200
);
camera.position.set(0, 4, 8);

const active = new MainScene({ camera, renderer });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
(function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  active.update(dt);
  renderer.render(active.scene, camera);
  requestAnimationFrame(tick);
})();

window.app = { renderer, camera, active };
window.gameTest = {
  clickStartButton: () => active.startGame(),
  clickRetryButton: () => active.retry(),
};
```

**src/scenes/MainScene.js**

```js
import * as THREE from "three";
import { state } from "../state.js";

export class MainScene {
  constructor({ camera, renderer }) {
    this.camera = camera;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 5);
    this.scene.add(dir);
    // ... 玩法 mesh / 物体
  }
  startGame() { if (state.isProcessing) return; state.phase = "playing"; }
  retry() { state.phase = "ready"; state.score = 0; }
  update(dt) { /* 每帧逻辑 */ }
}
```

## LLM 易错点

| 错误 | 纠正 |
|---|---|
| `three@latest` 或 `three@0.x`（浮动） | pin `three@0.160` |
| 用 CommonJS `require("three")` | 浏览器端只能用 ESM `import * as THREE from "three"` |
| addons 直接从 `three/examples/jsm/controls/...` 写绝对 CDN 路径 | 通过 importmap 前缀 `three/addons/controls/...` |
| 忘记 `renderer.setPixelRatio` | 高 DPR 屏会模糊；用 `Math.min(window.devicePixelRatio, 2)` |
| `new THREE.Scene()` 后不加光，物体变黑 | 至少一盏 `HemisphereLight` + `DirectionalLight` |
| `camera` 默认 `z=0`，相机卡在物体里 | 开局把 camera 移到 `(0, 4, 8)` 并 `lookAt(0,0,0)` |
| 每帧 new 几何体 / 材质 | 在 constructor 中创建，update 中复用 |
| 用 `PerspectiveCamera` 但忘记 resize 时更新 aspect/projection | 绑定 resize：`camera.aspect = w/h; camera.updateProjectionMatrix();` |
| `animate()` 内直接 `renderer.render` 而不管 scene 切换 | 用 active scene 持有引用，切场景时换 `active` |
| 异步加载 GLTF 时未加 `isProcessing` 锁 | 加载开始 `state.isProcessing = true`，onLoad 后释放 |
| 把 camera / renderer 放在 gameState 里 | `window.gameState` 只存逻辑数据（phase/score）；camera/renderer 放 `window.app` |
| 使用废弃属性（`.outputEncoding` / `gammaOutput`） | three@0.160 已用 `.outputColorSpace = THREE.SRGBColorSpace`；老 API 已删除 |

## GLTF 模型加载约定

使用 `GLTFLoader`（仅在 `assets.yaml` 有 `type: local-file` 且后缀 `.glb/.gltf` 时）：

```js
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const loader = new GLTFLoader();
state.isProcessing = true;
loader.load("../../../assets/library_3d/models/platformer/character.glb", (gltf) => {
  this.scene.add(gltf.scene);
  state.isProcessing = false;
});
```

**降级兜底**：如果 3D 素材库尚未就绪，用 `BoxGeometry` / `CylinderGeometry` / `SphereGeometry` + `MeshStandardMaterial` 的语义占位，并在控制台 `console.warn` 写明"GLTF 降级为几何体占位"。

## 常见控制器（addons）

| 玩法 | 控制器 | 来源 |
|---|---|---|
| 第一人称走迷宫 | `PointerLockControls` | `three/addons/controls/PointerLockControls.js` |
| 模型浏览器 | `OrbitControls` | `three/addons/controls/OrbitControls.js` |
| 平台跳跃 | 手写：A/D/W/S + jump + AABB | 不用 addons |
| 3D 赛车 | `OrbitControls` 跟随 + 手写转向 | 基础 + 自写 |

## 视觉特效 Cookbook

Three.js 的画面优势在于**PBR 光照 + 阴影 + 后处理**。以下是即用片段：

### 软阴影（L2 — 质感基础）

```js
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 50;

mesh.castShadow = true;
ground.receiveShadow = true;
```

### 相机震动（L1 — 受伤/碰撞）

```js
function shakeCamera(camera, intensity = 0.1, duration = 150) {
  const origin = camera.position.clone();
  const start = performance.now();
  (function frame() {
    const t = (performance.now() - start) / duration;
    if (t >= 1) { camera.position.copy(origin); return; }
    camera.position.x = origin.x + (Math.random() - 0.5) * intensity;
    camera.position.y = origin.y + (Math.random() - 0.5) * intensity;
    requestAnimationFrame(frame);
  })();
}
```

### 粒子爆发（L2 — 得分/击中）

```js
// Points + BufferGeometry 做简单粒子爆发
function particleBurst(scene, position, color = 0xfbbf24, count = 32) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = [];
  for (let i = 0; i < count; i++) {
    pos[i*3] = position.x; pos[i*3+1] = position.y; pos[i*3+2] = position.z;
    vel.push(new THREE.Vector3(
      (Math.random()-0.5) * 3, Math.random() * 3, (Math.random()-0.5) * 3
    ));
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size: 0.15, transparent: true });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  const start = performance.now();
  (function frame() {
    const t = (performance.now() - start) / 600;
    if (t >= 1) { scene.remove(points); geo.dispose(); mat.dispose(); return; }
    const arr = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      arr[i*3]   += vel[i].x * 0.016;
      arr[i*3+1] += (vel[i].y - 9.8 * t * 0.5) * 0.016;
      arr[i*3+2] += vel[i].z * 0.016;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = 1 - t;
    requestAnimationFrame(frame);
  })();
}
```

### Fog / 环境雾（L1 — 3D 走迷宫氛围）

```js
scene.fog = new THREE.Fog(0x0f172a, 5, 25);
renderer.setClearColor(scene.fog.color);
```

## 数值平衡 & 碰撞约定

- 3D 世界单位：1 unit = 1 米，hero 高度 ~1.8，相机眼高 ~1.6
- 碰撞：优先**离散 AABB**（`THREE.Box3.intersectsBox`），不要引入 Rapier/Cannon 除非 PRD 明确要求
- 3D 关卡的 `balance-check`：supply = 玩家可用资源；demand = 需通过的区段数 × 单段消耗

## window.gameState / window.app / window.gameTest 暴露位置

- `src/state.js`：`window.gameState = state`（phase/score/isProcessing）
- `src/main.js`：`window.app = { renderer, camera, active }`、`window.gameTest = { observers, drivers, probes }`
- Scene 切换时同步 `state.phase / state.scene`

## Playwright 断言示例

```js
await page.goto(launchUrl);
await page.waitForFunction(() => window.app?.renderer && window.gameState?.phase === "ready");
await page.evaluate(() => window.gameTest.drivers.clickStartButton());
await page.waitForFunction(() => window.gameState.phase === "playing");
expect(await page.evaluate(() => window.gameState.phase)).toBe("playing");
```

## 目录约定

```text
game/
├── index.html
├── package.json          ← {"type": "module"}
└── src/
    ├── state.js
    ├── main.js
    ├── adapters/         ← 可选：three-registry.js / three-fx.js
    └── scenes/
        └── MainScene.js
```

## 禁止事项

- ❌ `three@latest` / 不 pin 版本
- ❌ `run-mode=file`（importmap + ESM 无法在 file:// 下工作）
- ❌ 2D 项目强上 Three.js
- ❌ 依赖 npm install / bundler
- ❌ 每帧 new 几何体/材质 / 在 update 里分配大数组
- ❌ 把 renderer / camera 放进 `window.gameState`
- ❌ 跳过 `isProcessing` 锁就异步加载 GLTF
