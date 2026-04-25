import * as THREE from "three";
import { state } from "../state.js";

export class MainScene {
  constructor({ camera, renderer }) {
    this.camera = camera;
    this.renderer = renderer;
    this.scene = new THREE.Scene();

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 0.9);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 5);
    this.scene.add(dir);

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x1e293b })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Placeholder hero (cube) — replace with GLTF in real game
    this.hero = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x60a5fa })
    );
    this.hero.position.y = 0.5;
    this.scene.add(this.hero);

    // Pointer to start
    this.renderer.domElement.addEventListener("pointerdown", () => {
      if (state.phase === "ready") this.startGame();
      else if (state.phase === "playing") this.scoreTick();
      else if (state.phase === "win" || state.phase === "lose") this.retry();
    });

    this.updateHud();
  }

  startGame() {
    if (state.isProcessing) return;
    state.phase = "playing";
    state.score = 0;
    this.updateHud();
  }

  scoreTick() {
    state.score += 1;
    if (state.score >= 10) {
      state.phase = "win";
    }
    this.updateHud();
  }

  retry() {
    state.phase = "ready";
    state.score = 0;
    this.updateHud();
  }

  update(dt) {
    if (state.phase === "playing") {
      this.hero.rotation.y += dt * 1.5;
    }
  }

  updateHud() {
    const left = document.getElementById("hud-left");
    const right = document.getElementById("hud-right");
    if (left) left.textContent = state.phase;
    if (right) right.textContent = `score: ${state.score}`;
  }
}
