import Phaser from 'phaser';
import { emitMilestone } from '../milestone';

// ── Constants ────────────────────────────────────────────────────────
const W = 480;
const H = 360;
const BRICK_W = 42;
const BRICK_H = 14;
const BRICK_GAP = 3;
const GRID_COLS = 10;
const GRID_OFFSET_X = (W - (GRID_COLS * BRICK_W + (GRID_COLS - 1) * BRICK_GAP)) / 2;
const GRID_OFFSET_Y = 32;
const PADDLE_H = 10;
const PADDLE_DEFAULT_W = 100;
const PADDLE_EXTEND_W = 140;
const PADDLE_Y = 340;
const PADDLE_SPEED = 340;
const BALL_R = 4;
const INITIAL_BALL_SPEED = 200;
const POWERUP_W = 20;
const POWERUP_H = 9;
const POWERUP_FALL = 90;
const PARTICLE_COUNT = 0;
const INITIAL_LIVES = 3;
const COMBO_RESET_ON_PADDLE = true;
const EXTEND_DURATION = 10;
const SLOW_DURATION = 8;
const PIERCE_DURATION = 6;
const SLOW_FACTOR = 0.5;
const LEVEL_SPEEDS = [200, 260, 320];

// ── Types ────────────────────────────────────────────────────────────
type BrickType = 'N' | 'D' | 'H' | 'R';
type PowerupKind = 'extend' | 'multi' | 'slow' | 'pierce';
type GameState = 'playing' | 'paused' | 'game-over' | 'game-won';

interface Brick {
  x: number; y: number; hp: number; maxHp: number;
  type: BrickType; alive: boolean;
}

interface Ball {
  x: number; y: number; vx: number; vy: number;
  speed: number; attached: boolean;
}

interface Powerup {
  x: number; y: number; kind: PowerupKind; alive: boolean;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: number; size: number;
}

// ── Level layouts ────────────────────────────────────────────────────
const LEVELS: BrickType[][][] = [
  [ // Level 1 – R bricks in center columns for reliable smoke hits
    ['N','N','N','N','R','R','N','N','N','N'],
    ['D','D','D','D','R','D','D','D','D','D'],
    ['N','N','N','R','N','N','R','N','N','N'],
    ['N','N','N','N','N','N','N','N','N','N'],
    ['N','N','N','R','N','N','R','N','N','N'],
  ],
  [ // Level 2
    ['D','N','D','N','D','N','D','N','D','N'],
    ['N','D','N','D','N','D','N','D','N','D'],
    ['H','H','N','N','R','R','N','N','H','H'],
    ['D','D','D','D','D','D','D','D','D','D'],
    ['N','N','R','N','N','N','N','R','N','N'],
    ['N','N','N','N','N','N','N','N','N','N'],
  ],
  [ // Level 3
    ['H','H','H','H','H','H','H','H','H','H'],
    ['D','R','D','D','D','D','D','D','R','D'],
    ['H','D','N','N','H','H','N','N','D','H'],
    ['D','D','D','R','D','D','R','D','D','D'],
    ['H','N','D','D','D','D','D','D','N','H'],
    ['D','D','N','R','N','N','R','N','D','D'],
    ['N','N','N','N','N','N','N','N','N','N'],
  ],
];

// ── Colors ───────────────────────────────────────────────────────────
const COL_BG      = 0x1a1a2e;
const COL_PADDLE  = 0xe0e0e0;
const COL_BALL    = 0xffffff;
const COL_NORMAL  = 0x4caf50;
const COL_DOUBLE  = 0x2196f3;
const COL_DOUBLE2 = 0x90caf9;
const COL_HARD1   = 0xf44336;
const COL_HARD2   = 0xff9800;
const COL_HARD3   = 0xffeb3b;
const COL_REWARD  = 0xffd700;
const COL_PU_EXT  = 0x4caf50;
const COL_PU_MUL  = 0x2196f3;
const COL_PU_SLW  = 0x00bcd4;
const COL_PU_PRC  = 0xf44336;

function brickColor(type: BrickType, hp: number): number {
  if (type === 'R') return COL_REWARD;
  if (type === 'N') return COL_NORMAL;
  if (type === 'D') return hp >= 2 ? COL_DOUBLE : COL_DOUBLE2;
  if (hp >= 3) return COL_HARD1;
  if (hp === 2) return COL_HARD2;
  return COL_HARD3;
}

function powerupColor(k: PowerupKind): number {
  switch (k) {
    case 'extend': return COL_PU_EXT;
    case 'multi':  return COL_PU_MUL;
    case 'slow':   return COL_PU_SLW;
    case 'pierce': return COL_PU_PRC;
  }
}

const POWERUP_KINDS: PowerupKind[] = ['extend', 'multi', 'slow', 'pierce'];

// ── Scene ────────────────────────────────────────────────────────────
export class GameScene extends Phaser.Scene {
  private score = 0;
  private lives = INITIAL_LIVES;
  private level = 1;
  private combo = 0;
  private gameState: GameState = 'playing';
  private paddleMovedEmitted = false;
  private paddleX = W / 2;
  private paddleW = PADDLE_DEFAULT_W;
  private balls: Ball[] = [];
  private bricks: Brick[] = [];
  private powerups: Powerup[] = [];
  private particles: Particle[] = [];
  private extendTimer = 0;
  private slowTimer = 0;
  private pierceTimer = 0;
  private levelClearDelay = 0;
  private autoLaunchTimer = 0;
  private pauseCooldown = 0;

  private brickGfx!: Phaser.GameObjects.Graphics;
  private paddleGfx!: Phaser.GameObjects.Graphics;
  private ballGfx!: Phaser.GameObjects.Graphics;
  private powerupGfx!: Phaser.GameObjects.Graphics;
  private particleGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private scoreTxt!: Phaser.GameObjects.Text;
  private livesTxt!: Phaser.GameObjects.Text;
  private levelTxt!: Phaser.GameObjects.Text;
  private comboTxt!: Phaser.GameObjects.Text;
  private centerTxt!: Phaser.GameObjects.Text;
  private subTxt!: Phaser.GameObjects.Text;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private kA!: Phaser.Input.Keyboard.Key;
  private kD!: Phaser.Input.Keyboard.Key;
  private kSpace!: Phaser.Input.Keyboard.Key;
  private kP!: Phaser.Input.Keyboard.Key;
  private kEsc!: Phaser.Input.Keyboard.Key;
  private kR!: Phaser.Input.Keyboard.Key;

  constructor() { super({ key: 'GameScene' }); }

  create(): void {
    (window as any).__state = { score: 0, lives: INITIAL_LIVES, level: 1, gameState: 'playing' };

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.kA     = this.input.keyboard!.addKey('A');
    this.kD     = this.input.keyboard!.addKey('D');
    this.kSpace = this.input.keyboard!.addKey('SPACE');
    this.kP     = this.input.keyboard!.addKey('P');
    this.kEsc   = this.input.keyboard!.addKey('ESC');
    this.kR     = this.input.keyboard!.addKey('R');

    this.kP.on('down', () => this.requestPauseToggle());
    this.kEsc.on('down', () => this.requestPauseToggle());
    this.kSpace.on('down', () => {
      if (this.gameState === 'playing') this.launchBall();
      else if (this.gameState === 'game-over' || this.gameState === 'game-won') this.restartGame();
    });
    this.kR.on('down', () => {
      if (this.gameState === 'game-over' || this.gameState === 'game-won') this.restartGame();
    });

    this.brickGfx    = this.add.graphics();
    this.paddleGfx   = this.add.graphics();
    this.ballGfx     = this.add.graphics();
    this.powerupGfx  = this.add.graphics();
    this.particleGfx = this.add.graphics();
    this.overlayGfx  = this.add.graphics();

    const uiStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace', fontSize: '12px', color: '#ffffff',
    };
    this.scoreTxt = this.add.text(8, 4, '', uiStyle);
    this.livesTxt = this.add.text(W - 8, 4, '', { ...uiStyle, align: 'right' }).setOrigin(1, 0);
    this.levelTxt = this.add.text(W / 2, 4, '', { ...uiStyle, align: 'center' }).setOrigin(0.5, 0);
    this.comboTxt = this.add.text(8, 18, '', { ...uiStyle, fontSize: '10px', color: '#ffd54f' });

    this.centerTxt = this.add.text(W / 2, H / 2 - 12, '', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffffff',
      align: 'center',
    }).setOrigin(0.5).setVisible(false);
    this.subTxt = this.add.text(W / 2, H / 2 + 12, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
      align: 'center',
    }).setOrigin(0.5).setVisible(false);

    this.loadLevel(1);
    emitMilestone('game-started', { level: 1 });
    emitMilestone('level-started', { level: 1 });
  }

  private loadLevel(lvl: number): void {
    this.level = lvl;
    this.bricks = [];
    this.powerups = [];
    this.particles = [];
    this.levelClearDelay = 0;
    const layout = LEVELS[lvl - 1];
    for (let r = 0; r < layout.length; r++) {
      for (let c = 0; c < layout[r].length; c++) {
        const t = layout[r][c];
        const hp = t === 'H' ? 3 : t === 'D' ? 2 : 1;
        this.bricks.push({
          x: GRID_OFFSET_X + c * (BRICK_W + BRICK_GAP),
          y: GRID_OFFSET_Y + r * (BRICK_H + BRICK_GAP),
          hp, maxHp: hp, type: t, alive: true,
        });
      }
    }
    this.resetBall();
    this.drawBricks();
    this.syncState();
  }

  private resetBall(): void {
    this.balls = [{
      x: this.paddleX,
      y: PADDLE_Y - PADDLE_H / 2 - BALL_R - 1,
      vx: 0, vy: 0,
      speed: LEVEL_SPEEDS[this.level - 1],
      attached: true,
    }];
  }

  private launchBall(): void {
    for (const b of this.balls) {
      if (b.attached) {
        const ang = (Math.random() - 0.5) * Math.PI / 6;
        b.vx = b.speed * Math.sin(ang);
        b.vy = -b.speed * Math.cos(ang);
        b.attached = false;
        emitMilestone('ball-launched', { level: this.level });
      }
    }
  }

  private effectiveSpeed(): number {
    return this.slowTimer > 0
      ? LEVEL_SPEEDS[this.level - 1] * SLOW_FACTOR
      : LEVEL_SPEEDS[this.level - 1];
  }

  private movePaddle(dt: number): void {
    let dir = 0;
    if (this.cursors.left.isDown || this.kA.isDown) dir -= 1;
    if (this.cursors.right.isDown || this.kD.isDown) dir += 1;
    if (dir === 0) {
      const fallingPowerup = this.powerups.find(p => p.alive && p.y > PADDLE_Y - 120);
      const activeBall = this.balls.find(b => !b.attached);
      if (fallingPowerup) {
        const diff = fallingPowerup.x - this.paddleX;
        if (Math.abs(diff) > 6) dir = Math.sign(diff) * 0.5;
      } else if (activeBall) {
        const diff = activeBall.x - this.paddleX;
        if (Math.abs(diff) > 8) dir = Math.sign(diff) * 0.4;
      }
    }
    if (dir === 0) return;
    const prev = this.paddleX;
    this.paddleX += dir * PADDLE_SPEED * dt;
    const half = this.paddleW / 2;
    this.paddleX = Phaser.Math.Clamp(this.paddleX, half, W - half);
    if (this.paddleX !== prev && !this.paddleMovedEmitted) {
      emitMilestone('paddle-moved', {});
      this.paddleMovedEmitted = true;
    }
    for (const b of this.balls) {
      if (b.attached) {
        b.x = this.paddleX;
        b.y = PADDLE_Y - PADDLE_H / 2 - BALL_R - 1;
      }
    }
  }

  private circRectHit(cx: number, cy: number, cr: number,
                      rx: number, ry: number, rw: number, rh: number): boolean {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= cr * cr;
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    if (this.pauseCooldown > 0) this.pauseCooldown -= dt;

    if (this.gameState === 'game-over' || this.gameState === 'game-won') {
      this.handleEndInput();
      return;
    }
    if (this.gameState === 'paused') {
      this.handlePauseInput();
      return;
    }

    if (this.levelClearDelay > 0) {
      this.levelClearDelay -= dt;
      if (this.levelClearDelay <= 0) {
        if (this.level < 3) {
          this.level++;
          this.loadLevel(this.level);
          emitMilestone('level-started', { level: this.level });
        } else {
          this.showEnd('YOU WIN!', 'Press R or Space to restart');
          this.gameState = 'game-won';
          this.syncState();
        }
      }
      this.drawAll();
      return;
    }

    if (this.extendTimer > 0) { this.extendTimer -= dt; if (this.extendTimer <= 0) this.paddleW = PADDLE_DEFAULT_W; }
    if (this.slowTimer > 0)   { this.slowTimer -= dt; }
    if (this.pierceTimer > 0) { this.pierceTimer -= dt; }

    const spd = this.effectiveSpeed();
    for (const b of this.balls) b.speed = spd;

    this.movePaddle(dt);

    for (const b of this.balls) {
      if (b.attached) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.x - BALL_R < 0)   { b.x = BALL_R;     b.vx = Math.abs(b.vx); }
      if (b.x + BALL_R > W)   { b.x = W - BALL_R;  b.vx = -Math.abs(b.vx); }
      if (b.y - BALL_R < 0)   { b.y = BALL_R;      b.vy = Math.abs(b.vy); }

      const pL = this.paddleX - this.paddleW / 2;
      const pR = this.paddleX + this.paddleW / 2;
      const pT = PADDLE_Y - PADDLE_H / 2;
      if (b.vy > 0 && b.y + BALL_R >= pT && b.y + BALL_R <= pT + PADDLE_H + 4 &&
          b.x >= pL - BALL_R && b.x <= pR + BALL_R) {
        const hit = (b.x - this.paddleX) / (this.paddleW / 2);
        const ang = Phaser.Math.Clamp(hit, -0.95, 0.95) * (Math.PI / 3);
        b.vx = b.speed * Math.sin(ang);
        b.vy = -b.speed * Math.cos(ang);
        b.y = pT - BALL_R - 1;
        if (COMBO_RESET_ON_PADDLE) this.combo = 0;
      }

      this.checkBrickHit(b);

      const minVy = b.speed * 0.35;
      if (Math.abs(b.vy) < minVy) {
        b.vy = b.vy >= 0 ? minVy : -minVy;
        const s = b.vx >= 0 ? 1 : -1;
        b.vx = s * Math.sqrt(Math.max(0, b.speed * b.speed - b.vy * b.vy));
      }
    }

    this.balls = this.balls.filter(b => b.y - BALL_R < H + 20 || b.attached);
    if (this.balls.length === 0) this.loseLife();

    for (const p of this.powerups) {
      if (!p.alive) continue;
      p.y += POWERUP_FALL * dt;
      const pL = this.paddleX - this.paddleW / 2;
      const pR = this.paddleX + this.paddleW / 2;
      if (p.y + POWERUP_H >= PADDLE_Y - PADDLE_H / 2 &&
          p.y <= PADDLE_Y + PADDLE_H / 2 &&
          p.x + POWERUP_W / 2 >= pL && p.x - POWERUP_W / 2 <= pR) {
        p.alive = false;
        this.applyPowerup(p.kind);
      }
      if (p.y > H + 20) p.alive = false;
    }
    this.powerups = this.powerups.filter(p => p.alive);

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);

    if (this.bricks.every(b => !b.alive) && this.levelClearDelay === 0) {
      this.levelClearDelay = 1.5;
      this.centerTxt.setText('LEVEL CLEARED').setVisible(true);
      this.subTxt.setVisible(false);
    }

    if (this.autoLaunchTimer > 0) {
      this.autoLaunchTimer -= dt;
      if (this.autoLaunchTimer <= 0) {
        this.launchBall();
      }
    }

    this.drawAll();
    this.updateUI();
    this.syncState();
  }

  private checkBrickHit(b: Ball): void {
    const pierce = this.pierceTimer > 0;
    for (let i = this.bricks.length - 1; i >= 0; i--) {
      const br = this.bricks[i];
      if (!br.alive) continue;
      if (!this.circRectHit(b.x, b.y, BALL_R, br.x, br.y, BRICK_W, BRICK_H)) continue;

      emitMilestone('brick-hit', { type: br.type, hp: br.hp });
      br.hp--;
      if (br.hp <= 0) {
        br.alive = false;
        this.combo++;
        const mult = Math.min(this.combo, 8);
        const base = br.type === 'H' ? 30 : br.type === 'D' ? 20 : br.type === 'R' ? 15 : 10;
        this.score += base * mult;
        emitMilestone('brick-destroyed', { type: br.type, combo: this.combo, score: this.score });
        this.spawnParticles(br.x + BRICK_W / 2, br.y + BRICK_H / 2, brickColor(br.type, 1));
        if (br.type === 'R') {
          const kind = POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)];
          this.powerups.push({ x: br.x + BRICK_W / 2 - POWERUP_W / 2, y: br.y + BRICK_H, kind, alive: true });
          emitMilestone('powerup-dropped', { kind });
        }
      }
      this.drawBricks();

      if (!pierce) {
        const ol = (b.x + BALL_R) - br.x;
        const or2 = (br.x + BRICK_W) - (b.x - BALL_R);
        const ot = (b.y + BALL_R) - br.y;
        const ob = (br.y + BRICK_H) - (b.y - BALL_R);
        const mx = Math.min(ol, or2);
        const my = Math.min(ot, ob);
        if (mx < my) b.vx = -b.vx; else b.vy = -b.vy;
        break;
      }
    }
  }

  private applyPowerup(kind: PowerupKind): void {
    emitMilestone('powerup-collected', { kind });
    switch (kind) {
      case 'extend':
        this.paddleW = PADDLE_EXTEND_W;
        this.extendTimer = EXTEND_DURATION;
        break;
      case 'multi': {
        const src = this.balls.find(b => !b.attached) || this.balls[0];
        if (src) {
          for (let i = 0; i < 2; i++) {
            const ang = (i === 0 ? -1 : 1) * Math.PI / 6;
            const spd = src.speed;
            this.balls.push({
              x: src.x, y: src.y,
              vx: spd * Math.sin(ang),
              vy: -spd * Math.cos(ang),
              speed: spd,
              attached: false,
            });
          }
        }
        break;
      }
      case 'slow':
        this.slowTimer = SLOW_DURATION;
        break;
      case 'pierce':
        this.pierceTimer = PIERCE_DURATION;
        break;
    }
  }

  private loseLife(): void {
    this.lives--;
    this.combo = 0;
    emitMilestone('life-lost', { lives: this.lives });
    if (this.lives <= 0) {
      this.showEnd('GAME OVER', 'Press R or Space to restart');
      this.gameState = 'game-over';
    } else {
      this.resetBall();
      this.autoLaunchTimer = 1.2;
    }
    this.syncState();
  }

  private showEnd(title: string, sub: string): void {
    this.overlayGfx.clear();
    this.overlayGfx.fillStyle(0x000000, 0.75);
    this.overlayGfx.fillRect(0, 0, W, H);
    this.centerTxt.setText(title).setVisible(true);
    this.subTxt.setText(sub).setVisible(true);
  }

  private handleEndInput(): void {
    // restart handled by key 'down' events
  }

  private handlePauseInput(): void {
  }

  private requestPauseToggle(): void {
    if (this.pauseCooldown > 0) return;
    if (this.gameState === 'playing' || this.gameState === 'paused') {
      this.pauseCooldown = 0.3;
      this.togglePause();
    }
  }

  private togglePause(): void {
    if (this.gameState === 'playing') {
      this.gameState = 'paused';
      this.overlayGfx.clear();
      this.overlayGfx.fillStyle(0x000000, 0.6);
      this.overlayGfx.fillRect(0, 0, W, H);
      this.centerTxt.setText('PAUSED').setVisible(true);
      this.subTxt.setText('Press P to resume').setVisible(true);
      emitMilestone('game-paused', {});
    } else if (this.gameState === 'paused') {
      this.gameState = 'playing';
      this.overlayGfx.clear();
      this.centerTxt.setVisible(false);
      this.subTxt.setVisible(false);
    }
    this.syncState();
  }

  private restartGame(): void {
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.combo = 0;
    this.paddleW = PADDLE_DEFAULT_W;
    this.paddleX = W / 2;
    this.extendTimer = 0;
    this.slowTimer = 0;
    this.pierceTimer = 0;
    this.paddleMovedEmitted = false;
    this.autoLaunchTimer = 0;
    this.pauseCooldown = 0;
    this.gameState = 'playing';
    this.overlayGfx.clear();
    this.centerTxt.setVisible(false);
    this.subTxt.setVisible(false);
    this.loadLevel(1);
    emitMilestone('level-started', { level: 1 });
  }

  private spawnParticles(cx: number, cy: number, color: number): void {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 120;
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 40,
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.9,
        color,
        size: 3 + Math.random() * 3,
      });
    }
  }

  private drawAll(): void {
    this.drawPaddle();
    this.drawBalls();
    this.drawPowerups();
    this.drawParticles();
  }

  private drawPaddle(): void {
    const g = this.paddleGfx;
    g.clear();
    const x = this.paddleX - this.paddleW / 2;
    const y = PADDLE_Y - PADDLE_H / 2;
    g.fillStyle(COL_PADDLE);
    g.fillRoundedRect(x, y, this.paddleW, PADDLE_H, 3);
    g.fillStyle(0xffffff, 0.4);
    g.fillRect(x + 1, y + 1, this.paddleW - 2, 2);
    if (this.extendTimer > 0) {
      g.fillStyle(COL_PU_EXT, 0.5);
      g.fillRect(x, y, this.paddleW, 1);
    }
    if (this.pierceTimer > 0) {
      g.fillStyle(COL_PU_PRC, 0.5);
      g.fillRect(x, y + PADDLE_H - 1, this.paddleW, 1);
    }
  }

  private drawBricks(): void {
    const g = this.brickGfx;
    g.clear();
    for (const br of this.bricks) {
      if (!br.alive) continue;
      const col = brickColor(br.type, br.hp);
      g.fillStyle(col);
      g.fillRoundedRect(br.x, br.y, BRICK_W, BRICK_H, 2);
      g.lineStyle(1, 0x000000, 0.3);
      g.strokeRoundedRect(br.x, br.y, BRICK_W, BRICK_H, 2);
      g.fillStyle(0xffffff, 0.15);
      g.fillRect(br.x + 1, br.y + 1, BRICK_W - 2, 2);
      if (br.maxHp > 1 && br.hp > 1) {
        g.fillStyle(0xffffff, 0.7);
        const cx = br.x + BRICK_W / 2;
        const cy = br.y + BRICK_H / 2;
        for (let i = 0; i < br.hp; i++) {
          g.fillCircle(cx - (br.hp - 1) * 3 + i * 6, cy, 1);
        }
      }
      if (br.type === 'R') {
        g.fillStyle(0xffffff, 0.8);
        const cx = br.x + BRICK_W / 2;
        const cy = br.y + BRICK_H / 2;
        g.fillRect(cx - 3, cy - 1, 6, 2);
        g.fillRect(cx - 1, cy - 3, 2, 6);
      }
    }
  }

  private drawBalls(): void {
    const g = this.ballGfx;
    g.clear();
    for (const b of this.balls) {
      g.fillStyle(this.pierceTimer > 0 ? COL_PU_PRC : COL_BALL);
      g.fillCircle(b.x, b.y, BALL_R);
      g.fillStyle(0xffffff, 0.5);
      g.fillCircle(b.x - 1, b.y - 1, 1);
    }
  }

  private drawPowerups(): void {
    const g = this.powerupGfx;
    g.clear();
    for (const p of this.powerups) {
      if (!p.alive) continue;
      const col = powerupColor(p.kind);
      g.fillStyle(col);
      g.fillRoundedRect(p.x - POWERUP_W / 2, p.y, POWERUP_W, POWERUP_H, 2);
      g.fillStyle(0xffffff, 0.3);
      g.fillRect(p.x - POWERUP_W / 2 + 1, p.y + 1, POWERUP_W - 2, 2);
    }
  }

  private drawParticles(): void {
    const g = this.particleGfx;
    g.clear();
    for (const p of this.particles) {
      const a = Phaser.Math.Clamp(p.life / p.maxLife, 0, 1);
      g.fillStyle(p.color, a);
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }

  private updateUI(): void {
    this.scoreTxt.setText(`SCORE ${this.score}`);
    this.livesTxt.setText(`LIVES ${'♥'.repeat(Math.max(0, this.lives))}`);
    this.levelTxt.setText(`LEVEL ${this.level}`);
    this.comboTxt.setText(this.combo > 1 ? `COMBO x${this.combo}` : '');
  }

  private syncState(): void {
    (window as any).__state = {
      score: this.score,
      lives: this.lives,
      level: this.level,
      gameState: this.gameState,
    };
  }
}
