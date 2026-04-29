import * as THREE from "three";
import { state } from "./state.js";
import { MainScene } from "./scenes/MainScene.js";

const root = document.getElementById("root");

// ===== Renderer =====
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0f172a, 1);
root.appendChild(renderer.domElement);

// ===== Camera =====
const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.1, 200
);
camera.position.set(0, 4, 8);
camera.lookAt(0, 0, 0);

// ===== Scene boot =====
const active = new MainScene({ camera, renderer });

// ===== Resize =====
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ===== Render loop =====
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  active.update(dt);
  renderer.render(active.scene, camera);
  requestAnimationFrame(tick);
}
tick();

// ===== Window hooks for test harness =====
window.app = { renderer, camera, active };
window.gameTest = {
  observers: {
    getSnapshot: () => JSON.parse(JSON.stringify(window.gameState)),
    getTrace: () => [...(window.__trace || [])],
    getAssetUsage: () => [...(window.__assetUsage || [])],
  },
  drivers: {
    clickStartButton: () => active.startGame(),
    clickRetryButton: () => active.retry(),
  },
  probes: {
    resetWithScenario: (scenario) => {
      // TODO(codegen): 此 stub 必须被完整实现。契约清单（codegen.md Step 4.0.5.1）：
      //   1. scenario.fields 每一条都要写回 state（entities[].initial 里声明的所有字段）
      //   2. scenario 每个 entity collection teardown（scene.remove(mesh) + dispose geometry/material）+ rebuild
      //   3. 清所有 animation mixer / interval / rAF loop + pool/gate accounting
      //   4. 尊重 scenario.fields['game.phase']，不硬写成 idle
      //   5. 结束前 renderer.render(scene, camera) + 更新 HUD DOM
      // check_project 会静态扫描；只 warn 或只改 score/misses 都会 fail。
      console.warn("probes.resetWithScenario: stub - codegen needs to implement full contract");
    },
    stepTicks: () => {
      console.warn("probes.stepTicks: stub - codegen needs to implement this");
    },
  },
};
