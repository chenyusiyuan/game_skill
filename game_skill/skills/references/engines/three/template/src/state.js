export const state = {
  phase: "ready",      // ready | playing | win | lose
  scene: "MainScene",
  score: 0,
  isProcessing: false, // 异步锁（场景切换 / 交互动画期间置 true）
};
window.gameState = state;
