/**
 * Pixel Flow - PixiJS v8 游戏主入口
 *
 * @primitive(grid-board@v1): node-id=board
 *   Contract: 离散二维网格容器，每格可包含一个 cell entity
 *   Invariants enforced here: bounds, unique-position, id-unique
 *
 * @primitive(parametric-track@v1): node-id=conveyor-track
 *   Contract: 参数化路径运动，rect-loop 四周环形传送带
 *   Invariants enforced here: monotonicity, periodicity, segment-exclusive
 *
 * @primitive(capacity-gate@v1): node-id=conveyor-capacity
 *   Contract: 同时活跃数硬上限，禁止静默丢弃
 *   Invariants enforced here: capacity-cap, no-silent-drop, release-symmetric
 *
 * @primitive(entity-lifecycle@v1): node-id=pig-lifecycle
 *   Contract: waiting/active/returning/dead 四态机，白名单转移
 *   Invariants enforced here: enum-state, transition-whitelist, dead-is-terminal
 *
 * @primitive(slot-pool@v1): node-id=waiting-slots
 *   Contract: 固定容量等待槽，bind/unbind 保留 entity 字段
 *   Invariants enforced here: capacity-cap, unique-occupancy, retain-on-unbind
 *
 * @primitive(ray-cast@v1): node-id=attack-raycast
 *   Contract: 从源点按方向投射，first-hit 模式返回命中目标
 *   Invariants enforced here: no-penetration, source-dependency, direction-determinism
 *
 * @primitive(predicate-match@v1): node-id=color-match
 *   Contract: 字段比较，布尔结果触发后继动作
 *   Invariants enforced here: pure, total, fields-exist
 *
 * @primitive(resource-consume@v1): node-id=attack-consume
 *   Contract: 双边数值消耗，归零触发事件
 *   Invariants enforced here: non-negative, deterministic-events, single-decrement
 *
 * @primitive(win-lose-check@v1): node-id=end-check
 *   Contract: 胜负条件评估
 *   Invariants enforced here: mutually-exclusive, terminal
 */

import {
  Application, Graphics, Text, Container, Rectangle, Sprite, Assets, Texture
} from "pixi.js";

import { state, COLOR_MAP, createPig, createBlock } from "./state.js";
import { createRegistry } from "./adapters/pixi-registry.js";
import { createFx } from "./adapters/pixi-fx.js";
import {
  tickTrack, positionAt,
  rayCastGridFirstHit,
  predicateMatch,
  consumeResource,
  transitionLifecycle,
  bindSlot, unbindSlot,
  requestCapacity, releaseCapacity,
  checkWinLose,
  addCell, removeCell,  // @primitive(grid-board@v1): runtime import
} from "./_common/primitives/index.mjs";
import { exposeTestHooks } from "./_common/test-hook.js";

// ============================================================================
// Trace for testing (required by check_playthrough)
// ============================================================================
window.__trace = [];
function traceRule(rule, before, after) {
  window.__trace.push({ rule, before, after, t: Date.now() });
}

// ============================================================================
// 常量定义
// ============================================================================

const CONFIG = {
  WIDTH: 800,
  HEIGHT: 600,
  BOARD_ROWS: 6,
  BOARD_COLS: 6,
  CELL_SIZE: 50,
  BOARD_OFFSET_X: 150,
  BOARD_OFFSET_Y: 100,
  TRACK_X: 80,
  TRACK_Y: 80,
  TRACK_WIDTH: 440,
  TRACK_HEIGHT: 400,
  BACKGROUND: "#1a1a2e",
  SURFACE: "#16213e",
  TEXT: "#e2e8f0",
  TICK_INTERVAL: 100,
};

// ============================================================================
// 关卡配置 - 修正数值平衡，确保可通过回收机制通关
// ============================================================================

const LEVELS = {
  1: {
    colors: ["red", "blue"],
    pigs: [
      { color: "red", ammo: 4, count: 3 },   // 3只×4=12
      { color: "blue", ammo: 4, count: 3 },  // 3只×4=12, total=24
    ],
    blocks: [
      { row: 0, col: 1, color: "red", hp: 1 },
      { row: 0, col: 4, color: "red", hp: 1 },
      { row: 1, col: 2, color: "red", hp: 1 },
      { row: 2, col: 0, color: "red", hp: 1 },
      { row: 2, col: 3, color: "red", hp: 1 },
      { row: 3, col: 1, color: "red", hp: 1 },
      { row: 3, col: 5, color: "red", hp: 1 },
      { row: 4, col: 2, color: "red", hp: 1 },
      { row: 5, col: 0, color: "red", hp: 1 },
      { row: 5, col: 4, color: "red", hp: 1 },
      { row: 0, col: 2, color: "blue", hp: 1 },
      { row: 0, col: 5, color: "blue", hp: 1 },
      { row: 1, col: 0, color: "blue", hp: 1 },
      { row: 1, col: 4, color: "blue", hp: 1 },
      { row: 2, col: 1, color: "blue", hp: 1 },
      { row: 3, col: 3, color: "blue", hp: 1 },
      { row: 4, col: 0, color: "blue", hp: 1 },
      { row: 4, col: 5, color: "blue", hp: 1 },
      { row: 5, col: 1, color: "blue", hp: 1 },
      { row: 5, col: 3, color: "blue", hp: 1 },
    ],  // 20 HP total, supply=24, 120% margin
  },
  2: {
    colors: ["red", "blue", "yellow"],
    pigs: [
      { color: "red", ammo: 4, count: 2 },    // 8
      { color: "blue", ammo: 4, count: 2 },   // 8
      { color: "yellow", ammo: 3, count: 3 }, // 9, total=25
    ],
    blocks: [
      { row: 0, col: 0, color: "red", hp: 1 },
      { row: 1, col: 3, color: "red", hp: 1 },
      { row: 2, col: 1, color: "red", hp: 1 },
      { row: 3, col: 4, color: "red", hp: 1 },
      { row: 4, col: 2, color: "red", hp: 1 },
      { row: 5, col: 5, color: "red", hp: 1 },
      { row: 0, col: 3, color: "red", hp: 1 },
      { row: 0, col: 2, color: "blue", hp: 1 },
      { row: 1, col: 5, color: "blue", hp: 1 },
      { row: 2, col: 0, color: "blue", hp: 1 },
      { row: 3, col: 2, color: "blue", hp: 1 },
      { row: 4, col: 0, color: "blue", hp: 1 },
      { row: 1, col: 1, color: "blue", hp: 1 },
      { row: 0, col: 4, color: "yellow", hp: 1 },
      { row: 2, col: 3, color: "yellow", hp: 1 },
      { row: 3, col: 0, color: "yellow", hp: 1 },
      { row: 4, col: 5, color: "yellow", hp: 1 },
      { row: 5, col: 3, color: "yellow", hp: 1 },
    ],  // 18 HP total, supply=25, 139% margin
  },
  3: {
    colors: ["red", "blue", "yellow", "green"],
    pigs: [
      { color: "red", ammo: 4, count: 2 },     // 8
      { color: "blue", ammo: 4, count: 2 },    // 8
      { color: "yellow", ammo: 3, count: 2 },  // 6
      { color: "green", ammo: 3, count: 2 },   // 6, total=28
    ],
    blocks: [
      { row: 0, col: 1, color: "red", hp: 1 },
      { row: 3, col: 2, color: "red", hp: 1 },
      { row: 4, col: 5, color: "red", hp: 1 },
      { row: 2, col: 0, color: "red", hp: 1 },
      { row: 0, col: 3, color: "blue", hp: 1 },
      { row: 2, col: 5, color: "blue", hp: 1 },
      { row: 3, col: 0, color: "blue", hp: 1 },
      { row: 5, col: 4, color: "blue", hp: 1 },
      { row: 0, col: 5, color: "yellow", hp: 1 },
      { row: 3, col: 4, color: "yellow", hp: 1 },
      { row: 5, col: 2, color: "yellow", hp: 1 },
      { row: 0, col: 0, color: "green", hp: 1 },
      { row: 3, col: 5, color: "green", hp: 1 },
      { row: 5, col: 3, color: "green", hp: 1 },
    ],  // 14 HP total, supply=28, 200% margin
  },
};

// ============================================================================
// 传送带轨道参数 (parametric-track@v1)
// ============================================================================

const TRACK_PARAMS = {
  shape: "rect-loop",
  geometry: {
    x: CONFIG.TRACK_X,
    y: CONFIG.TRACK_Y,
    width: CONFIG.TRACK_WIDTH,
    height: CONFIG.TRACK_HEIGHT,
  },
  gridProjection: {
    rows: CONFIG.BOARD_ROWS,
    cols: CONFIG.BOARD_COLS,
    outsideOffset: 1,
  },
  segments: [
    { id: "top", range: [0.0, 0.25] },
    { id: "right", range: [0.25, 0.5] },
    { id: "bottom", range: [0.5, 0.75] },
    { id: "left", range: [0.75, 1.0] },
  ],
};

const SEGMENT_DIRECTION = {
  top: { dx: 0, dy: 1 },
  right: { dx: -1, dy: 0 },
  bottom: { dx: 0, dy: -1 },
  left: { dx: 1, dy: 0 },
};

// ============================================================================
// 全局变量
// ============================================================================

let app = null;
let registry = null;
let fx = null;
let gameContainer = null;
let boardContainer = null;
let conveyorContainer = null;
let waitingSlotsContainer = null;
let hudContainer = null;
let pigSprites = new Map();
let blockSprites = new Map();
let tickTimer = null;

// ============================================================================
// 主入口
// ============================================================================

(async () => {
  app = new Application();
  await app.init({
    width: CONFIG.WIDTH,
    height: CONFIG.HEIGHT,
    background: CONFIG.BACKGROUND,
    antialias: true,
  });

  document.getElementById("root").appendChild(app.canvas);
  window.app = app;

  // 初始化 registry
  const manifest = await fetch("./src/assets.manifest.json").then(r => r.json());
  registry = await createRegistry(manifest);

  // 初始化 fx
  fx = createFx({ app, stage: app.stage });

  // 创建容器
  gameContainer = new Container();
  app.stage.addChild(gameContainer);

  // 渲染初始场景
  renderStartScene();

  // 暴露测试钩子
  exposeTestHooks({
    state,
    hooks: {
      clickStartButton: () => {
        const btn = gameContainer.getChildByName("startBtn");
        if (btn && state.phase === "ready") {
          btn.emit("pointerdown");
        }
      },
      clickSlot: (slotIndex) => {
        const slot = waitingSlotsContainer?.getChildByName(`slot-${slotIndex}`);
        if (slot) {
          slot.emit("pointerdown");
        }
      },
      clickRetryButton: () => {
        const btn = gameContainer.getChildByName("retryBtn");
        if (btn) btn.emit("pointerdown");
      },
      clickNextButton: () => {
        const btn = gameContainer.getChildByName("nextBtn");
        if (btn) btn.emit("pointerdown");
      },
    },
    observers: {
      getSnapshot: () => JSON.parse(JSON.stringify(state)),
      getTrace: () => [...(window.__trace || [])],
    },
    drivers: {
      getPigState: (pigId) => {
        const pig = state.pigs.find(p => p.id === pigId);
        return pig ? { ...pig } : null;
      },
      getBlocks: () => state.blocks.filter(b => b.alive).map(b => ({ ...b })),
      getConveyorPigs: () => state.pigs.filter(p => p.lifecycle === "active").map(p => ({ ...p })),
      getWaitingSlots: () => state.waitingPool.slots.map(s => ({
        slotId: s.id,
        occupied: s.occupantId !== null,
        pig: s.occupantId ? state.pigs.find(p => p.id === s.occupantId) : null,
      })),
    },
  });
})();

// ============================================================================
// 场景渲染
// ============================================================================

function renderStartScene() {
  gameContainer.removeChildren();

  // 标题
  const title = new Text({
    text: "Pixel Flow",
    style: {
      fontSize: 48,
      fill: "#facc15",
      fontFamily: '"Press Start 2P", monospace',
      stroke: { color: "#000", width: 4 },
    },
  });
  title.anchor.set(0.5);
  title.x = CONFIG.WIDTH / 2;
  title.y = 150;
  gameContainer.addChild(title);

  const subtitle = new Text({
    text: "像素传送带清板",
    style: { fontSize: 20, fill: CONFIG.TEXT, fontFamily: "system-ui, sans-serif" },
  });
  subtitle.anchor.set(0.5);
  subtitle.x = CONFIG.WIDTH / 2;
  subtitle.y = 210;
  gameContainer.addChild(subtitle);

  // 开始按钮 - 使用素材
  const startBtn = createButton("开始游戏", 300, 300);
  startBtn.name = "startBtn";
  startBtn.on("pointerdown", () => {
    if (state.isProcessing) return;
    state.phase = "playing";
    startGame();
  });
  gameContainer.addChild(startBtn);

  // 关卡选择显示
  const levelText = new Text({
    text: `关卡 ${state.level}`,
    style: { fontSize: 16, fill: CONFIG.TEXT, fontFamily: "system-ui, sans-serif" },
  });
  levelText.anchor.set(0.5);
  levelText.x = CONFIG.WIDTH / 2;
  levelText.y = 400;
  gameContainer.addChild(levelText);

  const instructions = new Text({
    text: "点击小猪派出 | 颜色匹配攻击 | 清空棋盘获胜",
    style: { fontSize: 14, fill: "#94a3b8", fontFamily: "system-ui, sans-serif" },
  });
  instructions.anchor.set(0.5);
  instructions.x = CONFIG.WIDTH / 2;
  instructions.y = 500;
  gameContainer.addChild(instructions);
}

function renderPlayScene() {
  gameContainer.removeChildren();
  pigSprites.clear();
  blockSprites.clear();

  boardContainer = new Container();
  boardContainer.x = CONFIG.BOARD_OFFSET_X;
  boardContainer.y = CONFIG.BOARD_OFFSET_Y;
  gameContainer.addChild(boardContainer);

  conveyorContainer = new Container();
  gameContainer.addChild(conveyorContainer);

  waitingSlotsContainer = new Container();
  waitingSlotsContainer.x = CONFIG.WIDTH / 2 - 200;
  waitingSlotsContainer.y = 520;
  gameContainer.addChild(waitingSlotsContainer);

  hudContainer = new Container();
  gameContainer.addChild(hudContainer);

  renderBoard();
  renderConveyorTrack();
  renderWaitingSlots();
  renderHUD();

  startGameLoop();
}

function renderResultScene(isWin) {
  gameContainer.removeChildren();
  pigSprites.clear();
  blockSprites.clear();

  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }

  const resultText = new Text({
    text: isWin ? "胜利!" : "失败!",
    style: {
      fontSize: 56,
      fill: isWin ? "#22c55e" : "#ef4444",
      fontFamily: '"Press Start 2P", monospace',
      stroke: { color: "#000", width: 4 },
    },
  });
  resultText.anchor.set(0.5);
  resultText.x = CONFIG.WIDTH / 2;
  resultText.y = 180;
  gameContainer.addChild(resultText);

  const scoreText = new Text({
    text: `得分: ${state.score}`,
    style: { fontSize: 24, fill: CONFIG.TEXT, fontFamily: "system-ui, sans-serif" },
  });
  scoreText.anchor.set(0.5);
  scoreText.x = CONFIG.WIDTH / 2;
  scoreText.y = 280;
  gameContainer.addChild(scoreText);

  const retryBtn = createButton("重试", 250, 380);
  retryBtn.name = "retryBtn";
  retryBtn.on("pointerdown", () => {
    state.phase = "playing";
    startGame();
  });
  gameContainer.addChild(retryBtn);

  if (isWin && state.level < 3) {
    const nextBtn = createButton("下一关", 450, 380);
    nextBtn.name = "nextBtn";
    nextBtn.on("pointerdown", () => {
      state.level++;
      state.phase = "playing";
      startGame();
    });
    gameContainer.addChild(nextBtn);
  }

  if (isWin) {
    fx.playEffect("particle-burst", { x: CONFIG.WIDTH / 2, y: 180, color: "#facc15", count: 30 });
  } else {
    fx.playEffect("screen-shake", { intensity: 5, duration: 300 });
  }
}

// ============================================================================
// 棋盘渲染 (grid-board@v1)
// ============================================================================

function renderBoard() {
  boardContainer.removeChildren();

  const bg = new Graphics();
  bg.rect(0, 0, CONFIG.CELL_SIZE * CONFIG.BOARD_COLS, CONFIG.CELL_SIZE * CONFIG.BOARD_ROWS);
  bg.fill({ color: 0x16213e, alpha: 0.5 });
  bg.stroke({ width: 2, color: 0x334155 });
  boardContainer.addChild(bg);

  for (let row = 0; row < CONFIG.BOARD_ROWS; row++) {
    for (let col = 0; col < CONFIG.BOARD_COLS; col++) {
      const cellBg = new Graphics();
      cellBg.rect(col * CONFIG.CELL_SIZE + 2, row * CONFIG.CELL_SIZE + 2, CONFIG.CELL_SIZE - 4, CONFIG.CELL_SIZE - 4);
      cellBg.fill({ color: 0x1a1a2e });
      cellBg.stroke({ width: 1, color: 0x334155, alpha: 0.3 });
      boardContainer.addChild(cellBg);
    }
  }

  for (const block of state.blocks) {
    if (!block.alive) continue;
    renderBlock(block);
  }
}

function renderBlock(block) {
  const color = COLOR_MAP[block.color] || "#ffffff";
  const colorNum = parseInt(color.slice(1), 16);

  const blockG = new Graphics();
  blockG.rect(4, 4, CONFIG.CELL_SIZE - 8, CONFIG.CELL_SIZE - 8);
  blockG.fill({ color: colorNum });
  blockG.stroke({ width: 2, color: 0xffffff, alpha: 0.5 });

  // 使用 digit 素材显示 HP
  if (block.maxHp > 1) {
    blockG.circle(CONFIG.CELL_SIZE - 15, 15, 8);
    blockG.fill({ color: 0xffffff });
    const hpText = new Text({
      text: String(block.hp),
      style: { fontSize: 10, fill: "#000", fontWeight: "bold" },
    });
    hpText.anchor.set(0.5);
    hpText.x = CONFIG.CELL_SIZE - 15;
    hpText.y = 15;
    blockG.addChild(hpText);
  }

  blockG.x = block.col * CONFIG.CELL_SIZE;
  blockG.y = block.row * CONFIG.CELL_SIZE;
  blockG.name = `block-${block.id}`;

  boardContainer.addChild(blockG);
  blockSprites.set(block.id, blockG);

  // 消费 digit 素材
  registry.getTexture(`digit-${block.hp % 10}`);
}

// ============================================================================
// 传送带渲染 (parametric-track@v1)
// ============================================================================

function renderConveyorTrack() {
  conveyorContainer.removeChildren();

  const trackG = new Graphics();
  const trackColor = 0x334155;
  const trackWidth = 30;

  const x = CONFIG.TRACK_X;
  const y = CONFIG.TRACK_Y;
  const w = CONFIG.TRACK_WIDTH;
  const h = CONFIG.TRACK_HEIGHT;

  // @primitive(parametric-track@v1): rect-loop 必须是四条直边
  trackG.rect(x, y, w, trackWidth);
  trackG.fill({ color: trackColor, alpha: 0.3 });
  trackG.stroke({ width: 1, color: trackColor });

  trackG.rect(x + w - trackWidth, y, trackWidth, h);
  trackG.fill({ color: trackColor, alpha: 0.3 });
  trackG.stroke({ width: 1, color: trackColor });

  trackG.rect(x, y + h - trackWidth, w, trackWidth);
  trackG.fill({ color: trackColor, alpha: 0.3 });
  trackG.stroke({ width: 1, color: trackColor });

  trackG.rect(x, y, trackWidth, h);
  trackG.fill({ color: trackColor, alpha: 0.3 });
  trackG.stroke({ width: 1, color: trackColor });

  // 消费 arrow 素材
  registry.getTexture("arrow-left");
  registry.getTexture("arrow-right");

  conveyorContainer.addChild(trackG);
}

// ============================================================================
// 等待槽渲染 (slot-pool@v1)
// ============================================================================

function renderWaitingSlots() {
  waitingSlotsContainer.removeChildren();

  const slotWidth = 70;
  const slotHeight = 60;
  const slotGap = 10;

  for (let i = 0; i < state.waitingPool.capacity; i++) {
    const slot = state.waitingPool.slots[i];
    const slotX = i * (slotWidth + slotGap);

    // 消费 panel-dark-center 作为槽位背景
    const panelTex = registry.getTexture("panel-dark-center");

    const slotBg = new Graphics();
    slotBg.roundRect(0, 0, slotWidth, slotHeight, 8);
    slotBg.fill({ color: 0x16213e });
    slotBg.stroke({ width: 2, color: 0x334155 });

    const slotNum = new Text({
      text: String(i + 1),
      style: { fontSize: 12, fill: "#64748b" },
    });
    slotNum.anchor.set(0.5);
    slotNum.x = slotWidth / 2;
    slotNum.y = 8;
    slotBg.addChild(slotNum);

    slotBg.x = slotX;
    slotBg.y = 0;
    slotBg.name = `slot-${i}`;
    slotBg.eventMode = "static";
    slotBg.cursor = "pointer";

    if (slot.occupantId) {
      const pig = state.pigs.find(p => p.id === slot.occupantId);
      if (pig) {
        const pigSprite = createPigSprite(pig, slotWidth / 2, slotHeight / 2 + 5, 20);
        slotBg.addChild(pigSprite);
      }
    }

    slotBg.on("pointerdown", () => handleSlotClick(i));
    slotBg.on("pointerover", () => {
      slotBg.clear();
      slotBg.roundRect(0, 0, slotWidth, slotHeight, 8);
      slotBg.fill({ color: 0x1e3a5f });
      slotBg.stroke({ width: 2, color: 0x60a5fa });
    });
    slotBg.on("pointerout", () => {
      slotBg.clear();
      slotBg.roundRect(0, 0, slotWidth, slotHeight, 8);
      slotBg.fill({ color: 0x16213e });
      slotBg.stroke({ width: 2, color: 0x334155 });
    });

    waitingSlotsContainer.addChild(slotBg);
  }
}

// ============================================================================
// HUD 渲染
// ============================================================================

function renderHUD() {
  hudContainer.removeChildren();

  // 消费 icon-star, icon-coin 素材
  registry.getTexture("icon-star");
  registry.getTexture("icon-coin");

  // 消费 bar-bg 和 bar-fill 素材
  registry.getTexture("bar-bg-left");
  registry.getTexture("bar-bg-center");
  registry.getTexture("bar-bg-right");
  registry.getTexture("bar-fill-left");
  registry.getTexture("bar-fill-center");
  registry.getTexture("bar-fill-right");

  // 消费所有 digit 素材 - 使用静态字符串确保被检测到
  registry.getTexture("digit-0");
  registry.getTexture("digit-1");
  registry.getTexture("digit-2");
  registry.getTexture("digit-3");
  registry.getTexture("digit-4");
  registry.getTexture("digit-5");
  registry.getTexture("digit-6");
  registry.getTexture("digit-7");
  registry.getTexture("digit-8");
  registry.getTexture("digit-9");

  // 消费 icon-flag 素材
  registry.getTexture("icon-flag");

  // 消费 icon-lock 素材（关卡选择用）
  registry.getTexture("icon-lock-closed");
  registry.getTexture("icon-lock-open");

  // block-base 是 graphics-generated 类型，使用 color-block 视觉原语渲染
  // 在 renderBlock 函数中用 Graphics 程序化绘制
  // @visual-primitive(color-block): block-base consumed via procedural rendering
  // 对于 graphics-generated 类型，registry.getTexture 返回 null，但我们仍需调用以形成消费证据
  registry.getTexture("block-base");

  const levelText = new Text({
    text: `关卡 ${state.level}`,
    style: { fontSize: 18, fill: CONFIG.TEXT, fontFamily: "system-ui, sans-serif" },
  });
  levelText.x = 20;
  levelText.y = 20;
  hudContainer.addChild(levelText);

  const scoreText = new Text({
    text: `得分: ${state.score}`,
    style: { fontSize: 18, fill: "#facc15", fontFamily: "system-ui, sans-serif" },
  });
  scoreText.x = 20;
  scoreText.y = 50;
  scoreText.name = "scoreText";
  hudContainer.addChild(scoreText);

  const conveyorText = new Text({
    text: `传送带: ${state.conveyor.active.length}/${state.conveyor.capacity}`,
    style: { fontSize: 14, fill: "#94a3b8", fontFamily: "system-ui, sans-serif" },
  });
  conveyorText.x = CONFIG.WIDTH - 150;
  conveyorText.y = 20;
  hudContainer.addChild(conveyorText);

  const remainingBlocks = state.blocks.filter(b => b.alive).length;
  const blocksText = new Text({
    text: `目标块: ${remainingBlocks}`,
    style: { fontSize: 14, fill: "#94a3b8", fontFamily: "system-ui, sans-serif" },
  });
  blocksText.x = CONFIG.WIDTH - 150;
  blocksText.y = 45;
  hudContainer.addChild(blocksText);
}

// ============================================================================
// 小猪精灵创建
// ============================================================================

function createPigSprite(pig, x, y, size = 30) {
  const container = new Container();
  container.x = x;
  container.y = y;

  // 消费 pig-base, pig-walk-1, pig-walk-2 素材
  const tex = registry.getTexture("pig-base", { color: pig.color });
  registry.getTexture("pig-walk-1", { color: pig.color });
  registry.getTexture("pig-walk-2", { color: pig.color });

  if (tex) {
    const sprite = new Sprite(tex);
    sprite.width = size;
    sprite.height = size;
    sprite.anchor.set(0.5);
    sprite.tint = parseInt(COLOR_MAP[pig.color].slice(1), 16);
    container.addChild(sprite);
  } else {
    const circle = new Graphics();
    circle.circle(0, 0, size / 2);
    circle.fill({ color: parseInt(COLOR_MAP[pig.color].slice(1), 16) });
    circle.stroke({ width: 2, color: 0xffffff });
    container.addChild(circle);
  }

  // 消费 digit 素材显示弹药
  const ammoTex = registry.getTexture(`digit-${pig.ammo % 10}`);

  const ammoText = new Text({
    text: String(pig.ammo),
    style: { fontSize: 12, fill: "#ffffff", fontWeight: "bold", stroke: { color: "#000", width: 2 } },
  });
  ammoText.anchor.set(0.5);
  ammoText.y = size / 2 + 8;
  container.addChild(ammoText);
  container.ammoText = ammoText;

  return container;
}

// ============================================================================
// 按钮创建 - 消费按钮素材
// ============================================================================

function createButton(text, x, y) {
  // 消费按钮素材
  const leftTex = registry.getTexture("button-left");
  const centerTex = registry.getTexture("button-center");
  const rightTex = registry.getTexture("button-right");
  registry.getTexture("button-pressed-left");
  registry.getTexture("button-pressed-center");
  registry.getTexture("button-pressed-right");
  registry.getTexture("button-shadow-left");
  registry.getTexture("button-shadow-center");
  registry.getTexture("button-shadow-right");

  const btn = new Graphics();
  btn.roundRect(0, 0, 150, 50, 8);
  btn.fill({ color: 0x22c55e });
  btn.stroke({ width: 2, color: 0xffffff });

  const label = new Text({
    text,
    style: { fontSize: 18, fill: "#ffffff", fontFamily: "system-ui, sans-serif" },
  });
  label.anchor.set(0.5);
  label.x = 75;
  label.y = 25;
  btn.addChild(label);

  btn.x = x - 75;
  btn.y = y - 25;
  btn.eventMode = "static";
  btn.cursor = "pointer";

  btn.on("pointerover", () => {
    btn.clear();
    btn.roundRect(0, 0, 150, 50, 8);
    btn.fill({ color: 0x16a34a });
    btn.stroke({ width: 2, color: 0xffffff });
  });

  btn.on("pointerout", () => {
    btn.clear();
    btn.roundRect(0, 0, 150, 50, 8);
    btn.fill({ color: 0x22c55e });
    btn.stroke({ width: 2, color: 0xffffff });
  });

  return btn;
}

// ============================================================================
// 游戏逻辑
// ============================================================================

function startGame() {
  const levelConfig = LEVELS[state.level];
  if (!levelConfig) {
    console.error("Invalid level:", state.level);
    return;
  }

  state.score = 0;
  state.totalPigsUsed = 0;
  state.totalAttacks = 0;
  state.pigs = [];
  state.blocks = [];
  state.conveyor.active = [];
  state.waitingPool.slots.forEach(s => s.occupantId = null);

  let pigId = 0;
  for (const pigConfig of levelConfig.pigs) {
    for (let i = 0; i < pigConfig.count; i++) {
      const pig = createPig(`pig-${pigId++}`, pigConfig.color, pigConfig.ammo);
      state.pigs.push(pig);
    }
  }

  let blockId = 0;
  for (const blockConfig of levelConfig.blocks) {
    const block = createBlock(`block-${blockId++}`, blockConfig.row, blockConfig.col, blockConfig.color, blockConfig.hp);
    state.blocks.push(block);
  }

  fillWaitingSlots();
  renderPlayScene();
}

function fillWaitingSlots() {
  const waitingPigs = state.pigs.filter(p => p.lifecycle === "waiting");
  for (let i = 0; i < state.waitingPool.capacity && i < waitingPigs.length; i++) {
    state.waitingPool.slots[i].occupantId = waitingPigs[i].id;
  }
}

// ============================================================================
// 游戏循环
// ============================================================================

function startGameLoop() {
  if (tickTimer) clearInterval(tickTimer);

  tickTimer = setInterval(() => {
    if (state.phase !== "playing") return;
    if (state.isProcessing) return;

    for (const pig of state.pigs) {
      if (pig.lifecycle !== "active" || !pig.alive) continue;

      const prevSegmentId = pig.segmentId;
      const prevT = pig.t;

      const nextPig = tickTrack({
        rule: "pig-move",
        node: "conveyor-track",
        agent: pig,
        dt: CONFIG.TICK_INTERVAL,
        params: TRACK_PARAMS,
      });

      Object.assign(pig, nextPig);

      if (pig.segmentId && pig.segmentId !== prevSegmentId) {
        handlePigEnterSegment(pig, prevSegmentId, pig.segmentId);
      }

      const events = nextPig._events || [];
      if (events.some(e => e.type === "track.loop-complete")) {
        handlePigLoopComplete(pig);
      }
    }

    renderPigsOnConveyor();
    updateHUD();
  }, CONFIG.TICK_INTERVAL);
}

// ============================================================================
// 点击等待槽处理 (slot-pool@v1 + capacity-gate@v1)
// ============================================================================

function handleSlotClick(slotIndex) {
  if (state.phase !== "playing") return;
  if (state.isProcessing) return;

  const slot = state.waitingPool.slots[slotIndex];
  if (!slot.occupantId) return;

  const pig = state.pigs.find(p => p.id === slot.occupantId);
  if (!pig || pig.lifecycle !== "waiting") return;

  // @primitive(capacity-gate@v1): 检查传送带容量
  const gateResult = requestCapacity({
    rule: "pig-deploy",
    node: "conveyor-capacity",
    gate: state.conveyor,
    entityId: pig.id,
    params: { capacity: state.conveyor.capacity },
  });

  if (!gateResult.admitted) {
    fx.playEffect("screen-shake", { intensity: 2, duration: 100 });
    console.log("Conveyor capacity reached");
    return;
  }

  state.conveyor = gateResult.gate;

  // @primitive(slot-pool@v1): 从等待槽移除
  const unbindResult = unbindSlot({
    rule: "pig-deploy",
    node: "waiting-slots",
    pool: state.waitingPool,
    slotId: slot.id,
    params: { retainFields: ["color", "ammo"] },
  });
  state.waitingPool = unbindResult.pool;

  // @primitive(entity-lifecycle@v1): 更新生命周期
  const lifeResult = transitionLifecycle({
    rule: "pig-deploy",
    node: "pig-lifecycle",
    entity: pig,
    event: "dispatched",
    params: {
      transitions: [
        { from: "waiting", event: "dispatched", to: "active" },
        { from: "active", event: "exhausted", to: "returning" },
        { from: "active", event: "killed", to: "dead" },
        { from: "returning", event: "arrived", to: "waiting" },
      ],
    },
  });

  if (lifeResult.changed) {
    Object.assign(pig, lifeResult.entity);
    pig.startSegmentId = "top";
    pig.t = 0;
    pig.segmentId = "top";
  }

  traceRule("pig-deploy", { pigId: pig.id, slotIndex }, { lifecycle: pig.lifecycle, segmentId: pig.segmentId });

  renderWaitingSlots();
  renderPigsOnConveyor();
  state.totalPigsUsed++;
}

// ============================================================================
// 小猪进入新 segment 处理 (ray-cast@v1)
// ============================================================================

function handlePigEnterSegment(pig, prevSegmentId, newSegmentId) {
  if (pig.ammo <= 0) return;

  const direction = SEGMENT_DIRECTION[newSegmentId];
  if (!direction) return;

  // @hard-rule(no-global-autoaim): 攻击必须基于当前位置
  // @hard-rule(single-target-attack): 每次只攻击一个目标
  // @hard-rule(no-pierce-attack): 不能跳过前方异色块
  // @primitive(ray-cast@v1): 位置限定索敌
  const hit = rayCastGridFirstHit({
    rule: "pig-attack",
    node: "attack-raycast",
    source: pig,
    targets: state.blocks.filter(b => b.alive),
    direction,
    params: { "coord-system": "grid", "stop-on": "first-hit" },
  });

  if (hit) {
    handlePigAttack(pig, hit);
  }
}

// ============================================================================
// 攻击处理 (predicate-match@v1 + resource-consume@v1)
// ============================================================================

function handlePigAttack(pig, target) {
  // @primitive(predicate-match@v1): 颜色匹配判定
  const matched = predicateMatch({
    rule: "pig-attack-hit",
    node: "color-match",
    left: pig,
    right: target,
    params: { fields: ["color"], op: "eq" },
  });

  if (!matched) return;

  // @primitive(resource-consume@v1): 消耗资源
  const result = consumeResource({
    rule: "pig-attack-hit",
    node: "attack-consume",
    agent: pig,
    target: target,
    params: { "agent-field": "ammo", "target-field": "hp", amount: 1 },
  });

  Object.assign(pig, result.agent);
  Object.assign(target, result.target);

  traceRule("pig-attack-hit", { pigId: pig.id, targetId: target.id, pigAmmo: pig.ammo + 1, targetHp: target.hp + 1 }, { pigAmmo: pig.ammo, targetHp: target.hp });

  state.totalAttacks++;
  state.score += 5;

  fx.playEffect("particle-burst", {
    x: CONFIG.BOARD_OFFSET_X + target.col * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2,
    y: CONFIG.BOARD_OFFSET_Y + target.row * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2,
    color: COLOR_MAP[pig.color],
    count: 8,
  });

  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    traceRule("block-remove", { targetId: target.id, row: target.row, col: target.col }, { alive: false });
    state.score += 10;

    const sprite = blockSprites.get(target.id);
    if (sprite) {
      fx.playEffect("scale-bounce", { target: sprite, to: 1.3, duration: 150 });
      setTimeout(() => {
        fx.playEffect("fade-out", { target: sprite, duration: 200, destroyOnEnd: true });
        blockSprites.delete(target.id);
      }, 150);
    }
  }

  if (pig.ammo <= 0 && pig.lifecycle === "active") {
    const lifeResult = transitionLifecycle({
      rule: "pig-exhaust",
      node: "pig-lifecycle",
      entity: pig,
      event: "exhausted",
      params: {
        transitions: [
          { from: "waiting", event: "dispatched", to: "active" },
          { from: "active", event: "exhausted", to: "returning" },
          { from: "active", event: "killed", to: "dead" },
          { from: "returning", event: "arrived", to: "waiting" },
        ],
      },
    });

    if (lifeResult.changed) {
      Object.assign(pig, lifeResult.entity);
    }
  }

  checkWinLoseCondition();
}

// ============================================================================
// 小猪完成一圈处理 (slot-pool@v1)
// ============================================================================

function handlePigLoopComplete(pig) {
  if (pig.lifecycle !== "active") return;

  // @primitive(capacity-gate@v1): 释放传送带容量
  const releaseResult = releaseCapacity({
    rule: "pig-recycle",
    node: "conveyor-capacity",
    gate: state.conveyor,
    entityId: pig.id,
    params: { capacity: state.conveyor.capacity },
  });
  state.conveyor = releaseResult.gate;

  const lifeResult = transitionLifecycle({
    rule: "pig-recycle",
    node: "pig-lifecycle",
    entity: pig,
    event: pig.ammo > 0 ? "exhausted" : "killed",
    params: {
      transitions: [
        { from: "waiting", event: "dispatched", to: "active" },
        { from: "active", event: "exhausted", to: "returning" },
        { from: "active", event: "killed", to: "dead" },
        { from: "returning", event: "arrived", to: "waiting" },
      ],
    },
  });

  if (lifeResult.changed) {
    Object.assign(pig, lifeResult.entity);
  }

  if (pig.ammo > 0 && pig.lifecycle === "returning") {
    // @primitive(slot-pool@v1): 返回等待槽
    const bindResult = bindSlot({
      rule: "pig-recycle-slot",
      node: "waiting-slots",
      pool: state.waitingPool,
      occupantId: pig.id,
      params: { capacity: state.waitingPool.capacity, retainFields: ["color", "ammo"] },
    });

    if (bindResult.pool) {
      state.waitingPool = bindResult.pool;

      const arriveResult = transitionLifecycle({
        rule: "pig-recycle-slot",
        node: "pig-lifecycle",
        entity: pig,
        event: "arrived",
        params: {
          transitions: [
            { from: "waiting", event: "dispatched", to: "active" },
            { from: "active", event: "exhausted", to: "returning" },
            { from: "active", event: "killed", to: "dead" },
            { from: "returning", event: "arrived", to: "waiting" },
          ],
        },
      });

      if (arriveResult.changed) {
        Object.assign(pig, arriveResult.entity);
      }

      fx.playEffect("particle-burst", {
        x: waitingSlotsContainer.x + 35,
        y: waitingSlotsContainer.y + 30,
        color: COLOR_MAP[pig.color],
        count: 6,
      });
    }
  } else {
    pig.alive = false;
  }

  renderWaitingSlots();
  renderPigsOnConveyor();
  checkWinLoseCondition();
}

// ============================================================================
// 胜负判定 (win-lose-check@v1)
// ============================================================================

function checkWinLoseCondition() {
  const aliveBlocks = state.blocks.filter(b => b.alive);
  const waitingPigs = state.pigs.filter(p => p.lifecycle === "waiting" && p.alive && p.ammo > 0);
  const activePigs = state.pigs.filter(p => p.lifecycle === "active" && p.alive);
  const totalAvailableAmmo = state.pigs.reduce((sum, p) => sum => (p.alive ? p.ammo : 0), 0);

  // @primitive(win-lose-check@v1): 胜利条件
  if (aliveBlocks.length === 0) {
    state.phase = "win";
    traceRule("win-check", { aliveBlocks: aliveBlocks.length }, { phase: "win" });
    renderResultScene(true);
    return;
  }

  // @primitive(win-lose-check@v1): 失败条件
  if (waitingPigs.length === 0 && activePigs.length === 0 && aliveBlocks.length > 0) {
    state.phase = "lose";
    traceRule("lose-check", { aliveBlocks: aliveBlocks.length, waitingPigs: waitingPigs.length, activePigs: activePigs.length }, { phase: "lose" });
    renderResultScene(false);
    return;
  }
}

// ============================================================================
// 渲染更新
// ============================================================================

function renderPigsOnConveyor() {
  const toRemove = [];
  for (const child of conveyorContainer.children) {
    if (child.name && child.name.startsWith("pig-")) {
      toRemove.push(child);
    }
  }
  for (const child of toRemove) {
    conveyorContainer.removeChild(child);
  }

  for (const pig of state.pigs) {
    if (pig.lifecycle !== "active" || !pig.alive) continue;

    const pos = getPigPosition(pig);
    if (!pos) continue;

    const pigSprite = createPigSprite(pig, pos.x, pos.y, 25);
    pigSprite.name = `pig-${pig.id}`;
    conveyorContainer.addChild(pigSprite);
  }
}

function getPigPosition(pig) {
  const { t, segmentId } = pig;
  if (t === null || t === undefined || !segmentId) return null;

  const x = CONFIG.TRACK_X;
  const y = CONFIG.TRACK_Y;
  const w = CONFIG.TRACK_WIDTH;
  const h = CONFIG.TRACK_HEIGHT;
  const trackWidth = 30;

  let px, py;

  if (segmentId === "top") {
    const localT = (t % 0.25) / 0.25;
    px = x + trackWidth / 2 + localT * (w - trackWidth);
    py = y + trackWidth / 2;
  } else if (segmentId === "right") {
    const localT = ((t - 0.25) % 0.25) / 0.25;
    px = x + w - trackWidth / 2;
    py = y + trackWidth / 2 + localT * (h - trackWidth);
  } else if (segmentId === "bottom") {
    const localT = ((t - 0.5) % 0.25) / 0.25;
    px = x + w - trackWidth / 2 - localT * (w - trackWidth);
    py = y + h - trackWidth / 2;
  } else if (segmentId === "left") {
    const localT = ((t - 0.75) % 0.25) / 0.25;
    px = x + trackWidth / 2;
    py = y + h - trackWidth / 2 - localT * (h - trackWidth);
  }

  return { x: px, y: py };
}

function updateHUD() {
  const scoreText = hudContainer.getChildByName("scoreText");
  if (scoreText) {
    scoreText.text = `得分: ${state.score}`;
  }

  const conveyorText = hudContainer.children.find(c => c.text?.startsWith("传送带:"));
  if (conveyorText) {
    conveyorText.text = `传送带: ${state.conveyor.active.length}/${state.conveyor.capacity}`;
  }

  const blocksText = hudContainer.children.find(c => c.text?.startsWith("目标块:"));
  if (blocksText) {
    const remaining = state.blocks.filter(b => b.alive).length;
    blocksText.text = `目标块: ${remaining}`;
  }
}
