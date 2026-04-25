import { state } from "../state.js";

export class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
  }

  preload() {
    // === 素材加载（对照 specs/assets.yaml 中的 local-file 条目） ===
    // 路径前缀：游戏代码在 cases/{project}/game/ 下，素材在项目根的 assets/library_2d/ 下
    // 需要回退 3 级：../../../assets/library_2d/...
    //
    // 示例（根据 assets.yaml 替换为实际素材路径）：
    // const BASE = "../../../assets/library_2d";
    // this.load.image("floor", `${BASE}/tiles/dungeon/tile_0000.png`);
    // this.load.spritesheet("player", `${BASE}/tiles/dungeon/tile_0097.png`, { frameWidth: 16, frameHeight: 16 });
    // this.load.audio("hit", `${BASE}/audio/sfx/hit.wav`);
    //
    // ⚠️ 如果 assets.yaml 有 local-file 素材，此处必须加载，禁止全部用程序化绘制替代
  }

  create() {
    state.phase = "playing";
    state.scene = "MainScene";

    this.add.text(20, 20, "Phaser 3 Template", {
      fontSize: "28px",
      color: "#f8fafc",
      fontFamily: "system-ui, sans-serif",
    });

    this.scoreText = this.add.text(20, 60, "Score: 0", {
      fontSize: "20px",
      color: "#fbbf24",
      fontFamily: "system-ui, sans-serif",
    });

    this.add.text(400, 300, "click anywhere", {
      fontSize: "16px",
      color: "#94a3b8",
      fontFamily: "system-ui, sans-serif",
    }).setOrigin(0.5);

    this.input.on("pointerdown", () => {
      state.score += 1;
      this.scoreText.setText(`Score: ${state.score}`);
    });
  }

  update() {
    // Per-frame logic.
  }
}
