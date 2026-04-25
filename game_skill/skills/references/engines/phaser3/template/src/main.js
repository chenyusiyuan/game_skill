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
