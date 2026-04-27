// @modules: system.fsm, system.combat, system.health, system.resource
// @dependencies-verified: true
// @must-have(四周环形传送带): parametric-track with rect-loop shape
// @must-have(颜色匹配攻击): ray-cast + predicate-match + resource-consume
// @must-have(等待槽回收): slot-pool + entity-lifecycle
// @must-have(多关卡递进): level configs with increasing difficulty
// @must-have(容量管理): capacity-gate for conveyor

import { StartScene } from "./scenes/StartScene.js";
import { PlayScene } from "./scenes/PlayScene.js";
import { ResultScene } from "./scenes/ResultScene.js";

const config = {
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  backgroundColor: "#1a1a2e",
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [StartScene, PlayScene, ResultScene],
};

window.game = new Phaser.Game(config);
