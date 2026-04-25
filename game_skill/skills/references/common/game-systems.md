# 游戏通用系统模块库

Phase 3 expand + Phase 4 codegen 必读。本文件提供**跨游戏类型复用的基础系统模块**，LLM 在实现具体游戏时应按需组装，而不是从零发明。

**使用方式**：
1. 读 GamePRD 的 `@system` / `@rule` / `@entity` 标签
2. 对照「模块契约速查表」识别需要哪些模块
3. 检查「依赖图」确认依赖是否完整
4. 复制对应模块的核心数据结构和逻辑，按具体需求调参
5. 用「事件连接」把模块串起来

---

## 模块契约速查表

每个模块的**契约元信息**，用于 expand 阶段生成 event-graph.yaml 和 codegen 阶段做依赖校验。

```yaml
# §1 状态机（State Machine）
system.fsm:
  provides: [state-transition, phase-management]
  requires: []                    # 无依赖，底座模块
  inputEvents: [game.start, game.pause, game.resume, scene.navigate]
  outputEvents: [state.changed, scene.entered, scene.exited]
  stateSchema: { phase: string, previousPhase: string }
  invariants:
    - "状态只能通过 send() 转移，不能直接赋值"
    - "每个状态必须有 enter/exit 钩子"

# §2 战斗/伤害（Combat & Damage）
system.combat:
  provides: [damage-calculation, hit-check, element-multiplier, health-management]
  requires: []    # health 是 §2 的内置子组件，不需要外部依赖
  optional: [system.buff, system.feedback]
  inputEvents: [combat.attack-hit]
  outputEvents: [damage.applied, entity.damaged, entity.dead]
  stateSchema: { hp: number, maxHp: number, atk: number, def: number }
  invariants:
    - "hp >= 0 && hp <= maxHp"
    - "damage >= 1（最低 1 点伤害）"
    - "dead entity 不能再受到伤害"

# §2.juice 打击感（Game Juice）
system.juice:
  provides: [hit-stop, knockback, flash-white, hit-feedback-combo]
  requires: [system.combat]
  optional: [system.feedback]
  inputEvents: [damage.applied]
  outputEvents: [juice.hit-stop, juice.knockback, juice.flash]
  stateSchema: {}
  invariants:
    - "每次 damage.applied 至少触发 3 种反馈"
    - "暴击反馈强度 > 普通攻击反馈强度"

# §3 等级/经验（Level & Experience）
system.level:
  provides: [exp-curve, level-up-detection, stat-growth]
  requires: []
  optional: [system.feedback]
  inputEvents: [exp.gained]
  outputEvents: [level.up, stats.changed]
  stateSchema: { level: number, exp: number, maxLevel: number }
  invariants:
    - "level >= 1 && level <= maxLevel"
    - "经验曲线必须递增（不能平坦）"
    - "升级必须触发 level.up 事件"

# §4 资源/经济循环（Economy & Resources）
system.economy:
  provides: [wallet, shop, producer, resource-cycle]
  requires: []
  optional: [system.level]
  inputEvents: [resource.earned, resource.spent, shop.buy]
  outputEvents: [resource.changed, purchase.success, purchase.failed]
  stateSchema: { wallet: { [resourceType]: number } }
  invariants:
    - "资源 >= 0（不能为负）"
    - "购买前必须检查余额"
    - "至少 2 种资源 + 至少 1 个消耗口"

# §5 物理/碰撞（Physics & Collision）
system.physics:
  provides: [kinematics, gravity, collision-detection, collision-response, coyote-time, input-buffer]
  requires: []
  optional: []
  inputEvents: [input.move, input.jump]
  outputEvents: [collision.hit, entity.grounded, entity.airborne]
  stateSchema: { x: number, y: number, vx: number, vy: number, grounded: boolean }
  invariants:
    - "dt 必须夹紧（Math.min(dt, 0.033)）"
    - "碰撞后必须做分离"
    - "平台跳跃必须有 Coyote Time + Input Buffer"

# §6 计时器/冷却（Timer & Cooldown）
system.timer:
  provides: [countdown, cooldown-manager, wave-controller]
  requires: []
  optional: []
  inputEvents: [timer.start, timer.pause, timer.add-time]
  outputEvents: [timer.tick, timer.end, wave.started, wave.complete]
  stateSchema: { timeRemaining: number, isPaused: boolean }
  invariants:
    - "remaining >= 0"
    - "暂停时不消耗时间"

# §7 随机/掉落（RNG & Loot）
system.rng:
  provides: [seeded-random, weighted-pick, loot-table, pity-system, shuffle, room-generation]
  requires: []
  optional: []
  inputEvents: [loot.roll]
  outputEvents: [loot.dropped, loot.pity-triggered]
  stateSchema: { seed: number, pityCounter: number }
  invariants:
    - "稀有掉落必须有保底机制"
    - "同一 seed 必须产生相同序列"

# §8 难度曲线（Difficulty & Progression）
system.difficulty:
  provides: [linear-scale, exponential-scale, sigmoid-scale, dda, level-config-generator]
  requires: []
  optional: [system.level]
  inputEvents: [round.complete]
  outputEvents: [difficulty.adjusted]
  stateSchema: { currentDifficulty: number, history: boolean[] }
  invariants:
    - "难度 >= minDifficulty && <= maxDifficulty"
    - "每 3-5 关应引入新元素"

# §9 Buff/Debuff（Status Effects）
system.buff:
  provides: [buff-apply, buff-tick, buff-remove, stat-modifier, common-buffs]
  requires: []
  optional: [system.combat]
  inputEvents: [buff.apply, buff.remove]
  outputEvents: [buff.applied, buff.expired, buff.stacked, stats.modified]
  stateSchema: { buffs: Array<{ id, remaining, stacks }> }
  invariants:
    - "过期 buff 必须在同帧移除"
    - "叠加数 <= maxStack"

# §10 存档/进度（Save & Progress）
system.save:
  provides: [save, load, auto-save, clear, has-save]
  requires: []
  optional: []
  inputEvents: [save.request, load.request]
  outputEvents: [save.success, save.failed, load.success, load.failed]
  stateSchema: {}
  invariants:
    - "存档必须有版本号（支持迁移）"
    - "读档失败返回 null 不 crash"

# §11 对象池（Object Pool）
system.pool:
  provides: [acquire, release, batch-release, forEach]
  requires: []
  optional: []
  inputEvents: []
  outputEvents: []
  stateSchema: { activeCount: number }
  invariants:
    - "release 后对象不能再被 forEach 遍历"
    - "acquire 优先复用已回收对象"

# §12 寻路/AI（Pathfinding & AI）
system.ai:
  provides: [astar, patrol, chase, simple-fsm-ai]
  requires: []
  optional: [system.physics, system.combat]
  inputEvents: [ai.tick]
  outputEvents: [ai.state-changed, ai.attack, ai.lost-target]
  stateSchema: { aiState: string, waypointIndex: number }
  invariants:
    - "寻路返回 null 时 AI 不能卡死"
    - "追踪距离超限必须放弃"

# §13 实体注册/变换（Entity & Transform）
system.entity:
  provides: [entity-registry, tag-query, transform, z-sorting]
  requires: []
  optional: []
  inputEvents: [entity.create, entity.destroy]
  outputEvents: [entity.created, entity.destroyed]
  stateSchema: { entities: Map, nextId: number }
  invariants:
    - "ID 全局唯一且自增"
    - "destroy 后不能再被 byTag 查到"
    - "cleanup 必须在每帧末尾调用"

# §14 技能/投射物（Ability & Projectile）
system.ability:
  provides: [ability-register, cooldown-check, ability-use, projectile-spawn, projectile-update, projectile-hit-check]
  requires: []
  optional: [system.combat, system.pool, system.entity]
  inputEvents: [ability.use]
  outputEvents: [ability.used, ability.cooldown, projectile.spawned, projectile.hit]
  stateSchema: { abilities: Map, projectiles: Array }
  invariants:
    - "canUse 检查在前，扣资源在后"
    - "投射物超时/出界必须销毁"
    - "穿透子弹用 hitEntities 去重"

# §15 背包/物品（Inventory & Item）
system.inventory:
  provides: [item-db, inventory-add, inventory-remove, inventory-query, slot-swap]
  requires: []
  optional: [system.economy, system.save]
  inputEvents: [item.pickup, item.use, item.drop]
  outputEvents: [inventory.changed, inventory.full, item.used]
  stateSchema: { slots: Array<{ itemId, count } | null>, maxSlots: number }
  invariants:
    - "物品数量 >= 0"
    - "不可堆叠物品 maxStack = 1"
    - "add 返回实际添加数量（背包满时 < 请求数量）"

# §16 生产/升级/解锁（Production & Upgrade & Unlock）
system.production:
  provides: [production-queue, upgrade-cost-curve, upgrade-effect-curve, condition-unlock, level-progression, star-rating]
  requires: []
  optional: [system.economy, system.inventory, system.save]
  inputEvents: [production.start, upgrade.request, unlock.check]
  outputEvents: [production.complete, upgrade.done, unlock.new, level.completed]
  stateSchema: { queue: Array, upgrades: Map, unlocks: Map, levels: Array }
  invariants:
    - "升级费用必须递增（指数曲线）"
    - "解锁条件用 >= 不用 ==="
    - "关卡推进必须持久化"
```

## 依赖图

模块间的必选 / 可选依赖关系。**expand 阶段和 codegen Step 4.1 必须校验依赖完整性。**

```
§1  状态机 ←────────── 所有游戏（无依赖）
§2  战斗/伤害 ←────────── 无依赖（health 内含）
§2.juice 打击感 ──requires──→ §2 战斗
§3  等级 ←────────── 无依赖
§4  经济 ←────────── 无依赖
§5  物理 ←────────── 无依赖
§6  计时器 ←────────── 无依赖
§7  随机 ←────────── 无依赖
§8  难度 ←────────── 无依赖（可选 §3）
§9  Buff ←────────── 无依赖（常与 §2 配合）
§10 存档 ←────────── 无依赖
§11 对象池 ←────────── 无依赖
§12 AI ←────────── 无依赖（可选 §5、§2）
§13 实体/变换 ←────────── 无依赖（动作类游戏底座）
§14 技能/投射物 ←────────── 无依赖（可选 §2、§11、§13）
§15 背包/物品 ←────────── 无依赖（可选 §4、§10）
§16 生产/升级/解锁 ←────────── 无依赖（可选 §4、§15、§10）
```

**常见组合的依赖链**：

| 选了这个模块 | 必须同时选 | 建议同时选 |
|---|---|---|
| §2 战斗 | — | §9 Buff, §2.juice 打击感 |
| §2.juice 打击感 | §2 战斗 | — |
| §4.shop 商店 | §4.wallet 钱包 | — |
| §12 AI | — | §5 物理（追踪移动）, §2 战斗（攻击行为） |
| §14 技能/投射物 | — | §2 战斗（伤害计算）, §11 对象池（大量子弹）, §13 实体（目标管理） |
| §15 背包/物品 | — | §4 经济（货币）, §10 存档（持久化） |
| §16 生产/升级 | — | §4 经济（资源消耗）, §15 背包（产出物品）, §10 存档（进度保存） |

**校验规则**：选了某模块但 `requires` 中的依赖未选中 → 报错阻断。`optional` 未选中 → 仅 warning。

---

<!-- INDEX_END: 以上为索引部分（契约速查表 + 依赖图），codegen Step 2 只需读到此处。以下为各模块的完整实现，Step 4.1 按需读取。 -->

## 1. 状态机系统（State Machine）

几乎所有游戏都需要。管理游戏阶段、实体状态、AI 行为。

### 核心数据结构

```js
// 通用有限状态机
function createFSM(config) {
  const { initial, states, onTransition } = config;
  let current = initial;

  return {
    get state() { return current; },
    can(event) {
      const transitions = states[current]?.on || {};
      return event in transitions;
    },
    send(event, payload) {
      const transitions = states[current]?.on || {};
      const next = transitions[event];
      if (!next) return false;

      const prev = current;
      states[current]?.exit?.();
      current = next;
      states[current]?.enter?.(payload);
      onTransition?.({ from: prev, to: current, event, payload });
      return true;
    }
  };
}

// 用法示例
const gameFSM = createFSM({
  initial: "menu",
  states: {
    menu:    { on: { START: "playing" }, enter() { renderMenu(); } },
    playing: { on: { WIN: "victory", LOSE: "defeat", PAUSE: "paused" }, enter() { startGame(); } },
    paused:  { on: { RESUME: "playing" }, enter() { showPauseOverlay(); } },
    victory: { on: { RESTART: "playing", MENU: "menu" }, enter() { showVictory(); } },
    defeat:  { on: { RESTART: "playing", MENU: "menu" }, enter() { showDefeat(); } }
  },
  onTransition({ from, to, event }) {
    state.phase = to;  // 同步到 gameState
  }
});
```

### LLM 易错点
- ❌ 用字符串比较代替状态机（`if (state.phase === "playing" && ...)`满天飞）
- ❌ 忘记在状态切换时清理上一个状态的资源（定时器、事件监听）
- ✅ 每个状态有 `enter` 和 `exit` 钩子，资源在 `exit` 中清理

---

## 2. 战斗/伤害系统（Combat & Damage）

适用于：strategy-battle、platform-physics、single-reflex、roguelike 类游戏。

### 2.1 伤害计算公式

```js
const COMBAT = {
  // 基础伤害公式：攻击力 * 技能倍率 * (1 - 防御减伤) * 暴击倍率 * 随机波动
  calcDamage({ atk, skillMultiplier = 1, def = 0, critRate = 0, critMultiplier = 1.5 }) {
    const reduction = def / (def + 100);  // 防御减伤：100 防御 = 50% 减伤
    const isCrit = Math.random() < critRate;
    const critBonus = isCrit ? critMultiplier : 1;
    const fluctuation = 0.9 + Math.random() * 0.2;  // ±10% 波动
    const raw = atk * skillMultiplier * (1 - reduction) * critBonus * fluctuation;
    return {
      damage: Math.max(1, Math.round(raw)),  // 最低 1 点伤害
      isCrit,
    };
  },

  // 属性克制（可选）
  elementMultiplier(attackElement, defenseElement) {
    const chart = {
      fire:  { wind: 1.5, water: 0.5 },
      water: { fire: 1.5, wind: 0.5 },
      wind:  { water: 1.5, fire: 0.5 },
    };
    return chart[attackElement]?.[defenseElement] ?? 1;
  },

  // 检测是否命中（闪避）
  hitCheck(accuracy = 100, evasion = 0) {
    const hitRate = Math.max(0.1, (accuracy - evasion) / 100);
    return Math.random() < hitRate;
  }
};
```

### 2.2 打击感系统（Game Juice）

**这是让游戏"有感觉"的关键**。打击感 = 视觉反馈 + 时间操控 + 屏幕效果的组合。

```js
// 打击感配方：一次攻击命中时应触发的全部反馈
const JUICE = {
  // 帧冻结（Hit Stop）：命中瞬间暂停 2-5 帧，放大打击感
  hitStop(scene, durationMs = 50) {
    scene.time.timeScale = 0;  // Phaser: 暂停时间
    scene.time.delayedCall(durationMs, () => { scene.time.timeScale = 1; });
    // Canvas/DOM: 设标志位跳过 N 帧 update
  },

  // 击退（Knockback）：被击中单位向反方向位移
  knockback(entity, fromX, fromY, force = 60) {
    const angle = Math.atan2(entity.y - fromY, entity.x - fromX);
    entity.knockbackVx = Math.cos(angle) * force;
    entity.knockbackVy = Math.sin(angle) * force;
    entity.knockbackTimer = 150;  // ms 内衰减到 0
  },

  // 受击闪白：被打中瞬间整体变白 1-2 帧
  flashWhite(gameObject) {
    // Phaser
    gameObject.setTintFill(0xffffff);
    setTimeout(() => gameObject.clearTint(), 60);
    // PixiJS
    // gameObject.tint = 0xffffff; setTimeout(() => gameObject.tint = originalColor, 60);
  },

  // 伤害数字弹出（见 visual-styles.md Cookbook 的飘字）
  // 屏幕震动（见各引擎 guide 的 Cookbook）
  // 粒子爆发（见各引擎 guide 的 Cookbook）

  // 完整打击反馈组合（一次命中全套）
  onHit(scene, attacker, target, damage, isCrit) {
    // 1. 帧冻结
    this.hitStop(scene, isCrit ? 80 : 40);
    // 2. 受击闪白
    this.flashWhite(target.sprite);
    // 3. 击退
    this.knockback(target, attacker.x, attacker.y, isCrit ? 100 : 50);
    // 4. 屏幕震动
    scene.cameras.main.shake(isCrit ? 200 : 100, isCrit ? 0.015 : 0.005);
    // 5. 伤害飘字
    floatingText(scene, target.x, target.y - 20,
      isCrit ? `暴击 ${damage}!` : `-${damage}`,
      isCrit ? '#ff4444' : '#ffffff');
    // 6. 粒子（暴击时更多）
    emitParticles(target.x, target.y, isCrit ? 20 : 8);
  }
};
```

### LLM 易错点
- ❌ 只改血量数字，没有任何视觉/时间反馈（"数值游戏"感）
- ❌ 伤害 = atk - def 导致高防角色完全免伤
- ❌ 暴击只加伤害不加特效
- ✅ 每次命中至少触发 3 种以上反馈（闪白 + 震动 + 飘字）
- ✅ 暴击的反馈强度必须显著高于普通攻击

---

## 3. 等级/经验系统（Level & Experience）

适用于：RPG、Roguelike、养成、教育练习（进度）。

### 核心数据结构

```js
const LEVEL_SYSTEM = {
  // 经验曲线：每级所需经验 = 基础 * (1 + 增长率)^(level-1)
  expForLevel(level, base = 100, growthRate = 0.15) {
    return Math.floor(base * Math.pow(1 + growthRate, level - 1));
  },

  // 累积经验表（预计算，避免每次重算）
  buildExpTable(maxLevel, base = 100, growthRate = 0.15) {
    const table = [0];
    for (let i = 1; i <= maxLevel; i++) {
      table.push(table[i - 1] + this.expForLevel(i, base, growthRate));
    }
    return table;
  },

  // 加经验 + 检测升级
  addExp(entity, amount, expTable) {
    entity.exp += amount;
    let leveled = false;
    while (entity.level < expTable.length - 1 && entity.exp >= expTable[entity.level + 1]) {
      entity.level++;
      leveled = true;
      // 升级奖励（属性成长）
      entity.maxHp += entity.hpGrowth;
      entity.hp = entity.maxHp;  // 升级回满血
      entity.atk += entity.atkGrowth;
      entity.def += entity.defGrowth;
    }
    return leveled;
  },

  // 当前等级进度百分比（用于经验条 UI）
  expProgress(entity, expTable) {
    const currLevelExp = expTable[entity.level] || 0;
    const nextLevelExp = expTable[entity.level + 1] || currLevelExp + 100;
    return (entity.exp - currLevelExp) / (nextLevelExp - currLevelExp);
  }
};

// 实体模板
function createRPGEntity(config) {
  return {
    name: config.name,
    level: 1,
    exp: 0,
    hp: config.baseHp,
    maxHp: config.baseHp,
    atk: config.baseAtk,
    def: config.baseDef,
    hpGrowth: config.hpGrowth || 10,
    atkGrowth: config.atkGrowth || 2,
    defGrowth: config.defGrowth || 1,
    skills: config.skills || [],
    buffs: [],
  };
}
```

### LLM 易错点
- ❌ 线性经验曲线（每级都需要 100 经验）→ 后期升级太快无挑战
- ❌ 升级不回血/不给反馈 → 玩家感受不到升级的意义
- ✅ 经验曲线用指数或多项式递增
- ✅ 升级瞬间必须有明显视觉反馈（全屏闪光 + 属性飘字 + 音效）

---

## 4. 资源/经济循环（Economy & Resources）

适用于：simulation、strategy-battle、idle/clicker、RPG。

### 核心数据结构

```js
const ECONOMY = {
  // 资源定义
  createWallet(resources) {
    // resources: { gold: 100, gem: 0, energy: 50 }
    const wallet = { ...resources };
    return {
      get(type) { return wallet[type] || 0; },
      add(type, amount) { wallet[type] = (wallet[type] || 0) + amount; return wallet[type]; },
      spend(type, amount) {
        if (wallet[type] < amount) return false;  // 余额不足
        wallet[type] -= amount;
        return true;
      },
      canAfford(costs) {
        // costs: { gold: 50, gem: 10 }
        return Object.entries(costs).every(([type, amount]) => (wallet[type] || 0) >= amount);
      },
      batchSpend(costs) {
        if (!this.canAfford(costs)) return false;
        Object.entries(costs).forEach(([type, amount]) => { wallet[type] -= amount; });
        return true;
      },
      snapshot() { return { ...wallet }; }
    };
  },

  // 商店物品定义
  createShopItem(config) {
    return {
      id: config.id,
      name: config.name,
      description: config.description,
      cost: config.cost,         // { gold: 100 }
      effect: config.effect,     // 函数 (state) => { state.player.atk += 5 }
      maxBuy: config.maxBuy || Infinity,
      bought: 0,
      canBuy(wallet) {
        return this.bought < this.maxBuy && wallet.canAfford(this.cost);
      },
      buy(wallet, state) {
        if (!this.canBuy(wallet)) return false;
        wallet.batchSpend(this.cost);
        this.bought++;
        this.effect(state);
        return true;
      }
    };
  },

  // 生产循环（idle/clicker 核心）
  createProducer(config) {
    return {
      id: config.id,
      name: config.name,
      level: 0,
      output: config.baseOutput,       // 每秒产出
      outputGrowth: config.outputGrowth || 1.2,
      upgradeCost: config.baseCost,
      costGrowth: config.costGrowth || 1.5,

      produce(dt) {
        // dt 秒内的产出量
        return this.output * this.level * dt;
      },
      currentUpgradeCost() {
        return Math.floor(this.upgradeCost * Math.pow(this.costGrowth, this.level));
      },
      upgrade(wallet) {
        const cost = this.currentUpgradeCost();
        if (!wallet.spend("gold", cost)) return false;
        this.level++;
        this.output = Math.floor(this.output * this.outputGrowth);
        return true;
      }
    };
  }
};
```

### 资源循环设计原则

```
 [产出源] → 金币/资源 → [消耗口] → 能力提升 → 更高效产出
     ↑                                              |
     └──────────────────────────────────────────────┘
```

| 设计要点 | 说明 |
|---|---|
| **水龙头（产出）** | 击杀敌人、完成关卡、时间产出、点击 |
| **水池（存储）** | 钱包上限、仓库容量 |
| **排水口（消耗）** | 升级、购买、修理、抽卡 |
| **平衡** | 产出速度略低于玩家"想消耗"的速度 = 动力 |

### LLM 易错点
- ❌ 只有产出没有消耗口 → 资源堆积无意义
- ❌ 只有一种资源 → 决策点不够
- ❌ 升级费用线性增长 → 后期钱多到溢出
- ✅ 至少 2 种资源（基础资源 + 稀缺资源）
- ✅ 升级费用指数增长，产出也指数增长但略慢

---

## 5. 物理/碰撞系统（Physics & Collision）

适用于：platform-physics、single-reflex、弹幕、弹球、跑酷。

### 5.1 简易 2D 物理

```js
const PHYSICS = {
  // 基本运动：位置 += 速度 * dt；速度 += 加速度 * dt
  updateKinematics(entity, dt) {
    entity.vx = (entity.vx || 0) + (entity.ax || 0) * dt;
    entity.vy = (entity.vy || 0) + (entity.ay || 0) * dt;

    // 摩擦力
    if (entity.friction) {
      entity.vx *= (1 - entity.friction * dt);
      entity.vy *= (1 - entity.friction * dt);
    }

    // 速度上限
    if (entity.maxSpeed) {
      const speed = Math.hypot(entity.vx, entity.vy);
      if (speed > entity.maxSpeed) {
        entity.vx = (entity.vx / speed) * entity.maxSpeed;
        entity.vy = (entity.vy / speed) * entity.maxSpeed;
      }
    }

    entity.x += entity.vx * dt;
    entity.y += entity.vy * dt;
  },

  // 重力
  applyGravity(entity, gravity = 800, dt) {
    entity.vy += gravity * dt;
  },

  // 平台跳跃：地面检测 + 跳跃
  platformJump(entity, jumpForce = -400) {
    if (entity.grounded) {
      entity.vy = jumpForce;
      entity.grounded = false;
    }
  },

  // 土狼时间（Coyote Time）：离开平台后仍有短暂跳跃窗口
  coyoteJump(entity, jumpForce = -400, coyoteMs = 80) {
    const sinceGrounded = Date.now() - (entity.lastGroundedTime || 0);
    if (sinceGrounded < coyoteMs) {
      entity.vy = jumpForce;
      entity.grounded = false;
      entity.lastGroundedTime = 0;  // 只能用一次
    }
  },

  // 输入缓冲（Input Buffer）：按早了也能跳
  bufferJump(entity, jumpForce = -400, bufferMs = 100) {
    entity.jumpBufferTime = Date.now();
    // 在 grounded 检测时：
    // if (entity.grounded && Date.now() - entity.jumpBufferTime < bufferMs) { jump(); }
  }
};
```

### 5.2 碰撞检测

```js
const COLLISION = {
  // AABB 矩形碰撞
  rectVsRect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  },

  // 圆形碰撞
  circleVsCircle(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    const dist = Math.hypot(dx, dy);
    return dist < a.radius + b.radius;
  },

  // 点 vs 矩形（点击检测）
  pointInRect(px, py, rect) {
    return px >= rect.x && px <= rect.x + rect.w &&
           py >= rect.y && py <= rect.y + rect.h;
  },

  // 点 vs 圆形
  pointInCircle(px, py, circle) {
    return Math.hypot(px - circle.x, py - circle.y) < circle.radius;
  },

  // 分离向量（碰撞后推开）
  separateAABB(moving, fixed) {
    const overlapX = Math.min(moving.x + moving.w - fixed.x, fixed.x + fixed.w - moving.x);
    const overlapY = Math.min(moving.y + moving.h - fixed.y, fixed.y + fixed.h - moving.y);

    if (overlapX < overlapY) {
      moving.x += (moving.x < fixed.x) ? -overlapX : overlapX;
      moving.vx = 0;
    } else {
      if (moving.y < fixed.y) {
        moving.y -= overlapY;
        moving.grounded = true;  // 落在平台上
        moving.lastGroundedTime = Date.now();
      } else {
        moving.y += overlapY;
      }
      moving.vy = 0;
    }
  },

  // 批量碰撞检测（实体列表 vs 实体列表）
  checkGroupVsGroup(groupA, groupB, callback) {
    for (const a of groupA) {
      for (const b of groupB) {
        if (a.active !== false && b.active !== false && this.rectVsRect(a, b)) {
          callback(a, b);
        }
      }
    }
  }
};
```

### LLM 易错点
- ❌ 平台跳跃没有 Coyote Time → 操作手感差
- ❌ 碰撞后不做分离 → 实体嵌入墙壁/地板
- ❌ 用 dt 但不夹紧（dt 过大时穿墙）→ `dt = Math.min(dt, 0.033)`
- ❌ 物理更新在 draw 里 → 帧率影响游戏速度
- ✅ 平台跳跃必须实现 Coyote Time + Input Buffer
- ✅ 物理 update 固定步长（`const FIXED_DT = 1/60`）

---

## 6. 计时器/冷却/节奏系统（Timer & Cooldown）

适用于：几乎所有游戏。

### 核心数据结构

```js
const TIMER = {
  // 通用倒计时
  createCountdown(seconds, onTick, onEnd) {
    let remaining = seconds;
    let paused = false;

    return {
      get remaining() { return remaining; },
      get formatted() {
        const m = Math.floor(remaining / 60);
        const s = Math.floor(remaining % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      },
      update(dt) {
        if (paused || remaining <= 0) return;
        remaining = Math.max(0, remaining - dt);
        onTick?.(remaining);
        if (remaining <= 0) onEnd?.();
      },
      addTime(seconds) { remaining += seconds; },
      pause() { paused = true; },
      resume() { paused = false; },
      reset(seconds) { remaining = seconds; paused = false; }
    };
  },

  // 技能冷却管理器
  createCooldownManager() {
    const cooldowns = {};

    return {
      start(id, durationMs) {
        cooldowns[id] = { endTime: Date.now() + durationMs, duration: durationMs };
      },
      isReady(id) {
        return !cooldowns[id] || Date.now() >= cooldowns[id].endTime;
      },
      progress(id) {
        // 返回 0-1，1 = 冷却完毕
        if (!cooldowns[id]) return 1;
        const elapsed = Date.now() - (cooldowns[id].endTime - cooldowns[id].duration);
        return Math.min(1, elapsed / cooldowns[id].duration);
      },
      remaining(id) {
        if (!cooldowns[id]) return 0;
        return Math.max(0, cooldowns[id].endTime - Date.now());
      }
    };
  },

  // 波次/节奏控制（塔防、弹幕）
  createWaveController(waves) {
    // waves: [{ delay: 2000, enemies: [{type, count, interval}] }, ...]
    let currentWave = 0;
    let waveTimer = 0;
    let spawnQueue = [];

    return {
      get currentWave() { return currentWave; },
      get isComplete() { return currentWave >= waves.length && spawnQueue.length === 0; },

      update(dt, spawnCallback) {
        // 处理生成队列
        if (spawnQueue.length > 0) {
          spawnQueue[0].timer -= dt * 1000;
          if (spawnQueue[0].timer <= 0) {
            spawnCallback(spawnQueue[0].type);
            spawnQueue[0].remaining--;
            if (spawnQueue[0].remaining <= 0) spawnQueue.shift();
            else spawnQueue[0].timer = spawnQueue[0].interval;
          }
          return;
        }

        // 波次间隔
        if (currentWave < waves.length) {
          waveTimer += dt * 1000;
          if (waveTimer >= waves[currentWave].delay) {
            // 开始新波次
            const wave = waves[currentWave];
            spawnQueue = wave.enemies.map(e => ({
              type: e.type, remaining: e.count, interval: e.interval, timer: 0
            }));
            currentWave++;
            waveTimer = 0;
          }
        }
      }
    };
  }
};
```

---

## 7. 随机/掉落/生成系统（RNG & Loot）

适用于：Roguelike、RPG、策略、抽卡、随机关卡。

### 核心数据结构

```js
const RNG = {
  // 带种子的伪随机（可复现）
  seededRandom(seed) {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return s / 2147483647;
    };
  },

  // 权重随机选择
  weightedPick(items, rand = Math.random) {
    // items: [{ value: "sword", weight: 10 }, { value: "shield", weight: 5 }]
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = rand() * totalWeight;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item.value;
    }
    return items[items.length - 1].value;
  },

  // 稀有度掉落表
  createLootTable(config) {
    // config: { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 }
    const entries = Object.entries(config).map(([rarity, weight]) => ({ value: rarity, weight }));
    return {
      roll(rand = Math.random) {
        return RNG.weightedPick(entries, rand);
      },
      // 保底机制（pity）
      rollWithPity(state, pityThreshold = 50) {
        state.pityCounter = (state.pityCounter || 0) + 1;
        if (state.pityCounter >= pityThreshold) {
          state.pityCounter = 0;
          return "legendary";  // 保底
        }
        const result = this.roll();
        if (result === "legendary" || result === "epic") {
          state.pityCounter = 0;
        }
        return result;
      }
    };
  },

  // 洗牌（Fisher-Yates）
  shuffle(array, rand = Math.random) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  // 不重复随机选 N 个
  pickN(array, n, rand = Math.random) {
    return RNG.shuffle(array, rand).slice(0, n);
  },

  // 简易地牢房间生成（Roguelike）
  generateRooms(gridW, gridH, roomCount, rand = Math.random) {
    const rooms = [];
    for (let i = 0; i < roomCount; i++) {
      const w = 3 + Math.floor(rand() * 4);
      const h = 3 + Math.floor(rand() * 4);
      const x = Math.floor(rand() * (gridW - w));
      const y = Math.floor(rand() * (gridH - h));
      rooms.push({ x, y, w, h, connections: [] });
    }
    // 用最近邻连接房间
    for (let i = 0; i < rooms.length - 1; i++) {
      rooms[i].connections.push(i + 1);
      rooms[i + 1].connections.push(i);
    }
    return rooms;
  }
};
```

### LLM 易错点
- ❌ 用 `Math.random() < 0.01` 做稀有掉落 → 玩家可能永远抽不到
- ❌ 随机但不可种子化 → 无法复现 bug
- ✅ 稀有度掉落必须有保底机制
- ✅ 随机生成必须支持种子（至少 debug 模式下）

---

## 8. 难度曲线/关卡递进（Difficulty & Progression）

适用于：所有有关卡概念的游戏。

### 核心数据结构

```js
const DIFFICULTY = {
  // 线性递进：level 1 → 简单，level N → 难
  linearScale(level, base, increment) {
    return base + (level - 1) * increment;
  },

  // 指数递进：后期难度快速上升
  exponentialScale(level, base, factor = 1.1) {
    return Math.floor(base * Math.pow(factor, level - 1));
  },

  // S 曲线递进（推荐）：前期快速进入、中期平稳、后期加速
  sigmoidScale(level, maxLevel, minValue, maxValue) {
    const x = (level - maxLevel / 2) / (maxLevel / 6);  // 标准化到 [-3, 3]
    const sigmoid = 1 / (1 + Math.exp(-x));
    return minValue + (maxValue - minValue) * sigmoid;
  },

  // 动态难度调整（DDA）：根据玩家表现自动调节
  createDDA(config) {
    const {
      minDifficulty = 0.5,
      maxDifficulty = 2.0,
      adjustSpeed = 0.1,    // 每次调整幅度
      targetSuccessRate = 0.6  // 目标成功率
    } = config;

    let difficulty = 1.0;
    const history = [];  // 最近 N 次结果

    return {
      get difficulty() { return difficulty; },

      recordResult(success) {
        history.push(success ? 1 : 0);
        if (history.length > 10) history.shift();

        const recentRate = history.reduce((a, b) => a + b, 0) / history.length;

        if (recentRate > targetSuccessRate + 0.1) {
          difficulty = Math.min(maxDifficulty, difficulty + adjustSpeed);
        } else if (recentRate < targetSuccessRate - 0.1) {
          difficulty = Math.max(minDifficulty, difficulty - adjustSpeed);
        }
      },

      // 用当前难度缩放数值
      scale(baseValue) {
        return Math.round(baseValue * difficulty);
      }
    };
  },

  // 关卡配置生成器
  generateLevelConfig(level, maxLevel = 20) {
    return {
      level,
      enemyCount: DIFFICULTY.exponentialScale(level, 3, 1.15),
      enemyHp: DIFFICULTY.exponentialScale(level, 20, 1.2),
      enemyAtk: DIFFICULTY.linearScale(level, 5, 2),
      timeLimit: Math.max(30, 120 - level * 5),  // 逐步缩短时间
      rewardGold: DIFFICULTY.exponentialScale(level, 10, 1.3),
      rewardExp: DIFFICULTY.exponentialScale(level, 20, 1.25),
    };
  }
};
```

### LLM 易错点
- ❌ 所有关卡难度一样 → 没有成长感
- ❌ 纯线性增长 → 后期曲线太平
- ❌ 只增加数量不增加新机制 → 重复感
- ✅ 每 3-5 关引入一个新元素（新敌人/新机制/新障碍）
- ✅ Boss 关应该是前几关机制的综合考验

---

## 9. Buff/Debuff 状态效果系统

适用于：RPG、Roguelike、策略、MOBA。

### 核心数据结构

```js
const BUFF_SYSTEM = {
  // Buff 定义
  createBuff(config) {
    return {
      id: config.id,
      name: config.name,
      type: config.type,      // "buff" | "debuff"
      duration: config.duration,  // 秒，-1 = 永久
      remaining: config.duration,
      stackable: config.stackable || false,
      maxStack: config.maxStack || 1,
      stacks: 1,

      // 效果函数
      onApply: config.onApply || (() => {}),     // 施加时
      onTick: config.onTick || (() => {}),        // 每秒
      onRemove: config.onRemove || (() => {}),    // 移除时
      modifiers: config.modifiers || {},          // 属性修改 { atk: 1.2, speed: 0.8 }
    };
  },

  // Buff 管理器（挂在每个实体上）
  createBuffManager(entity) {
    const buffs = [];

    return {
      get all() { return buffs; },

      add(buffConfig) {
        const existing = buffs.find(b => b.id === buffConfig.id);
        if (existing && existing.stackable && existing.stacks < existing.maxStack) {
          existing.stacks++;
          existing.remaining = existing.duration;  // 刷新时间
          return;
        }
        if (existing && !existing.stackable) {
          existing.remaining = existing.duration;  // 刷新时间
          return;
        }
        const buff = BUFF_SYSTEM.createBuff(buffConfig);
        buffs.push(buff);
        buff.onApply(entity);
      },

      update(dt) {
        for (let i = buffs.length - 1; i >= 0; i--) {
          const buff = buffs[i];
          if (buff.duration !== -1) {
            buff.remaining -= dt;
            if (buff.remaining <= 0) {
              buff.onRemove(entity);
              buffs.splice(i, 1);
              continue;
            }
          }
          buff.onTick(entity, dt);
        }
      },

      // 计算属性修正值
      getModifiedStat(baseStat, statName) {
        let multiplier = 1;
        let flat = 0;
        for (const buff of buffs) {
          const mod = buff.modifiers[statName];
          if (mod) {
            if (typeof mod === 'number' && mod > 0 && mod < 5) multiplier *= mod * buff.stacks;
            else flat += mod * buff.stacks;
          }
        }
        return baseStat * multiplier + flat;
      },

      remove(buffId) {
        const idx = buffs.findIndex(b => b.id === buffId);
        if (idx >= 0) {
          buffs[idx].onRemove(entity);
          buffs.splice(idx, 1);
        }
      },

      has(buffId) { return buffs.some(b => b.id === buffId); }
    };
  }
};

// 预定义常用 Buff
const COMMON_BUFFS = {
  poison: { id: "poison", name: "中毒", type: "debuff", duration: 5, stackable: true, maxStack: 3,
    onTick: (entity, dt) => { entity.hp -= 3 * dt; } },

  shield: { id: "shield", name: "护盾", type: "buff", duration: 8,
    onApply: (e) => { e.shield = 30; },
    onRemove: (e) => { e.shield = 0; } },

  speedUp: { id: "speedUp", name: "加速", type: "buff", duration: 5,
    modifiers: { speed: 1.5 } },

  attackUp: { id: "attackUp", name: "攻击强化", type: "buff", duration: 10,
    modifiers: { atk: 1.3 } },

  stun: { id: "stun", name: "眩晕", type: "debuff", duration: 2,
    onApply: (e) => { e.canAct = false; },
    onRemove: (e) => { e.canAct = true; } },

  regen: { id: "regen", name: "再生", type: "buff", duration: 10,
    onTick: (entity, dt) => { entity.hp = Math.min(entity.maxHp, entity.hp + 5 * dt); } },
};
```

---

## 10. 存档/进度系统（Save & Progress）

适用于：所有需要保存进度的游戏。

### 核心数据结构

```js
const SAVE_SYSTEM = {
  // 保存到 localStorage
  save(key, data) {
    try {
      const payload = {
        version: 1,         // 存档版本号，用于迁移
        timestamp: Date.now(),
        data
      };
      localStorage.setItem(key, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn("存档失败:", e);
      return false;
    }
  },

  // 读取
  load(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      // 版本迁移（预留）
      // if (payload.version < CURRENT_VERSION) payload.data = migrate(payload.data);
      return payload.data;
    } catch (e) {
      console.warn("读档失败:", e);
      return null;
    }
  },

  // 自动存档（每 N 秒）
  createAutoSave(key, getDataFn, intervalSec = 30) {
    let timer = null;
    return {
      start() {
        timer = setInterval(() => {
          SAVE_SYSTEM.save(key, getDataFn());
        }, intervalSec * 1000);
      },
      stop() {
        if (timer) { clearInterval(timer); timer = null; }
      },
      saveNow() {
        SAVE_SYSTEM.save(key, getDataFn());
      }
    };
  },

  // 删除存档
  clear(key) { localStorage.removeItem(key); },

  // 检查是否有存档
  hasSave(key) { return localStorage.getItem(key) !== null; }
};
```

---

## 11. 对象池（Object Pool）

适用于：弹幕、粒子、频繁创建/销毁的实体。

```js
function createPool(factory, initialSize = 20) {
  const pool = [];
  const active = [];

  // 预创建
  for (let i = 0; i < initialSize; i++) {
    pool.push(factory());
  }

  return {
    get activeCount() { return active.length; },

    acquire() {
      const obj = pool.pop() || factory();
      obj.active = true;
      active.push(obj);
      return obj;
    },

    release(obj) {
      obj.active = false;
      const idx = active.indexOf(obj);
      if (idx >= 0) active.splice(idx, 1);
      pool.push(obj);
    },

    // 批量回收满足条件的对象
    releaseWhere(predicate) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (predicate(active[i])) {
          this.release(active[i]);
        }
      }
    },

    // 遍历活跃对象
    forEach(fn) {
      for (let i = active.length - 1; i >= 0; i--) {
        fn(active[i]);
      }
    }
  };
}

// 用法：子弹池
const bulletPool = createPool(() => ({
  active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 1
}));

function fireBullet(x, y, angle, speed, damage) {
  const b = bulletPool.acquire();
  b.x = x; b.y = y;
  b.vx = Math.cos(angle) * speed;
  b.vy = Math.sin(angle) * speed;
  b.damage = damage;
}

// 每帧更新
bulletPool.forEach(b => {
  b.x += b.vx * dt; b.y += b.vy * dt;
});
// 回收出界子弹
bulletPool.releaseWhere(b => b.x < 0 || b.x > W || b.y < 0 || b.y > H);
```

---

## 12. 寻路/AI 基础（Pathfinding & AI）

适用于：策略、塔防、RPG 敌人行为。

### 12.1 A* 寻路（格子地图）

```js
function astar(grid, start, end) {
  // grid[y][x] = 0 可走, 1 不可走
  const rows = grid.length, cols = grid[0].length;
  const open = [{ x: start.x, y: start.y, g: 0, h: 0, f: 0, parent: null }];
  const closed = new Set();

  function heuristic(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  function key(x, y) { return `${x},${y}`; }

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift();

    if (current.x === end.x && current.y === end.y) {
      const path = [];
      let node = current;
      while (node) { path.unshift({ x: node.x, y: node.y }); node = node.parent; }
      return path;
    }

    closed.add(key(current.x, current.y));

    const neighbors = [
      { x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }
    ];

    for (const n of neighbors) {
      if (n.x < 0 || n.x >= cols || n.y < 0 || n.y >= rows) continue;
      if (grid[n.y][n.x] === 1) continue;
      if (closed.has(key(n.x, n.y))) continue;

      const g = current.g + 1;
      const h = heuristic(n, end);
      const existing = open.find(o => o.x === n.x && o.y === n.y);
      if (!existing) {
        open.push({ x: n.x, y: n.y, g, h, f: g + h, parent: current });
      } else if (g < existing.g) {
        existing.g = g; existing.f = g + existing.h; existing.parent = current;
      }
    }
  }
  return null;  // 无路径
}
```

### 12.2 简易 AI 行为

```js
const AI = {
  // 巡逻：在 waypoints 之间来回走
  patrol(entity, waypoints, speed, dt) {
    const target = waypoints[entity.waypointIndex || 0];
    const dx = target.x - entity.x, dy = target.y - entity.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 5) {
      entity.waypointIndex = ((entity.waypointIndex || 0) + 1) % waypoints.length;
    } else {
      entity.x += (dx / dist) * speed * dt;
      entity.y += (dy / dist) * speed * dt;
    }
  },

  // 追踪玩家（超过距离就放弃）
  chase(entity, target, speed, dt, maxRange = 300) {
    const dx = target.x - entity.x, dy = target.y - entity.y;
    const dist = Math.hypot(dx, dy);

    if (dist > maxRange) return "lost";
    if (dist < entity.attackRange) return "attack";

    entity.x += (dx / dist) * speed * dt;
    entity.y += (dy / dist) * speed * dt;
    return "chasing";
  },

  // 简易状态 AI：idle → patrol → chase → attack → idle
  simpleFSM(entity, player, dt) {
    const dist = Math.hypot(player.x - entity.x, player.y - entity.y);
    switch (entity.aiState || "idle") {
      case "idle":
        if (dist < 200) entity.aiState = "chase";
        else if (Math.random() < 0.01) entity.aiState = "patrol";
        break;
      case "patrol":
        AI.patrol(entity, entity.patrolPoints, entity.speed * 0.5, dt);
        if (dist < 200) entity.aiState = "chase";
        break;
      case "chase":
        const result = AI.chase(entity, player, entity.speed, dt);
        if (result === "lost") entity.aiState = "idle";
        if (result === "attack") entity.aiState = "attack";
        break;
      case "attack":
        if (dist > entity.attackRange * 1.5) entity.aiState = "chase";
        // 攻击逻辑由外部处理
        break;
    }
  }
};
```

---

## 13. 实体注册/变换系统（Entity & Transform）

适用于：Roguelike、射击、塔防、平台跳跃——任何需要管理"游戏对象"的场景。

### 13.1 实体注册表

```js
// 轻量 ECS 风格实体管理：创建、销毁、按标签查询
function createEntityRegistry() {
  let nextId = 1;
  const entities = new Map();  // id → entity
  const tags = new Map();      // tag → Set<id>

  return {
    create(components = {}, entityTags = []) {
      const id = nextId++;
      const entity = { id, active: true, ...components };
      entities.set(id, entity);
      for (const tag of entityTags) {
        if (!tags.has(tag)) tags.set(tag, new Set());
        tags.get(tag).add(id);
      }
      return entity;
    },

    destroy(id) {
      entities.delete(id);
      for (const set of tags.values()) set.delete(id);
    },

    get(id) { return entities.get(id); },

    // 按标签查询（如 "enemy", "bullet", "pickup"）
    byTag(tag) {
      const ids = tags.get(tag);
      if (!ids) return [];
      return [...ids].map(id => entities.get(id)).filter(Boolean);
    },

    // 遍历所有活跃实体
    forEach(fn) {
      for (const e of entities.values()) {
        if (e.active !== false) fn(e);
      }
    },

    get count() { return entities.size; },

    // 批量销毁不活跃实体（GC）
    cleanup() {
      for (const [id, e] of entities) {
        if (e.active === false) this.destroy(id);
      }
    }
  };
}

// 用法
const registry = createEntityRegistry();
const player = registry.create(
  { x: 100, y: 200, hp: 100, speed: 150 },
  ["player"]
);
const enemy = registry.create(
  { x: 400, y: 200, hp: 50, speed: 80, aiState: "patrol" },
  ["enemy", "damageable"]
);

// 批量操作
registry.byTag("enemy").forEach(e => AI.simpleFSM(e, player, dt));
registry.byTag("damageable").forEach(e => checkDamage(e));
```

### 13.2 变换组件

```js
// 通用变换：位置、旋转、缩放、层级
function createTransform(x = 0, y = 0) {
  return {
    x, y,
    rotation: 0,       // 弧度
    scaleX: 1, scaleY: 1,
    pivotX: 0, pivotY: 0,  // 旋转/缩放中心偏移
    zIndex: 0,         // 排序层级
  };
}

// 按 zIndex 排序渲染
function sortByZIndex(entities) {
  return [...entities].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
}

// 距离工具
function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 朝向目标的角度
function angleTo(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// 线性插值移动（平滑跟随）
function lerpTo(entity, targetX, targetY, t = 0.1) {
  entity.x += (targetX - entity.x) * t;
  entity.y += (targetY - entity.y) * t;
}
```

### LLM 易错点
- ❌ 用数组 index 当 ID → 删除元素后 index 混乱
- ❌ 直接遍历数组删除元素 → 跳过元素或 index 越界
- ❌ 所有实体混在一个数组中没有分类 → 碰撞检测 O(n²) 爆炸
- ✅ 用 Map + 自增 ID，删除 O(1)
- ✅ 按 tag 分组查询，减少无效遍历

---

## 14. 技能/投射物系统（Ability & Projectile）

适用于：射击、Roguelike、RPG、塔防——任何有"释放技能"或"发射子弹"的游戏。

### 14.1 技能系统

```js
// 技能定义 + 冷却管理
function createAbilitySystem() {
  const abilities = new Map();  // abilityId → config

  return {
    register(id, config) {
      // config: { cooldown, manaCost, castTime, range, effect, projectile? }
      abilities.set(id, {
        ...config,
        lastUsedAt: -Infinity,
      });
    },

    canUse(id, caster, now) {
      const ability = abilities.get(id);
      if (!ability) return { ok: false, reason: "unknown_ability" };
      if (now - ability.lastUsedAt < ability.cooldown)
        return { ok: false, reason: "on_cooldown", remaining: ability.cooldown - (now - ability.lastUsedAt) };
      if (ability.manaCost && (caster.mp || 0) < ability.manaCost)
        return { ok: false, reason: "no_mana" };
      return { ok: true };
    },

    use(id, caster, target, now) {
      const check = this.canUse(id, caster, now);
      if (!check.ok) return check;

      const ability = abilities.get(id);
      ability.lastUsedAt = now;
      if (ability.manaCost) caster.mp -= ability.manaCost;

      // 如果是投射物技能，返回投射物参数让外部创建
      if (ability.projectile) {
        return {
          ok: true, type: "projectile",
          projectile: {
            ...ability.projectile,
            x: caster.x, y: caster.y,
            targetX: target.x, targetY: target.y,
          }
        };
      }
      // 直接效果技能
      if (ability.effect) {
        ability.effect(caster, target);
      }
      return { ok: true, type: "instant" };
    },

    // 获取冷却进度（0~1，UI 用）
    getCooldownProgress(id, now) {
      const ability = abilities.get(id);
      if (!ability) return 1;
      const elapsed = now - ability.lastUsedAt;
      return Math.min(1, elapsed / ability.cooldown);
    }
  };
}

// 用法
const abilities = createAbilitySystem();
abilities.register("fireball", {
  cooldown: 2000,
  manaCost: 20,
  projectile: { speed: 300, damage: 25, radius: 8, lifetime: 3000 }
});
abilities.register("heal", {
  cooldown: 5000,
  manaCost: 30,
  effect(caster) { caster.hp = Math.min(caster.hp + 40, caster.maxHp); }
});
```

### 14.2 投射物系统

```js
// 投射物管理：发射、移动、碰撞、回收
function createProjectileSystem(pool) {
  // pool: 对象池（§11），可选——没有就用数组
  const projectiles = [];

  return {
    spawn({ x, y, targetX, targetY, speed, damage, radius = 4, lifetime = 3000, piercing = false, owner }) {
      const angle = Math.atan2(targetY - y, targetX - x);
      const proj = {
        x, y, radius, damage, owner,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        active: true,
        spawnTime: Date.now(),
        lifetime,
        piercing,     // 是否穿透
        hitEntities: new Set(),  // 已命中的实体（穿透用）
      };
      projectiles.push(proj);
      return proj;
    },

    update(dt) {
      const now = Date.now();
      for (const p of projectiles) {
        if (!p.active) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // 超时销毁
        if (now - p.spawnTime > p.lifetime) p.active = false;
        // 出界销毁
        if (p.x < -50 || p.x > 850 || p.y < -50 || p.y > 650) p.active = false;
      }
    },

    // 检测投射物 vs 目标组
    checkHits(targets, onHit) {
      for (const p of projectiles) {
        if (!p.active) continue;
        for (const t of targets) {
          if (!t.active || t.active === false) continue;
          if (p.owner === t.id) continue;  // 不打自己
          if (p.hitEntities.has(t.id)) continue;  // 穿透时不重复命中
          const dist = Math.hypot(p.x - t.x, p.y - t.y);
          if (dist < p.radius + (t.radius || t.w / 2 || 16)) {
            onHit(p, t);
            p.hitEntities.add(t.id);
            if (!p.piercing) { p.active = false; break; }
          }
        }
      }
    },

    // 清理已失活投射物
    cleanup() {
      for (let i = projectiles.length - 1; i >= 0; i--) {
        if (!projectiles[i].active) projectiles.splice(i, 1);
      }
    },

    getActive() { return projectiles.filter(p => p.active); },
    get count() { return projectiles.filter(p => p.active).length; }
  };
}

// 用法
const projectiles = createProjectileSystem();

// 发射火球
const result = abilities.use("fireball", player, { x: mouseX, y: mouseY }, Date.now());
if (result.ok && result.type === "projectile") {
  projectiles.spawn({ ...result.projectile, owner: player.id });
}

// 每帧更新
projectiles.update(dt);
projectiles.checkHits(registry.byTag("enemy"), (proj, enemy) => {
  const { damage, isCrit } = COMBAT.calcDamage({ atk: proj.damage, def: enemy.def });
  enemy.hp -= damage;
  JUICE.onHit(scene, proj, enemy, damage, isCrit);
});
projectiles.cleanup();
```

### LLM 易错点
- ❌ 技能没有冷却 → 可以无限发射
- ❌ 投射物出界后不销毁 → 内存泄漏
- ❌ 穿透子弹每帧都对同一敌人造成伤害 → 用 hitEntities 去重
- ❌ 投射物用 `new Bullet()` 每次创建 → 高频场景卡顿，应用对象池
- ✅ 技能 `canUse` 检查在前，扣资源在后
- ✅ 投射物数量多时配合 §11 对象池

---

## 15. 背包/物品系统（Inventory & Item）

适用于：RPG、Roguelike、经营、合成、收集类游戏。

### 15.1 物品定义

```js
// 物品数据表（静态配置）
const ITEM_DB = {
  "sword-iron":   { name: "铁剑", type: "equipment", slot: "weapon", stats: { atk: 10 }, stackable: false, maxStack: 1 },
  "potion-hp":    { name: "生命药水", type: "consumable", effect: { heal: 50 }, stackable: true, maxStack: 99 },
  "wood":         { name: "木材", type: "material", stackable: true, maxStack: 999 },
  "coin":         { name: "金币", type: "currency", stackable: true, maxStack: Infinity },
  "ring-fire":    { name: "烈焰戒指", type: "equipment", slot: "accessory", stats: { atk: 5, critRate: 0.1 }, stackable: false },
};

function getItemDef(itemId) {
  return ITEM_DB[itemId] || null;
}
```

### 15.2 背包系统

```js
function createInventory(maxSlots = 20) {
  // 每个槽: { itemId, count } 或 null
  const slots = new Array(maxSlots).fill(null);

  return {
    // 添加物品，返回实际添加数量
    add(itemId, count = 1) {
      const def = getItemDef(itemId);
      if (!def) return 0;
      let remaining = count;

      // 先尝试叠加到已有槽
      if (def.stackable) {
        for (let i = 0; i < maxSlots && remaining > 0; i++) {
          if (slots[i]?.itemId === itemId && slots[i].count < def.maxStack) {
            const canAdd = Math.min(remaining, def.maxStack - slots[i].count);
            slots[i].count += canAdd;
            remaining -= canAdd;
          }
        }
      }

      // 再放入空槽
      for (let i = 0; i < maxSlots && remaining > 0; i++) {
        if (slots[i] === null) {
          const canAdd = def.stackable ? Math.min(remaining, def.maxStack) : 1;
          slots[i] = { itemId, count: canAdd };
          remaining -= canAdd;
        }
      }

      return count - remaining;  // 实际添加数量
    },

    // 移除物品
    remove(itemId, count = 1) {
      let remaining = count;
      for (let i = maxSlots - 1; i >= 0 && remaining > 0; i--) {
        if (slots[i]?.itemId === itemId) {
          const canRemove = Math.min(remaining, slots[i].count);
          slots[i].count -= canRemove;
          remaining -= canRemove;
          if (slots[i].count <= 0) slots[i] = null;
        }
      }
      return count - remaining;
    },

    // 查询拥有数量
    countOf(itemId) {
      return slots.reduce((sum, s) => s?.itemId === itemId ? sum + s.count : sum, 0);
    },

    has(itemId, count = 1) { return this.countOf(itemId) >= count; },

    // 获取指定槽
    getSlot(index) { return slots[index]; },

    // 交换两个槽
    swap(i, j) { [slots[i], slots[j]] = [slots[j], slots[i]]; },

    // 背包是否已满
    get isFull() { return slots.every(s => s !== null); },
    get freeSlots() { return slots.filter(s => s === null).length; },

    // 序列化（存档用）
    toJSON() { return slots.map(s => s ? { ...s } : null); },
    fromJSON(data) { data.forEach((s, i) => { slots[i] = s ? { ...s } : null; }); }
  };
}

// 用法
const inventory = createInventory(20);
inventory.add("potion-hp", 5);
inventory.add("wood", 100);
inventory.add("sword-iron");

if (inventory.has("potion-hp")) {
  inventory.remove("potion-hp", 1);
  player.hp = Math.min(player.hp + 50, player.maxHp);
}
```

### LLM 易错点
- ❌ 背包没有上限 → 无限存储破坏经济平衡
- ❌ 堆叠物品没有 maxStack → 一个格子存 9999999 个
- ❌ 移除物品时没检查数量 → 物品数量变负数
- ❌ 不可堆叠物品（装备）也走堆叠逻辑 → 多把剑合成一把
- ✅ add 返回实际添加数量，背包满时可反馈给玩家
- ✅ has() 检查在前，remove() 在后

---

## 16. 生产/升级/解锁系统（Production & Upgrade & Unlock）

适用于：经营模拟、放置游戏、塔防升级、RPG 装备强化。

### 16.1 生产系统

```js
// 生产队列：消耗资源 → 等待时间 → 产出资源/物品
function createProductionSystem(wallet) {
  const queue = [];  // { recipe, startTime, duration }

  return {
    // 开始生产
    start(recipe, now) {
      // recipe: { id, inputs: [{itemId, count}], outputs: [{itemId, count}], duration }
      // 检查资源
      for (const input of recipe.inputs) {
        if (!wallet.canAfford(input.itemId, input.count)) {
          return { ok: false, reason: "insufficient_resource", item: input.itemId };
        }
      }
      // 扣资源
      for (const input of recipe.inputs) {
        wallet.spend(input.itemId, input.count);
      }
      queue.push({ recipe, startTime: now, duration: recipe.duration });
      return { ok: true };
    },

    // 每帧检查完成
    update(now, onComplete) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const item = queue[i];
        if (now - item.startTime >= item.duration) {
          queue.splice(i, 1);
          onComplete(item.recipe);
        }
      }
    },

    // 获取队列进度
    getProgress(now) {
      return queue.map(item => ({
        id: item.recipe.id,
        progress: Math.min(1, (now - item.startTime) / item.duration),
        remaining: Math.max(0, item.duration - (now - item.startTime)),
      }));
    },

    get queueLength() { return queue.length; }
  };
}

// 用法（经营游戏）
const RECIPES = {
  "bread": { id: "bread", inputs: [{ itemId: "wheat", count: 2 }], outputs: [{ itemId: "bread", count: 1 }], duration: 5000 },
  "sword": { id: "sword", inputs: [{ itemId: "iron", count: 3 }, { itemId: "wood", count: 1 }], outputs: [{ itemId: "sword-iron", count: 1 }], duration: 10000 },
};
```

### 16.2 升级系统

```js
// 通用升级：建筑/技能/装备/角色 均可用
function createUpgradeSystem() {
  const upgrades = new Map();  // targetId → { level, maxLevel, costCurve, effectCurve }

  return {
    register(targetId, config) {
      // config: { maxLevel, baseCost, costScale, effects }
      upgrades.set(targetId, { level: 1, ...config });
    },

    // 获取下一级升级费用
    getUpgradeCost(targetId) {
      const u = upgrades.get(targetId);
      if (!u || u.level >= u.maxLevel) return null;
      // 费用曲线：baseCost * costScale ^ (level - 1)
      return Math.floor(u.baseCost * Math.pow(u.costScale, u.level - 1));
    },

    // 获取当前等级效果值
    getEffect(targetId) {
      const u = upgrades.get(targetId);
      if (!u) return null;
      // 效果曲线：返回每个效果在当前等级的值
      const result = {};
      for (const [key, curve] of Object.entries(u.effects)) {
        // curve: { base, perLevel } → base + perLevel * (level - 1)
        result[key] = curve.base + curve.perLevel * (u.level - 1);
      }
      return result;
    },

    // 执行升级（需外部检查并扣费）
    upgrade(targetId) {
      const u = upgrades.get(targetId);
      if (!u || u.level >= u.maxLevel) return false;
      u.level++;
      return true;
    },

    getLevel(targetId) { return upgrades.get(targetId)?.level || 0; },
    isMaxLevel(targetId) { const u = upgrades.get(targetId); return u ? u.level >= u.maxLevel : true; }
  };
}

// 用法（塔防升级炮塔）
const upgrades = createUpgradeSystem();
upgrades.register("tower-arrow", {
  maxLevel: 5,
  baseCost: 50,
  costScale: 1.8,     // 每级涨 80%
  effects: {
    damage: { base: 10, perLevel: 5 },   // 10, 15, 20, 25, 30
    range:  { base: 100, perLevel: 20 },  // 100, 120, 140, 160, 180
    fireRate: { base: 1, perLevel: 0.2 }, // 1.0, 1.2, 1.4, 1.6, 1.8
  }
});

// UI: 显示升级费用和效果预览
const cost = upgrades.getUpgradeCost("tower-arrow");  // 50, 90, 162, 291, null
const effects = upgrades.getEffect("tower-arrow");     // { damage: 10, range: 100, fireRate: 1 }
```

### 16.3 解锁系统

```js
// 条件解锁：根据游戏进度解锁新内容
function createUnlockSystem() {
  const unlocks = new Map();  // unlockId → { condition, unlocked }

  return {
    register(id, condition) {
      // condition: (gameState) => boolean
      unlocks.set(id, { condition, unlocked: false });
    },

    // 每次状态变化时检查所有未解锁项
    check(gameState) {
      const newUnlocks = [];
      for (const [id, u] of unlocks) {
        if (!u.unlocked && u.condition(gameState)) {
          u.unlocked = true;
          newUnlocks.push(id);
        }
      }
      return newUnlocks;  // 返回本次新解锁的 ID 列表
    },

    isUnlocked(id) { return unlocks.get(id)?.unlocked ?? false; },

    // 获取所有解锁状态（UI/存档用）
    getAll() {
      const result = {};
      for (const [id, u] of unlocks) result[id] = u.unlocked;
      return result;
    },

    // 从存档恢复
    restore(savedUnlocks) {
      for (const [id, unlocked] of Object.entries(savedUnlocks)) {
        if (unlocks.has(id)) unlocks.get(id).unlocked = unlocked;
      }
    }
  };
}

// 用法
const unlockSys = createUnlockSystem();
unlockSys.register("level-5", s => s.level >= 5);
unlockSys.register("first-boss", s => s.bossesDefeated >= 1);
unlockSys.register("shop", s => s.totalCoins >= 100);
unlockSys.register("hard-mode", s => s.gamesWon >= 3);

// 每次状态变化后
const newUnlocks = unlockSys.check(gameState);
if (newUnlocks.length) {
  newUnlocks.forEach(id => showUnlockNotification(id));
}
```

### 16.4 关卡推进（Level Progression）

```js
// 关卡解锁 + 星级评价 + 推进控制
function createLevelProgression(levelCount) {
  const levels = Array.from({ length: levelCount }, (_, i) => ({
    id: i + 1,
    unlocked: i === 0,  // 只有第1关默认解锁
    bestStars: 0,       // 0~3 星
    bestScore: 0,
    completed: false,
  }));

  return {
    // 完成某关后的结算
    complete(levelId, score, stars) {
      const level = levels[levelId - 1];
      if (!level) return;
      level.completed = true;
      level.bestScore = Math.max(level.bestScore, score);
      level.bestStars = Math.max(level.bestStars, stars);

      // 解锁下一关
      if (levelId < levelCount) {
        levels[levelId].unlocked = true;
      }
    },

    // 星级评价计算（通用）
    calcStars(score, thresholds) {
      // thresholds: [1星阈值, 2星阈值, 3星阈值]
      if (score >= thresholds[2]) return 3;
      if (score >= thresholds[1]) return 2;
      if (score >= thresholds[0]) return 1;
      return 0;
    },

    getLevel(id) { return levels[id - 1]; },
    isUnlocked(id) { return levels[id - 1]?.unlocked ?? false; },
    get totalStars() { return levels.reduce((s, l) => s + l.bestStars, 0); },
    get completedCount() { return levels.filter(l => l.completed).length; },

    toJSON() { return levels.map(l => ({ ...l })); },
    fromJSON(data) { data.forEach((d, i) => Object.assign(levels[i], d)); }
  };
}

// 用法
const progression = createLevelProgression(30);
// 通关第1关
const stars = progression.calcStars(850, [500, 700, 900]);  // 2星
progression.complete(1, 850, stars);
// 第2关自动解锁
```

### LLM 易错点
- ❌ 升级费用不递增 → 高级建筑太便宜，经济崩溃
- ❌ 生产消耗资源后中途取消，资源不退还
- ❌ 解锁条件用 `===` 精确匹配 → `>=` 才稳健（可能跳过某个精确值）
- ❌ 关卡推进没有持久化 → 刷新后进度丢失
- ✅ 升级费用用指数曲线（`baseCost * scale^level`）
- ✅ 解锁系统返回新解锁列表，方便触发通知/动画

---

## 模块组合指南

codegen 时根据 GamePRD 的 `@system` 和 `@rule` 标签，从上面按需组合：

| 游戏需求 | 需要的模块 |
|---|---|
| 有血量/攻击 | §2 战斗 + §9 Buff |
| 有等级/成长 | §3 等级 + §8 难度曲线 |
| 有金币/商店 | §4 资源循环 |
| 有跳跃/移动 | §5 物理碰撞 |
| 有倒计时/冷却 | §6 计时器 |
| 有随机掉落/地图 | §7 随机系统 |
| 有大量子弹/粒子 | §11 对象池 |
| 有敌人巡逻/追踪 | §12 寻路 AI |
| 有进度保存 | §10 存档 |
| 有多种游戏对象 | §13 实体/变换 |
| 有技能/子弹/飞行物 | §14 技能/投射物 |
| 有背包/装备/物品 | §15 背包/物品 |
| 有建筑升级/生产/解锁 | §16 生产/升级/解锁 |
| **所有游戏** | §1 状态机 |

**按游戏类型的推荐模块组合**：

| 游戏类型 | 推荐模块 |
|---|---|
| Roguelike | §1 + §2 + §3 + §5 + §7 + §8 + §9 + §11 + §12 + §13 + §14 + §15 |
| 射击/弹幕 | §1 + §2 + §5 + §6 + §11 + §13 + §14 |
| 平台跳跃 | §1 + §2 + §3 + §5 + §6 + §8 + §13 |
| 塔防 | §1 + §2 + §4 + §6 + §12 + §13 + §14 + §16 |
| 经营模拟 | §1 + §4 + §6 + §10 + §15 + §16 |
| 放置/挂机 | §1 + §3 + §4 + §6 + §10 + §16 |
| RPG | §1 + §2 + §3 + §4 + §7 + §9 + §10 + §13 + §14 + §15 |
| 卡牌/棋盘 | §1 + §6 + §7 + §8 + §9 + §15 |
| 消除/配对 | §1 + §6 + §7 + §8 |
| 教育/答题 | §1 + §3 + §6 + §7 + §8 |

**重要**：这些模块是**参考实现**，不是必须原样复制。LLM 应理解每个模块的核心逻辑，根据具体游戏需求调整参数和结构。模块间可以自由组合——一个 Roguelike 可能需要 §1+§2+§3+§5+§7+§8+§9+§11+§12 的组合。
