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
    // TODO(codegen): 此 stub 必须被完整实现。契约清单（codegen.md Step 4.0.5.1）：
    //   1. scenario.fields 每一条都要写回 state（entities[].initial 里声明的所有字段）
    //   2. scenario 每个 entity collection teardown（scene.children.remove + off）+ rebuild
    //   3. 清 scene.time.removeAllEvents + tween manager + pool/gate accounting
    //   4. 尊重 scenario.fields['game.phase']，不硬写成 idle
    //   5. 结束前调 scene.events.emit('refresh-ui') 或直接重画 HUD
    // check_project 会静态扫描；只 warn 或只改 score/misses 都会 fail。
    console.warn('probes.resetWithScenario: stub — codegen 需实现完整契约');
  },
  stepTicks: (n) => {
    console.warn('probes.stepTicks: stub — codegen 需实现');
  },
};
