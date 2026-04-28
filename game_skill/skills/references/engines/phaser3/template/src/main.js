import { MainScene } from "./scenes/MainScene.js";

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#1e293b",
  physics: {
    default: "arcade",
    arcade: { gravity: { y: 0 }, debug: false },
  },
  scene: [MainScene],
};

window.game = new Phaser.Game(config);

// === Test API (Phase 5 校验需要) ===
window.gameTest = window.gameTest || {};
window.gameTest.observers = {
  getSnapshot: () => JSON.parse(JSON.stringify(window.gameState)),
  getTrace: () => [...(window.__trace || [])],
  getAssetUsage: () => [...(window.__assetUsage || [])],
};
window.gameTest.drivers = {
  // codegen 阶段按实际 UI 填充，例如：
  // clickStartButton: () => document.querySelector('#btn-start')?.click(),
};
window.gameTest.probes = {
  resetWithScenario: (scenario) => {
    // codegen 阶段按实际游戏状态结构填充
    console.warn('probes.resetWithScenario: stub — codegen 需实现');
  },
  stepTicks: (n) => {
    console.warn('probes.stepTicks: stub — codegen 需实现');
  },
};
