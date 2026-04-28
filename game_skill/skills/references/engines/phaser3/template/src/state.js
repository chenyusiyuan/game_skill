export const state = {
  phase: "ready",
  score: 0,
  scene: "MainScene",
};

window.gameState = state;

// === Verify hooks (Phase 5 校验桥) ===
window.__trace = window.__trace || [];
window.__assetUsage = window.__assetUsage || [];
