// current main entry placeholder. Worker should overwrite this file with real Phaser game code.
//
// Recommended Phaser config when overwriting:
//   const config: Phaser.Types.Core.GameConfig = {
//     type: Phaser.CANVAS, width: 800, height: 600,
//     scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
//     scene: [/* your scene */],
//   };
//
// Recommended liveness pattern (also in SKILL.md Phase B):
//   class PlayScene extends Phaser.Scene {
//     update(_time: number, delta: number) {
//       this.patience -= delta / 1000; // delta-based countdown
//       enemy.x += enemy.speed * delta / 1000; // delta-based movement
//     }
//   }
import Phaser from "phaser";
import './milestone';
console.log('[milestone]', JSON.stringify({ id: 'placeholder-main', kind: 'placeholder' }));
void Phaser;
