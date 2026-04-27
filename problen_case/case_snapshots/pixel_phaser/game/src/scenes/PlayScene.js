// @primitive(grid-board@v1): node-id=board
// @primitive(parametric-track@v1): node-id=conveyor-track
// @primitive(ray-cast@v1): node-id=attack-raycast
// @primitive(predicate-match@v1): node-id=color-match
// @primitive(resource-consume@v1): node-id=attack-consume
// @primitive(slot-pool@v1): node-id=waiting-pool-manager
// @primitive(capacity-gate@v1): node-id=conveyor-capacity
// @primitive(entity-lifecycle@v1): node-id=pig-lifecycle
// @primitive(win-lose-check@v1): node-id=end-check
// @primitive(score-accum@v1): node-id=scoring

import {
  state,
  LEVELS,
  COLOR_PALETTE,
  COLOR_HEX,
} from "../state.js";
import { preloadRegistryAssets, createRegistry } from "../adapters/phaser-registry.js";
import { createFx } from "../adapters/phaser-fx.js";
import manifest from "../assets.manifest.json" with { type: "json" };

// ===== Constants =====
const LAYOUT = {
  BOARD_OFFSET_X: 120,
  BOARD_OFFSET_Y: 280,
  CELL_SIZE: 64,
  CONVEYOR_MARGIN: 24,
  SLOT_SIZE: 56,
  SLOT_SPACING: 64,
  SLOT_Y: 1080,
};

const TIMING = {
  CONVEYOR_SPEED: 0.08, // t per second (12.5s for one loop)
  ATTACK_DELAY: 100,
  RECYCLE_DELAY: 200,
};

export class PlayScene extends Phaser.Scene {
  constructor() {
    super("PlayScene");
  }

  init() {
    // Reset processing locks on scene init
    this.isProcessing = false;
    this.attackLock = false;
    this.recycleLock = false;
    this.registry = null;
    this.fx = null;
    this.pigSprites = new Map();
    this.blockSprites = new Map();
    this.conveyorPath = [];
  }

  preload() {
    preloadRegistryAssets(manifest, { scene: this });
  }

  create() {
    this.registry = createRegistry(manifest, { scene: this });
    this.fx = createFx({ scene: this });

    state.currentScene = "play";
    state.phase = "playing";
    state.scene = "PlayScene";

    // Initialize level
    this.initLevel(state.level);

    // Render static elements
    this.renderBackground();
    this.renderBoard();
    this.renderConveyorTrack();
    this.renderWaitingSlots();
    this.renderHUD();

    // Initialize trace
    window.__trace = window.__trace || [];

    // Expose test hooks
    this.exposeTestHooks();
  }

  // ===== Level Initialization =====
  initLevel(levelId) {
    const level = LEVELS.find((l) => l.id === levelId);
    if (!level) return;

    const before = { level: state.level, phase: state.phase };
    state.level = levelId;
    state.score = 0;
    state.phase = "playing";
    state.gameOver = false;
    state.timeElapsed = 0;
    state.conveyorPigs = [];
    state.waitingSlots = [null, null, null, null, null];
    state.blocks = [];
    state.pigs = [];
    state.totalAttacks = 0;
    state.successfulAttacks = 0;

    // Grid dimensions
    state.gridWidth = level.gridSize[0];
    state.gridHeight = level.gridSize[1];

    // Generate blocks
    this.generateBlocks(level);

    // Generate pigs
    this.generatePigs(level);

    window.__trace.push({ rule: "level-init", before, after: { level: state.level }, t: Date.now() });
  }

  generateBlocks(level) {
    const { gridSize, blockCount, colorSet, reinforcedBlocks, reinforcedHp } = level;
    const totalCells = gridSize[0] * gridSize[1];

    // Randomly select positions for blocks
    const positions = [];
    for (let r = 0; r < gridSize[0]; r++) {
      for (let c = 0; c < gridSize[1]; c++) {
        positions.push({ row: r, col: c });
      }
    }
    // Shuffle and take blockCount
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    const selectedPositions = positions.slice(0, blockCount);

    // Assign colors evenly
    const colors = [];
    for (let i = 0; i < blockCount; i++) {
      colors.push(colorSet[i % colorSet.length]);
    }

    // Create blocks
    state.blocks = selectedPositions.map((pos, i) => ({
      id: `block-${i}`,
      color: colors[i],
      hp: i < reinforcedBlocks ? (Array.isArray(reinforcedHp) ? reinforcedHp[i] || 2 : reinforcedHp) : 1,
      row: pos.row,
      col: pos.col,
      alive: true,
    }));
  }

  generatePigs(level) {
    const { pigCount, colorSet, pigDistribution, pigAmmoRange } = level;

    const pigs = [];
    let pigId = 0;
    for (const color of colorSet) {
      const count = pigDistribution[color] || 0;
      for (let i = 0; i < count; i++) {
        const ammo = pigAmmoRange[0] + Math.floor(Math.random() * (pigAmmoRange[1] - pigAmmoRange[0] + 1));
        pigs.push({
          id: `pig-${pigId++}`,
          color,
          ammo,
          lifecycle: "waiting",
          t: 0,
          speed: TIMING.CONVEYOR_SPEED,
          segmentId: null,
          gridPosition: { row: -1, col: -1 },
          alive: true,
        });
      }
    }

    state.pigs = pigs;

    // Place first 5 pigs in waiting slots
    for (let i = 0; i < Math.min(5, pigs.length); i++) {
      state.waitingSlots[i] = pigs[i].id;
    }
  }

  // ===== Rendering =====
  renderBackground() {
    this.add.rectangle(360, 640, 720, 1280, 0x1a1a2e);
  }

  renderBoard() {
    const { gridWidth, gridHeight, blocks } = state;
    const cellSize = LAYOUT.CELL_SIZE;
    const offsetX = LAYOUT.BOARD_OFFSET_X;
    const offsetY = LAYOUT.BOARD_OFFSET_Y;

    // Board background
    const boardWidth = gridWidth * cellSize;
    const boardHeight = gridHeight * cellSize;
    this.add.rectangle(
      offsetX + boardWidth / 2,
      offsetY + boardHeight / 2,
      boardWidth + 8,
      boardHeight + 8,
      0x16213e
    );

    // Grid lines
    const gridGraphics = this.add.graphics();
    gridGraphics.lineStyle(1, 0x334155);
    for (let r = 0; r <= gridHeight; r++) {
      gridGraphics.moveTo(offsetX, offsetY + r * cellSize);
      gridGraphics.lineTo(offsetX + boardWidth, offsetY + r * cellSize);
    }
    for (let c = 0; c <= gridWidth; c++) {
      gridGraphics.moveTo(offsetX + c * cellSize, offsetY);
      gridGraphics.lineTo(offsetX + c * cellSize, offsetY + boardHeight);
    }

    // Render blocks
    for (const block of blocks) {
      this.renderBlock(block);
    }
  }

  // @asset('block-target'): graphics-generated color-block, rendered procedurally
  renderBlock(block) {
    if (!block.alive) return;

    const cellSize = LAYOUT.CELL_SIZE;
    const x = LAYOUT.BOARD_OFFSET_X + block.col * cellSize + cellSize / 2;
    const y = LAYOUT.BOARD_OFFSET_Y + block.row * cellSize + cellSize / 2;

    const color = COLOR_PALETTE[block.color] || 0xef4444;

    // Draw block as colored rectangle ('block-target': graphics-generated)
    const blockContainer = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-cellSize / 2 + 4, -cellSize / 2 + 4, cellSize - 8, cellSize - 8, 4);
    bg.lineStyle(2, 0x000000, 1);
    bg.strokeRoundedRect(-cellSize / 2 + 4, -cellSize / 2 + 4, cellSize - 8, cellSize - 8, 4);
    blockContainer.add(bg);

    // HP indicator for reinforced blocks
    if (block.hp > 1) {
      const hpText = this.add
        .text(cellSize / 2 - 12, -cellSize / 2 + 12, String(block.hp), {
          fontSize: "14px",
          fontFamily: '"Press Start 2P", "VT323", monospace',
          color: "#ffffff",
        })
        .setOrigin(0.5);
      blockContainer.add(hpText);
    }

    this.blockSprites.set(block.id, blockContainer);
  }

  renderConveyorTrack() {
    // @hard-rule(core-mechanics): 四周环形传送带，使用 rect-loop 而非圆形
    const { gridWidth, gridHeight } = state;
    const cellSize = LAYOUT.CELL_SIZE;
    const margin = LAYOUT.CONVEYOR_MARGIN;

    const boardWidth = gridWidth * cellSize;
    const boardHeight = gridHeight * cellSize;
    const trackLeft = LAYOUT.BOARD_OFFSET_X - margin;
    const trackTop = LAYOUT.BOARD_OFFSET_Y - margin;
    const trackRight = LAYOUT.BOARD_OFFSET_X + boardWidth + margin;
    const trackBottom = LAYOUT.BOARD_OFFSET_Y + boardHeight + margin;

    // Draw rect-loop track (four straight edges, not a circle)
    const trackGraphics = this.add.graphics();
    trackGraphics.lineStyle(3, 0xfacc15, 0.6);

    // Top edge
    trackGraphics.moveTo(trackLeft, trackTop);
    trackGraphics.lineTo(trackRight, trackTop);
    // Right edge
    trackGraphics.moveTo(trackRight, trackTop);
    trackGraphics.lineTo(trackRight, trackBottom);
    // Bottom edge
    trackGraphics.moveTo(trackRight, trackBottom);
    trackGraphics.lineTo(trackLeft, trackBottom);
    // Left edge
    trackGraphics.moveTo(trackLeft, trackBottom);
    trackGraphics.lineTo(trackLeft, trackTop);

    // Store track bounds for pig movement
    this.trackBounds = {
      left: trackLeft,
      top: trackTop,
      right: trackRight,
      bottom: trackBottom,
      width: trackRight - trackLeft,
      height: trackBottom - trackTop,
    };

    // Calculate perimeter for t parameterization
    const perimeter = 2 * this.trackBounds.width + 2 * this.trackBounds.height;
    this.trackPerimeter = perimeter;

    // Segment boundaries (normalized t values)
    this.segments = {
      top: { start: 0, end: this.trackBounds.width / perimeter },
      right: {
        start: this.trackBounds.width / perimeter,
        end: (this.trackBounds.width + this.trackBounds.height) / perimeter,
      },
      bottom: {
        start: (this.trackBounds.width + this.trackBounds.height) / perimeter,
        end: (2 * this.trackBounds.width + this.trackBounds.height) / perimeter,
      },
      left: {
        start: (2 * this.trackBounds.width + this.trackBounds.height) / perimeter,
        end: 1,
      },
    };
  }

  renderWaitingSlots() {
    const slotWidth = LAYOUT.SLOT_SIZE;
    const slotSpacing = LAYOUT.SLOT_SPACING;
    const startX = 360 - (2 * slotSpacing);

    // Slot background panel using dark panel textures from manifest
    // panel-dark-top-left, panel-dark-top, panel-dark-top-right, etc.
    const panelY = LAYOUT.SLOT_Y;
    const panelWidth = 5 * slotSpacing + slotWidth;
    const panelHeight = slotWidth + 16;
    const panelX = 360 - panelWidth / 2;
    const panelTopY = panelY - slotWidth / 2 - 8;

    // Draw panel border using dark panel textures
    const tileSize = 16;

    // Corners
    this.add.image(panelX + tileSize, panelTopY + tileSize, "panel-dark-top-left").setOrigin(1);
    this.add.image(panelX + panelWidth - tileSize, panelTopY + tileSize, "panel-dark-top-right").setOrigin(0, 1);
    this.add.image(panelX + tileSize, panelTopY + panelHeight - tileSize, "panel-dark-bottom-left").setOrigin(1, 0);
    this.add.image(panelX + panelWidth - tileSize, panelTopY + panelHeight - tileSize, "panel-dark-bottom-right").setOrigin(0);

    // Edges (stretched)
    const topEdge = this.add.image(panelX + tileSize, panelTopY, "panel-dark-top");
    topEdge.setOrigin(0, 0);
    topEdge.setDisplaySize(panelWidth - 2 * tileSize, tileSize);

    const bottomEdge = this.add.image(panelX + tileSize, panelTopY + panelHeight - tileSize, "panel-dark-bottom");
    bottomEdge.setOrigin(0, 0);
    bottomEdge.setDisplaySize(panelWidth - 2 * tileSize, tileSize);

    const leftEdge = this.add.image(panelX, panelTopY + tileSize, "panel-dark-left");
    leftEdge.setOrigin(0, 0);
    leftEdge.setDisplaySize(tileSize, panelHeight - 2 * tileSize);

    const rightEdge = this.add.image(panelX + panelWidth - tileSize, panelTopY + tileSize, "panel-dark-right");
    rightEdge.setOrigin(0, 0);
    rightEdge.setDisplaySize(tileSize, panelHeight - 2 * tileSize);

    // Center fill
    const centerFill = this.add.image(panelX + tileSize, panelTopY + tileSize, "panel-dark-center");
    centerFill.setOrigin(0, 0);
    centerFill.setDisplaySize(panelWidth - 2 * tileSize, panelHeight - 2 * tileSize);

    // Render each slot background
    for (let i = 0; i < 5; i++) {
      const x = startX + i * slotSpacing;
      const slotBg = this.add.graphics();
      slotBg.fillStyle(0x0f172a, 1);
      slotBg.fillRoundedRect(x - slotWidth / 2, panelY - slotWidth / 2, slotWidth, slotWidth, 4);
      slotBg.lineStyle(1, 0x334155);
      slotBg.strokeRoundedRect(x - slotWidth / 2, panelY - slotWidth / 2, slotWidth, slotWidth, 4);
    }

    // Render pigs in slots
    this.updateWaitingSlotSprites();
  }

  updateWaitingSlotSprites() {
    // Clear existing slot pig sprites
    if (this.slotPigSprites) {
      this.slotPigSprites.forEach((s) => s.destroy());
    }
    this.slotPigSprites = new Map();

    const slotSpacing = LAYOUT.SLOT_SPACING;
    const startX = 360 - (2 * slotSpacing);

    for (let i = 0; i < 5; i++) {
      const pigId = state.waitingSlots[i];
      if (pigId) {
        const pig = state.pigs.find((p) => p.id === pigId);
        if (pig && pig.lifecycle === "waiting") {
          const x = startX + i * slotSpacing;
          const sprite = this.createPigSprite(pig, x, LAYOUT.SLOT_Y);
          this.slotPigSprites.set(pigId, sprite);
        }
      }
    }
  }

  createPigSprite(pig, x, y) {
    const container = this.add.container(x, y);
    const size = 40;

    // Use pig-base texture from manifest and tint with pig color
    const color = COLOR_PALETTE[pig.color] || 0xef4444;

    const pigImage = this.add.image(0, 0, "pig-base").setDisplaySize(size, size);
    pigImage.setTint(color);
    container.add(pigImage);

    // Ammo indicator
    const ammoText = this.add
      .text(0, 0, String(pig.ammo), {
        fontSize: "14px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#ffffff",
      })
      .setOrigin(0.5);
    container.add(ammoText);

    // Store reference for updates
    container.pigId = pig.id;
    container.ammoText = ammoText;

    return container;
  }

  renderHUD() {
    // Level indicator
    this.add.image(60, 80, "hud-star").setScale(0.8);
    this.levelText = this.add
      .text(90, 80, `Lv.${state.level}`, {
        fontSize: "20px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#e2e8f0",
      })
      .setOrigin(0, 0.5);

    // Score indicator
    this.add.image(660, 80, "hud-coin").setScale(0.8);
    this.scoreText = this.add
      .text(630, 80, String(state.score), {
        fontSize: "20px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#facc15",
      })
      .setOrigin(1, 0.5);

    // Conveyor capacity indicator
    this.capacityText = this.add
      .text(360, 180, `传送带: ${state.conveyorPigs.length}/${state.conveyorCapacity}`, {
        fontSize: "14px",
        fontFamily: '"Press Start 2P", "VT323", monospace',
        color: "#94a3b8",
      })
      .setOrigin(0.5);
  }

  updateHUD() {
    if (this.scoreText) {
      this.scoreText.setText(String(state.score));
    }
    if (this.capacityText) {
      this.capacityText.setText(`传送带: ${state.conveyorPigs.length}/${state.conveyorCapacity}`);
    }
  }

  // ===== Game Loop =====
  update(time, delta) {
    if (state.phase !== "playing" || state.gameOver) return;
    if (this.isProcessing) return;

    state.timeElapsed += delta;

    // Update pig positions on conveyor
    this.updateConveyorPigs(delta);

    // Check win/lose conditions
    this.checkEndConditions();
  }

  updateConveyorPigs(delta) {
    const dt = delta / 1000;

    for (const pig of state.pigs) {
      if (pig.lifecycle !== "active" || !pig.alive) continue;

      const oldT = pig.t;
      const oldSegmentId = pig.segmentId;

      // Update t position
      pig.t = (pig.t + pig.speed * dt) % 1;

      // Determine current segment
      const newSegmentId = this.getSegmentAtT(pig.t);

      // Check for segment transition (attack trigger point)
      if (oldSegmentId !== newSegmentId && newSegmentId) {
        pig.segmentId = newSegmentId;

        // Calculate grid position based on segment
        pig.gridPosition = this.getGridPositionFromT(pig.t, newSegmentId);

        // Trigger attack check
        this.onEnterSegment(pig, oldSegmentId, newSegmentId);
      }

      // Check for loop complete
      if (oldT > 0.9 && pig.t < 0.1) {
        this.onLoopComplete(pig);
      }

      // Update sprite position
      this.updatePigSpritePosition(pig);
    }
  }

  getSegmentAtT(t) {
    for (const [segId, seg] of Object.entries(this.segments)) {
      if (t >= seg.start && t < seg.end) {
        return segId;
      }
    }
    return "top"; // Default for t close to 1
  }

  getGridPositionFromT(t, segmentId) {
    const { gridWidth, gridHeight } = state;
    const { left, top, right, bottom } = this.trackBounds;

    let x, y;
    const localT = (t - this.segments[segmentId].start) / (this.segments[segmentId].end - this.segments[segmentId].start);

    switch (segmentId) {
      case "top":
        x = left + localT * (right - left);
        y = top;
        break;
      case "right":
        x = right;
        y = top + localT * (bottom - top);
        break;
      case "bottom":
        x = right - localT * (right - left);
        y = bottom;
        break;
      case "left":
        x = left;
        y = bottom - localT * (bottom - top);
        break;
    }

    // Convert to grid column/row
    const col = Math.floor((x - LAYOUT.BOARD_OFFSET_X) / LAYOUT.CELL_SIZE);
    const row = Math.floor((y - LAYOUT.BOARD_OFFSET_Y) / LAYOUT.CELL_SIZE);

    return { row, col, worldX: x, worldY: y };
  }

  getWorldPositionFromT(t) {
    const { left, top, right, bottom, width, height } = this.trackBounds;
    const perimeter = this.trackPerimeter;
    const dist = t * perimeter;

    let x, y;

    if (dist < width) {
      // Top edge
      x = left + dist;
      y = top;
    } else if (dist < width + height) {
      // Right edge
      x = right;
      y = top + (dist - width);
    } else if (dist < 2 * width + height) {
      // Bottom edge
      x = right - (dist - width - height);
      y = bottom;
    } else {
      // Left edge
      x = left;
      y = bottom - (dist - 2 * width - height);
    }

    return { x, y };
  }

  updatePigSpritePosition(pig) {
    let sprite = this.pigSprites.get(pig.id);
    if (!sprite) {
      const pos = this.getWorldPositionFromT(pig.t);
      sprite = this.createPigSprite(pig, pos.x, pos.y);
      sprite.setSize(40, 40);
      sprite.setInteractive({ useHandCursor: false });
      this.pigSprites.set(pig.id, sprite);
    }

    const pos = this.getWorldPositionFromT(pig.t);
    sprite.setPosition(pos.x, pos.y);

    // Update ammo display
    if (sprite.ammoText) {
      sprite.ammoText.setText(String(pig.ammo));
    }
  }

  // ===== Attack Logic =====
  onEnterSegment(pig, fromSegment, toSegment) {
    if (this.attackLock || pig.ammo <= 0) return;

    const before = { pigId: pig.id, segment: toSegment, ammo: pig.ammo };

    // @hard-rule(no-global-autoaim): 攻击必须严格依赖小猪当前位置，只能攻击正对方向第一个目标块
    // Ray-cast from pig position toward the board center
    const hit = this.rayCastFirstHit(pig, toSegment);

    if (hit) {
      // @hard-rule(no-multi-attack): 每次攻击只处理1个目标块
      this.tryAttack(pig, hit);
    }

    window.__trace.push({ rule: "attack-check", before, after: { hit: hit?.id }, t: Date.now() });
  }

  rayCastFirstHit(pig, segmentId) {
    // @hard-rule(no-penetration): 小猪不能跳过前方异色块去攻击后方同色块
    // Get direction based on segment
    const direction = {
      top: { dr: 1, dc: 0 }, // Attack downward
      right: { dr: 0, dc: -1 }, // Attack leftward
      bottom: { dr: -1, dc: 0 }, // Attack upward
      left: { dr: 0, dc: 1 }, // Attack rightward
    }[segmentId];

    if (!direction) return null;

    const { row, col } = pig.gridPosition;
    const { gridWidth, gridHeight } = state;

    // Scan from pig position toward the board
    let r = row + direction.dr;
    let c = col + direction.dc;

    // @hard-rule(source-dependency): 命中结果必须是 source.position 的函数
    while (r >= 0 && r < gridHeight && c >= 0 && c < gridWidth) {
      // Find first alive block at this position
      const block = state.blocks.find((b) => b.alive && b.row === r && b.col === c);
      if (block) {
        return block; // Return first hit regardless of color (no-penetration)
      }
      r += direction.dr;
      c += direction.dc;
    }

    return null;
  }

  tryAttack(pig, target) {
    if (this.attackLock) return;

    const before = { pigId: pig.id, pigAmmo: pig.ammo, targetId: target.id, targetHp: target.hp };

    // Color match check
    if (pig.color === target.color) {
      // Successful attack
      this.attackLock = true;

      state.totalAttacks++;
      state.successfulAttacks++;

      // Consume resources
      pig.ammo = Math.max(0, pig.ammo - 1);
      target.hp = Math.max(0, target.hp - 1);

      // Play effects
      this.fx.playEffect("tint-flash", { target: this.blockSprites.get(target.id), color: "#ffffff", duration: 100 });
      this.fx.playEffect("float-text", { x: 360, y: 300, text: "+10", color: "#22c55e", duration: 600 });

      // Check if target destroyed
      if (target.hp <= 0) {
        target.alive = false;
        this.destroyBlock(target);
        state.score += 10;
        this.updateHUD();
      }

      // Check if pig exhausted
      if (pig.ammo <= 0) {
        pig.lifecycle = "returning";
        this.fx.playEffect("fade-out", { target: this.pigSprites.get(pig.id), duration: 300, destroyOnEnd: false });
      }

      window.__trace.push({ rule: "attack-exec", before, after: { pigAmmo: pig.ammo, targetHp: target.hp }, t: Date.now() });

      this.time.delayedCall(TIMING.ATTACK_DELAY, () => {
        this.attackLock = false;
      });
    } else {
      // Color mismatch - no attack
      this.fx.playEffect("tint-flash", { target: this.pigSprites.get(pig.id), color: "#ef4444", duration: 100 });
      window.__trace.push({ rule: "match-miss", before, after: {}, t: Date.now() });
    }
  }

  destroyBlock(block) {
    const sprite = this.blockSprites.get(block.id);
    if (sprite) {
      this.fx.playEffect("scale-bounce", { target: sprite, from: 1, to: 0, duration: 200 });
      this.time.delayedCall(200, () => {
        sprite.destroy();
        this.blockSprites.delete(block.id);
      });
    }
  }

  // ===== Recycling Logic =====
  onLoopComplete(pig) {
    if (pig.lifecycle !== "active" || pig.ammo <= 0) {
      // Remove pig from conveyor
      this.removePigFromConveyor(pig);
      return;
    }

    const before = { pigId: pig.id, lifecycle: pig.lifecycle };

    // Pig has remaining ammo, return to waiting slot
    pig.lifecycle = "returning";

    // Find first empty waiting slot
    const emptySlotIndex = state.waitingSlots.findIndex((s) => s === null);

    if (emptySlotIndex !== -1) {
      state.waitingSlots[emptySlotIndex] = pig.id;
      pig.lifecycle = "waiting";
      pig.t = 0;
      pig.segmentId = null;

      // Remove from conveyor
      state.conveyorPigs = state.conveyorPigs.filter((id) => id !== pig.id);

      // Update visuals
      const sprite = this.pigSprites.get(pig.id);
      if (sprite) {
        sprite.destroy();
        this.pigSprites.delete(pig.id);
      }

      this.updateWaitingSlotSprites();
      this.updateHUD();

      window.__trace.push({ rule: "recycle-pig", before, after: { lifecycle: pig.lifecycle, slotIndex: emptySlotIndex }, t: Date.now() });
    } else {
      // No empty slot, pig dies
      pig.lifecycle = "dead";
      pig.alive = false;
      this.removePigFromConveyor(pig);
      window.__trace.push({ rule: "pig-death", before, after: { lifecycle: "dead" }, t: Date.now() });
    }
  }

  removePigFromConveyor(pig) {
    state.conveyorPigs = state.conveyorPigs.filter((id) => id !== pig.id);
    const sprite = this.pigSprites.get(pig.id);
    if (sprite) {
      this.fx.playEffect("fade-out", { target: sprite, duration: 200, destroyOnEnd: true });
      this.pigSprites.delete(pig.id);
    }
    this.updateHUD();
  }

  // ===== Win/Lose Check =====
  checkEndConditions() {
    if (state.gameOver) return;

    const before = { phase: state.phase };

    // Win: all blocks cleared
    const aliveBlocks = state.blocks.filter((b) => b.alive);
    if (aliveBlocks.length === 0) {
      state.phase = "win";
      state.gameOver = true;
      window.__trace.push({ rule: "win-check", before, after: { phase: "win" }, t: Date.now() });

      this.time.delayedCall(500, () => {
        this.scene.start("ResultScene");
      });
      return;
    }

    // Lose: no pigs available (waiting + conveyor empty) and blocks remain
    const waitingPigs = state.pigs.filter((p) => p.lifecycle === "waiting" && p.alive);
    const activePigs = state.pigs.filter((p) => p.lifecycle === "active" && p.alive);

    if (waitingPigs.length === 0 && activePigs.length === 0) {
      state.phase = "lose";
      state.gameOver = true;
      window.__trace.push({ rule: "lose-check", before, after: { phase: "lose" }, t: Date.now() });

      this.time.delayedCall(500, () => {
        this.scene.start("ResultScene");
      });
    }
  }

  // ===== User Input =====
  onSlotClick(slotIndex) {
    if (this.isProcessing || state.phase !== "playing") return;

    const pigId = state.waitingSlots[slotIndex];
    if (!pigId) return;

    const pig = state.pigs.find((p) => p.id === pigId);
    if (!pig || pig.lifecycle !== "waiting") return;

    // Check conveyor capacity
    if (state.conveyorPigs.length >= state.conveyorCapacity) {
      this.fx.playEffect("tint-flash", { target: this.capacityText, color: "#ef4444", duration: 200 });
      return;
    }

    const before = { pigId, lifecycle: pig.lifecycle, slotIndex };

    // Dispatch pig to conveyor
    pig.lifecycle = "active";
    pig.t = 0;
    pig.segmentId = "top";
    pig.gridPosition = this.getGridPositionFromT(0, "top");

    state.waitingSlots[slotIndex] = null;
    state.conveyorPigs.push(pig.id);

    // Update visuals
    this.updateWaitingSlotSprites();
    this.updateHUD();

    // Play effects
    this.fx.playEffect("scale-bounce", { target: this.pigSprites.get(pig.id), from: 1.2, to: 1, duration: 200 });

    window.__trace.push({ rule: "dispatch-pig", before, after: { lifecycle: pig.lifecycle }, t: Date.now() });
  }

  // ===== Test Hooks =====
  exposeTestHooks() {
    window.gameTest = window.gameTest || {};

    // Observers (read-only)
    window.gameTest.getSnapshot = () => JSON.parse(JSON.stringify(state));
    window.gameTest.getTrace = () => [...(window.__trace || [])];
    window.gameTest.getAssetUsage = () => {
      // Track all assets used via add.image calls
      const usage = [];
      const trace = window.__trace || [];
      for (const ev of trace) {
        if (ev.rule === 'asset-used' && ev.assetId) {
          usage.push({ assetId: ev.assetId, timestamp: ev.t });
        }
      }
      return usage;
    };

    // Drivers (user input simulation)
    window.gameTest.drivers = window.gameTest.drivers || {};
    window.gameTest.drivers.deployPig = (slotIndex) => this.onSlotClick(slotIndex);
    window.gameTest.drivers.clickStartButton = () => this.scene.start("PlayScene");
    window.gameTest.drivers.clickRetryButton = () => this.scene.start("PlayScene");
    window.gameTest.drivers.clickNextButton = () => {
      const nextLevel = Math.min(state.level + 1, LEVELS.length);
      if (state.unlockedLevels.includes(nextLevel)) {
        state.level = nextLevel;
      }
      this.scene.start("PlayScene");
    };

    // Legacy hooks (for backward compatibility)
    window.gameTest.hooks = window.gameTest.hooks || {};
    window.gameTest.hooks.clickStartButton = () => this.scene.start("PlayScene");
    window.gameTest.hooks.clickRetryButton = () => this.scene.start("PlayScene");
    window.gameTest.hooks.clickNextButton = window.gameTest.drivers.clickNextButton;

    window.gameTest.clickStartButton = () => this.scene.start("PlayScene");
    window.gameTest.clickRetryButton = () => this.scene.start("PlayScene");
    window.gameTest.clickNextButton = window.gameTest.drivers.clickNextButton;

    window.gameTest.dispatchPig = (slotIndex) => {
      this.onSlotClick(slotIndex);
    };

    window.gameTest.getPigAtPosition = (t) => {
      return state.pigs.find((p) => p.lifecycle === "active" && Math.abs(p.t - t) < 0.1);
    };

    window.gameTest.getBlockAtGrid = (row, col) => {
      return state.blocks.find((b) => b.alive && b.row === row && b.col === col);
    };

    window.gameTest.getGameState = () => ({ ...state });

    window.gameTest.simulateTimeStep = (ms) => {
      this.update(0, ms);
    };

    // Probes API for runtime semantics verification
    window.gameTest.probes = window.gameTest.probes || {};
    window.gameTest.probes.resetWithScenario = (scenario) => {
      // Reset trace
      window.__trace = [];

      // Reset state with scenario data
      if (scenario.pigs) {
        state.pigs = scenario.pigs.map(p => ({ ...p }));
      }
      if (scenario.blocks) {
        state.blocks = scenario.blocks.map(b => ({ ...b }));
      }
      if (scenario.game) {
        for (const item of scenario.game) {
          if (item.key === 'score') state.score = item.value;
        }
      }

      // Reset phase
      state.phase = 'playing';
      state.gameOver = false;
      state.conveyorPigs = [];
      state.waitingSlots = [null, null, null, null, null];

      // Place pigs in waiting slots based on lifecycle
      const waitingPigs = state.pigs.filter(p => p.lifecycle === 'waiting');
      for (let i = 0; i < Math.min(5, waitingPigs.length); i++) {
        state.waitingSlots[i] = waitingPigs[i].id;
      }

      // Track active pigs
      const activePigs = state.pigs.filter(p => p.lifecycle === 'active');
      for (const pig of activePigs) {
        state.conveyorPigs.push(pig.id);
      }

      // Re-render
      this.updateWaitingSlotSprites();
      this.updateHUD();

      return true;
    };

    // Observers namespace
    window.gameTest.observers = window.gameTest.observers || {};
    window.gameTest.observers.getTrace = window.gameTest.getTrace;
    window.gameTest.observers.getSnapshot = window.gameTest.getSnapshot;

    // Setup slot click handlers
    this.setupSlotClickHandlers();
  }

  setupSlotClickHandlers() {
    const slotSpacing = LAYOUT.SLOT_SPACING;
    const startX = 360 - (2 * slotSpacing);

    for (let i = 0; i < 5; i++) {
      const x = startX + i * slotSpacing;
      const hitArea = this.add.rectangle(x, LAYOUT.SLOT_Y, LAYOUT.SLOT_SIZE, LAYOUT.SLOT_SIZE, 0x000000, 0);
      hitArea.setInteractive({ useHandCursor: true });
      hitArea.slotIndex = i;

      hitArea.on("pointerdown", () => {
        this.onSlotClick(i);
      });

      hitArea.on("pointerover", () => {
        if (state.waitingSlots[i]) {
          hitArea.setFillStyle(0x22c55e, 0.2);
        }
      });

      hitArea.on("pointerout", () => {
        hitArea.setFillStyle(0x000000, 0);
      });
    }
  }
}
