import Phaser from "phaser";
import { emitMilestone } from "../milestone";

type KeySprite = Phaser.GameObjects.Rectangle & { collected?: boolean };

export class PlayScene extends Phaser.Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private space!: Phaser.Input.Keyboard.Key;
  private player!: Phaser.GameObjects.Rectangle;
  private keys: KeySprite[] = [];
  private door!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private collectedKeys = 0;
  private doorUnlocked = false;
  private won = false;
  private velocityY = 0;
  private readonly groundY = 270;

  constructor() {
    super("PlayScene");
  }

  create(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.space = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.add.rectangle(320, 180, 640, 360, 0x101820);
    this.add.rectangle(320, 304, 620, 28, 0x3a7d44);
    this.add.rectangle(230, 248, 96, 14, 0x6ab04c);
    this.add.rectangle(372, 222, 96, 14, 0x6ab04c);
    this.add.text(18, 18, "Arrow keys move  |  Space jumps  |  collect 2 keys", {
      fontFamily: "Arial",
      fontSize: "16px",
      color: "#f7f1e3",
    });

    this.keys = [
      this.add.rectangle(182, 258, 18, 28, 0xffd166),
      this.add.rectangle(330, 258, 18, 28, 0xffd166),
    ] as KeySprite[];
    for (const key of this.keys) {
      key.setStrokeStyle(2, 0xf6e58d);
    }

    this.door = this.add.rectangle(552, 248, 34, 78, 0x7f8fa6);
    this.door.setStrokeStyle(3, 0xd63031);
    this.player = this.add.rectangle(58, this.groundY, 28, 36, 0x4d96ff);
    this.player.setStrokeStyle(2, 0xdff9fb);
    this.statusText = this.add.text(18, 324, "", {
      fontFamily: "Arial",
      fontSize: "15px",
      color: "#ffffff",
    });

    this.syncState();
    this.redrawHud();
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    if (!this.won) this.movePlayer(dt);
    this.applyJump(dt);
    this.collectKeys();
    this.updateDoor();
    this.checkWin();
    if (this.won) this.player.rotation += dt * 3;
    this.syncState();
    this.redrawHud();
  }

  private movePlayer(dt: number): void {
    const speed = 170;
    if (this.cursors.left?.isDown) {
      this.player.x = Math.max(40, this.player.x - speed * dt);
    }
    if (this.cursors.right?.isDown) {
      this.player.x = Math.min(586, this.player.x + speed * dt);
    }
  }

  private applyJump(dt: number): void {
    const grounded = this.player.y >= this.groundY - 0.5;
    if (Phaser.Input.Keyboard.JustDown(this.space) && grounded && !this.won) {
      this.velocityY = -330;
    }
    this.velocityY += 900 * dt;
    this.player.y += this.velocityY * dt;
    if (this.player.y >= this.groundY) {
      this.player.y = this.groundY;
      this.velocityY = 0;
    }
  }

  private collectKeys(): void {
    for (const key of this.keys) {
      if (key.collected) continue;
      if (Math.abs(this.player.x - key.x) < 28 && Math.abs(this.player.y - key.y) < 48) {
        key.collected = true;
        key.setVisible(false);
        this.collectedKeys += 1;
        emitMilestone("key-collected", { keys: this.collectedKeys });
      }
    }
  }

  private updateDoor(): void {
    if (this.doorUnlocked || this.collectedKeys < 2) return;
    this.doorUnlocked = true;
    this.door.setFillStyle(0x2ecc71);
    this.door.setStrokeStyle(3, 0xb8e994);
    emitMilestone("door-unlocked", { keys: this.collectedKeys });
  }

  private checkWin(): void {
    if (this.won || !this.doorUnlocked || this.player.x < 520) return;
    this.won = true;
    this.player.setFillStyle(0xfff200);
    this.add.text(236, 142, "EXIT CLEAR", {
      fontFamily: "Arial",
      fontSize: "34px",
      color: "#ffffff",
      backgroundColor: "#2ecc71",
      padding: { x: 12, y: 8 },
    });
    emitMilestone("primary-win", { keys: this.collectedKeys, playerX: Math.round(this.player.x) });
  }

  private redrawHud(): void {
    const door = this.doorUnlocked ? "open" : "locked";
    const outcome = this.won ? " | victory" : "";
    this.statusText.setText(`keys: ${this.collectedKeys}/2 | door: ${door}${outcome}`);
  }

  private syncState(): void {
    window.__state = {
      keys: this.collectedKeys,
      doorUnlocked: this.doorUnlocked,
      won: this.won,
      playerX: Math.round(this.player.x),
      playerY: Math.round(this.player.y),
    };
  }
}
