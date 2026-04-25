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
  clickStartButton: () => active.startGame(),
  clickRetryButton: () => active.retry(),
};
