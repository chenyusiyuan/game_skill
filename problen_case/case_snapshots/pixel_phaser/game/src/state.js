// gameState — 游戏逻辑状态，通过 window.gameState 暴露给 Playwright
// 禁止混入 UI 层临时数据（DOM 元素引用、定时器 ID、动画中间状态）

const state = {
  // Scene and phase state
  currentScene: "start",
  phase: "ready", // ready | playing | win | lose
  gameOver: false,
  isProcessing: false,

  // Level and score
  level: 1,
  score: 0,
  unlockedLevels: [1],

  // Level-specific state (reset on each level start)
  timeElapsed: 0,

  // Conveyor state
  conveyorCapacity: 4,
  conveyorPigs: [],

  // Waiting slots (5 slots, each can hold a pig or null)
  waitingSlots: [null, null, null, null, null],

  // Board state (grid of blocks)
  gridWidth: 5,
  gridHeight: 5,
  blocks: [],

  // Pigs collection
  pigs: [],

  // Selection state
  selectedPigIndex: null,

  // Stats for current level
  totalAttacks: 0,
  successfulAttacks: 0,

  // Trace for rule verification
  __trace: [],
};

// Level configurations
const LEVELS = [
  {
    id: 1,
    difficulty: "easy",
    colors: 2,
    gridSize: [5, 5],
    blockCount: 15,
    pigCount: 8,
    conveyorCapacity: 4,
    reinforcedBlocks: 0,
    colorSet: ["red", "blue"],
    pigDistribution: { red: 4, blue: 4 },
    pigAmmoRange: [2, 3],
  },
  {
    id: 2,
    difficulty: "medium",
    colors: 3,
    gridSize: [6, 6],
    blockCount: 25,
    pigCount: 12,
    conveyorCapacity: 4,
    reinforcedBlocks: 3,
    colorSet: ["red", "blue", "yellow"],
    pigDistribution: { red: 4, blue: 4, yellow: 4 },
    pigAmmoRange: [2, 3],
    reinforcedHp: 2,
  },
  {
    id: 3,
    difficulty: "hard",
    colors: 4,
    gridSize: [7, 7],
    blockCount: 35,
    pigCount: 16,
    conveyorCapacity: 4,
    reinforcedBlocks: 7,
    colorSet: ["red", "blue", "yellow", "green"],
    pigDistribution: { red: 4, blue: 4, yellow: 4, green: 4 },
    pigAmmoRange: [2, 3],
    reinforcedHp: [2, 2, 2, 2, 2, 3, 3],
  },
];

// Color palette for rendering
const COLOR_PALETTE = {
  red: 0xef4444,
  blue: 0x3b82f6,
  yellow: 0xfacc15,
  green: 0x22c55e,
};

// Color hex strings for tint
const COLOR_HEX = {
  red: "#ef4444",
  blue: "#3b82f6",
  yellow: "#facc15",
  green: "#22c55e",
};

window.gameState = state;
window.LEVELS = LEVELS;
window.COLOR_PALETTE = COLOR_PALETTE;
window.COLOR_HEX = COLOR_HEX;

// ES Module exports
export { state, LEVELS, COLOR_PALETTE, COLOR_HEX };
