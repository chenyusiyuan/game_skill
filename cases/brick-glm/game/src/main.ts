import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import './milestone';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  width: 480,
  height: 360,
  parent: 'game',
  backgroundColor: '#1a1a2e',
  scene: [GameScene],
};

new Phaser.Game(config);
