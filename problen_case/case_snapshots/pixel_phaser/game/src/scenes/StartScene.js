// StartScene — 游戏开始页面
// 显示游戏标题、开始按钮、关卡选择

import { state, LEVELS } from "../state.js";
import { preloadRegistryAssets, createRegistry } from "../adapters/phaser-registry.js";
import { createFx } from "../adapters/phaser-fx.js";
import manifest from "../assets.manifest.json" with { type: "json" };

export class StartScene extends Phaser.Scene {
  constructor() {
    super("StartScene");
  }

  preload() {
    preloadRegistryAssets(manifest, { scene: this });
  }

  create() {
    state.currentScene = "start";
    state.phase = "ready";
    state.scene = "StartScene";

    const registry = createRegistry(manifest, { scene: this });
    const fx = createFx({ scene: this });

    // Background
    this.add.rectangle(360, 640, 720, 1280, 0x1a1a2e);

    // Title
    this.add
      .text(360, 200, "像素传送带", {
        fontSize: "36px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#facc15",
      })
      .setOrigin(0.5);

    this.add
      .text(360, 260, "清板游戏", {
        fontSize: "24px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#e2e8f0",
      })
      .setOrigin(0.5);

    // Start button - using pixel button texture
    this.createStartButton(registry, fx);

    // Level selection
    this.createLevelSelect(registry, fx);

    // Expose test hooks
    this.exposeTestHooks(registry, fx);
  }

  createStartButton(registry, fx) {
    const btnY = 450;
    const btnWidth = 200;
    const btnHeight = 48;

    // Use the button textures from assets.manifest.json
    // btn-start-left, btn-start-center, btn-start-right (normal state)
    // btn-start-pressed-left, btn-start-pressed-center, btn-start-pressed-right (pressed state)

    // Create button using actual textures
    const btnContainer = this.add.container(360, btnY);

    // Left cap
    const leftImg = this.add.image(-btnWidth / 2 + 16, 0, "btn-start-left").setScale(1, 1.5);
    btnContainer.add(leftImg);

    // Center (stretched)
    const centerImg = this.add.image(0, 0, "btn-start-center").setDisplaySize(btnWidth - 32, btnHeight);
    btnContainer.add(centerImg);

    // Right cap
    const rightImg = this.add.image(btnWidth / 2 - 16, 0, "btn-start-right").setScale(1, 1.5);
    btnContainer.add(rightImg);

    // Button text
    const btnText = this.add
      .text(0, 0, "开始游戏", {
        fontSize: "14px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#e2e8f0",
      })
      .setOrigin(0.5);
    btnContainer.add(btnText);

    // Make interactive
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
      // Use pressed textures
      leftImg.setTexture("btn-start-pressed-left");
      centerImg.setTexture("btn-start-pressed-center");
      rightImg.setTexture("btn-start-pressed-right");
      fx.playEffect("tint-flash", { target: btnContainer, color: "#22c55e", duration: 100 });
      this.time.delayedCall(150, () => {
        this.scene.start("PlayScene");
      });
    });

    this.startButton = btnContainer;
    this.startButtonImages = { leftImg, centerImg, rightImg };
  }

  createLevelSelect(registry, fx) {
    this.add
      .text(360, 580, "选择关卡", {
        fontSize: "16px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#94a3b8",
      })
      .setOrigin(0.5);

    // Add navigation arrows
    const arrowLeft = this.add.image(120, 660, "arrow-left").setScale(0.8);
    arrowLeft.setInteractive({ useHandCursor: true });
    arrowLeft.on("pointerdown", () => {
      fx.playEffect("tint-flash", { target: arrowLeft, color: "#22c55e", duration: 100 });
      // Could add page navigation here
    });

    const arrowRight = this.add.image(600, 660, "arrow-right").setScale(0.8);
    arrowRight.setInteractive({ useHandCursor: true });
    arrowRight.on("pointerdown", () => {
      fx.playEffect("tint-flash", { target: arrowRight, color: "#22c55e", duration: 100 });
      // Could add page navigation here
    });

    const levelY = 660;
    const levelSpacing = 100;

    LEVELS.forEach((level, index) => {
      const x = 360 - (LEVELS.length - 1) * levelSpacing / 2 + index * levelSpacing;
      const isUnlocked = state.unlockedLevels.includes(level.id);

      const levelBtn = this.add.container(x, levelY);

      const bg = this.add.graphics();
      const size = 60;

      if (isUnlocked) {
        bg.fillStyle(0x16213e, 1);
        bg.fillRoundedRect(-size / 2, -size / 2, size, size, 8);
        bg.lineStyle(2, state.level === level.id ? 0x22c55e : 0x334155);
        bg.strokeRoundedRect(-size / 2, -size / 2, size, size, 8);
      } else {
        bg.fillStyle(0x0f172a, 1);
        bg.fillRoundedRect(-size / 2, -size / 2, size, size, 8);
        bg.lineStyle(2, 0x334155);
        bg.strokeRoundedRect(-size / 2, -size / 2, size, size, 8);
      }
      levelBtn.add(bg);

      if (isUnlocked) {
        // Show level number
        const numText = this.add
          .text(0, -5, String(level.id), {
            fontSize: "20px",
            fontFamily: '"Press Start 2P", "VT323", monospace',
            color: "#e2e8f0",
          })
          .setOrigin(0.5);
        levelBtn.add(numText);

        // Show lock-open for unlocked levels (indicates available to play)
        const lockOpenImg = this.add.image(0, 15, "lock-open").setScale(0.4);
        levelBtn.add(lockOpenImg);

        // Also add flag (it will be shown behind the lock-open)
        const flagImg = this.add.image(0, 15, "flag").setScale(0.4);
        flagImg.setVisible(false); // Hide initially, could show for completed levels
        levelBtn.add(flagImg);

        levelBtn.setSize(size, size);
        levelBtn.setInteractive({ useHandCursor: true });

        levelBtn.on("pointerdown", () => {
          state.level = level.id;
          fx.playEffect("tint-flash", { target: levelBtn, color: "#22c55e", duration: 100 });
          this.scene.start("PlayScene");
        });
      } else {
        // Show lock-closed for locked levels
        const lock = this.add.image(0, 0, "lock-closed").setScale(0.5);
        levelBtn.add(lock);
      }
    });
  }

  exposeTestHooks(registry, fx) {
    window.gameTest = window.gameTest || {};
    window.gameTest.clickStartButton = () => {
      this.scene.start("PlayScene");
    };
    window.gameTest.selectLevel = (levelId) => {
      if (state.unlockedLevels.includes(levelId)) {
        state.level = levelId;
      }
    };
  }
}
