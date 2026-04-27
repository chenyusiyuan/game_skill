// ResultScene — 游戏结算页面
// 显示胜利/失败、最终得分、重试按钮、下一关按钮

import { state, LEVELS } from "../state.js";
import { preloadRegistryAssets, createRegistry } from "../adapters/phaser-registry.js";
import { createFx } from "../adapters/phaser-fx.js";
import manifest from "../assets.manifest.json" with { type: "json" };

export class ResultScene extends Phaser.Scene {
  constructor() {
    super("ResultScene");
  }

  preload() {
    preloadRegistryAssets(manifest, { scene: this });
  }

  create() {
    const registry = createRegistry(manifest, { scene: this });
    const fx = createFx({ scene: this });

    state.currentScene = "result";
    state.scene = "ResultScene";

    const isWin = state.phase === "win";

    // Background
    this.add.rectangle(360, 640, 720, 1280, 0x1a1a2e);

    // Result panel
    const panelY = 400;
    const panelWidth = 500;
    const panelHeight = 400;

    const panel = this.add.graphics();
    panel.fillStyle(0x16213e, 1);
    panel.fillRoundedRect(360 - panelWidth / 2, panelY - panelHeight / 2, panelWidth, panelHeight, 16);
    panel.lineStyle(3, isWin ? 0x22c55e : 0xef4444);
    panel.strokeRoundedRect(360 - panelWidth / 2, panelY - panelHeight / 2, panelWidth, panelHeight, 16);

    // Result title
    const titleText = isWin ? "胜利!" : "游戏结束";
    const titleColor = isWin ? "#22c55e" : "#ef4444";

    this.add
      .text(360, panelY - 140, titleText, {
        fontSize: "36px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: titleColor,
      })
      .setOrigin(0.5);

    // Level info
    this.add
      .text(360, panelY - 60, `关卡 ${state.level}`, {
        fontSize: "20px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#e2e8f0",
      })
      .setOrigin(0.5);

    // Score
    this.add.image(320, panelY + 10, "hud-coin").setScale(0.8);
    this.add
      .text(380, panelY + 10, String(state.score), {
        fontSize: "28px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#facc15",
      })
      .setOrigin(0, 0.5);

    // Stats
    this.add
      .text(360, panelY + 70, `攻击次数: ${state.totalAttacks}`, {
        fontSize: "14px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#94a3b8",
      })
      .setOrigin(0.5);

    this.add
      .text(360, panelY + 100, `成功命中: ${state.successfulAttacks}`, {
        fontSize: "14px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#22c55e",
      })
      .setOrigin(0.5);

    // Buttons
    const btnY = panelY + 160;

    // Retry button - use btn-retry textures
    this.createButton(registry, fx, 260, btnY, "重试", "retry", () => {
      this.scene.start("PlayScene");
    });

    // Next level button (only if win) - use btn-next textures
    if (isWin) {
      // Unlock next level
      const nextLevel = state.level + 1;
      if (nextLevel <= LEVELS.length && !state.unlockedLevels.includes(nextLevel)) {
        state.unlockedLevels.push(nextLevel);
      }

      this.createButton(registry, fx, 460, btnY, "下一关", "next", () => {
        state.level = Math.min(state.level + 1, LEVELS.length);
        this.scene.start("PlayScene");
      });
    }

    // Victory effects
    if (isWin) {
      fx.playEffect("screen-shake", { intensity: 3, duration: 300 });
      this.time.delayedCall(100, () => {
        fx.playEffect("particle-burst", { x: 360, y: panelY, color: "#facc15", count: 30 });
      });
    }

    // Expose test hooks
    this.exposeTestHooks();
  }

  createButton(registry, fx, x, y, text, buttonType, callback) {
    const btnWidth = 120;
    const btnHeight = 48;

    const btnContainer = this.add.container(x, y);

    // Use button textures from manifest
    const leftKey = buttonType === "retry" ? "btn-retry-left" : "btn-next-left";
    const centerKey = buttonType === "retry" ? "btn-retry-center" : "btn-next-center";
    const rightKey = buttonType === "retry" ? "btn-retry-right" : "btn-next-right";

    // Left cap
    const leftImg = this.add.image(-btnWidth / 2 + 12, 0, leftKey).setScale(1, 1.5);
    btnContainer.add(leftImg);

    // Center (stretched)
    const centerImg = this.add.image(0, 0, centerKey).setDisplaySize(btnWidth - 24, btnHeight);
    btnContainer.add(centerImg);

    // Right cap
    const rightImg = this.add.image(btnWidth / 2 - 12, 0, rightKey).setScale(1, 1.5);
    btnContainer.add(rightImg);

    const btnText = this.add
      .text(0, 0, text, {
        fontSize: "12px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#e2e8f0",
      })
      .setOrigin(0.5);
    btnContainer.add(btnText);

    btnContainer.setSize(btnWidth, btnHeight);
    btnContainer.setInteractive({ useHandCursor: true });

    btnContainer.on("pointerover", () => {
      leftImg.setTint(0x22c55e);
      centerImg.setTint(0x22c55e);
      rightImg.setTint(0x22c55e);
    });

    btnContainer.on("pointerout", () => {
      leftImg.clearTint();
      centerImg.clearTint();
      rightImg.clearTint();
    });

    btnContainer.on("pointerdown", () => {
      fx.playEffect("tint-flash", { target: btnContainer, color: "#ffffff", duration: 100 });
      callback();
    });

    return btnContainer;
  }

  exposeTestHooks() {
    window.gameTest = window.gameTest || {};
    window.gameTest.clickRetryButton = () => {
      this.scene.start("PlayScene");
    };
    window.gameTest.clickNextButton = () => {
      const nextLevel = Math.min(state.level + 1, LEVELS.length);
      if (state.unlockedLevels.includes(nextLevel)) {
        state.level = nextLevel;
      }
      this.scene.start("PlayScene");
    };
  }
}
