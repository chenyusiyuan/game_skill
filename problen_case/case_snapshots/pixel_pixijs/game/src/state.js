// @must-have: 完整游戏状态定义
// 包含所有 mechanics 原语所需的状态字段

export const state = {
  // 游戏阶段
  currentScene: "start",
  level: 1,
  score: 0,
  phase: "ready", // ready | playing | win | lose

  // 棋盘状态 (grid-board@v1)
  board: {
    rows: 6,
    cols: 6,
    cells: [],
  },
  boardSize: 6,

  // 传送带状态 (parametric-track@v1 + capacity-gate@v1)
  conveyor: {
    capacity: 4,
    active: [], // 当前在传送带上的小猪 ID 列表
  },

  // 等待槽状态 (slot-pool@v1)
  waitingPool: {
    capacity: 5,
    slots: [
      { id: "slot-0", occupantId: null },
      { id: "slot-1", occupantId: null },
      { id: "slot-2", occupantId: null },
      { id: "slot-3", occupantId: null },
      { id: "slot-4", occupantId: null },
    ],
  },

  // 所有实体集合
  pigs: [],   // 所有小猪实体
  blocks: [], // 所有目标块实体

  // 统计
  totalPigsUsed: 0,
  totalAttacks: 0,

  // 异步锁
  isProcessing: false,
  selectedSlot: null,
};

// 颜色映射
export const COLOR_MAP = {
  red: "#ef4444",
  blue: "#3b82f6",
  yellow: "#facc15",
  green: "#22c55e",
};

// 小猪实体字段 (entity-lifecycle@v1 + parametric-track@v1 + resource-consume@v1)
export function createPig(id, color, ammo) {
  return {
    id,
    color,
    ammo,
    t: 0,
    speed: 0.1,
    segmentId: null,
    lifecycle: "waiting", // waiting | active | returning | dead
    alive: true,
    gridPosition: { row: -1, col: 0 },
    startSegmentId: null, // 用于判断是否绕了一圈
  };
}

// 目标块实体字段 (grid-board@v1 + resource-consume@v1)
export function createBlock(id, row, col, color, hp) {
  return {
    id,
    row,
    col,
    color,
    hp,
    maxHp: hp,
    alive: true,
  };
}

window.gameState = state;
