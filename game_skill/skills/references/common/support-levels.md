# 支持等级判定规则

Phase 2 末尾 strategy 回写时，从以下规则判定 `support-level`。每条 case 只属于 3 个等级之一。

判定时不能只看“能否做一个最小闭环”，还要同时看：

- 用户要求的 `delivery-target`
- 用户点名的 `must-have-features`
- 当前是否需要对这些功能做 lite 化或延后

---

## 等级定义

### 直接支持

**判定条件（全部满足）**：

1. `genre` 属于 9 大类 enum 且**不处于能力边界**（见下）
2. 至少一个引擎在 `_index.json.best-fit` 中匹配该 genre
3. 无 hard-rule 与候选引擎能力冲突
4. 所有 `must-have-features` 都能在当前 `delivery-target` 下落地
5. 校验可通过 `window.gameState` + Playwright 自动断言

**处理**：正常走 Phase 3/4/5，产出完整交付物。

### 降级支持

**判定条件（任一满足）**：

1. `genre` 有匹配引擎但能力擦边（如 roguelike 在 phaser3 下 MVP 必须裁剪到 1 职业 + 1 层地图）
2. 用户 prompt 含复杂需求（如完整词缀系统、100 个单位、多层随机生成），需要大量裁剪到 MVP
3. 某些 hard-rule 只能近似实现（如"完美物理"→ 用 AABB 代替）
4. 需要引入额外库（如 Matter.js 做物理），但主引擎不支持直接集成
5. 某些 `must-have-features` 只能做 **lite 版** 实现，而不是完整强度实现
6. 为了贴近用户预期，需要保留系统数，但必须压缩内容量/数值深度/表现层

**处理**：
- Phase 2 `mvp-scope` 写得更细，明确哪些功能是保留、lite 化、后放
- `risk-note` 写清楚降级点，尤其是用户点名功能若被压缩，必须显式标出来
- 用户见到 support-level 后可以选择接受降级或换引擎；不得静默推进
- Phase 3/4/5 继续，但 Phase 5 的产品侧断言会宽容处理近似实现

### 暂不支持

**判定条件（任一满足）**：

1. 需要真实多人联机（需要后端，V0 `need-backend: false` 原则）
2. 需要原生移动端特性（蓝牙、陀螺仪、摄像头 AR 等）
3. 需要大型 AI / 训练模型（对战 AI、语音识别）
4. 需要极高性能（>200 个同屏实体 + 60fps 硬要求）
5. 依赖付费 SDK / 商业引擎（Cocos、Unity）

**处理**：

- Phase 2 stop at strategy，`support-level: 暂不支持`
- `risk-note` 写明拒绝原因
- `task_done` 告知用户：当前版本不能做，列出 3 个可选降级方向
- **不**进入 Phase 3/4/5

---

## 判定示例

| 用户 query | genre | support-level | 理由 |
|---|---|---|---|
| 「做个贪吃蛇」 | board-grid | 直接支持 | canvas 完美适配，200 行足够 |
| 「单词消消乐」 | edu-practice | 直接支持 | dom-ui 最佳，玩法闭环简单 |
| 「类暗黑 Roguelike，完整职业/词缀系统」 | strategy-battle | 降级支持 | phaser3 能跑但 MVP 必须裁到 1 职业 |
| 「2 人蓝牙炸飞机」 | social-multi | 暂不支持 | 原生蓝牙 + P2P，不在 V0 能力内 |
| 「3D FPS」 | single-reflex (3D) | 降级支持 | Three.js 可做轻量 3D，复杂 FPS 需裁剪到小场景 + 离散碰撞 |
| 「3D 走迷宫第一人称」 | platform-physics (3D) | 直接支持 | Three.js + PointerLockControls，is-3d=true |
| 「你画我猜（本地 2 人）」 | social-multi | 降级支持 | 本地轮流可做，多人联机不行 |
| 「魔塔」 | strategy-battle | 直接支持 | dom-ui 或 canvas 都行 |

---

## 检查脚本可验证字段

`check_game_prd.js` 会检查：

- `support-level` 值合法（3 个之一）
- `engine-plan.runtime` 在 `_index.json` 白名单
- `engine-plan.version-pin` 格式合法（不能是 `@latest`）

不会自动判定 level——这是**主 agent 的职责**，脚本只校验字段合法性。

---

## 降级的具体手法（供 Phase 2 strategy 参考）

| 降级维度 | 手法 |
|---|---|
| 实体数量 | 100 → 20；多 wave → 单 wave |
| 职业/角色数 | 3 → 1（选最有代表性的） |
| 物理精度 | 连续碰撞 → AABB 离散 |
| 随机生成 | 复杂 dungeon → 固定 1-2 层 |
| UI 复杂度 | 5 个 tab → 1 页主界面 |
| 资源依赖 | 图片精灵 → 内联 SVG / emoji |
| 音效 | 完整音轨 → 简单 WebAudio beep |

降级的每一条都必须在 GamePRD §3 MVP 章节和 front-matter `mvp-scope` / `risk-note` 显式记录，不得静默裁剪。

---

## 裁剪优先级（防止误伤用户预期）

默认裁剪顺序：

1. 先缩内容量
2. 再缩数值/变体复杂度
3. 再缩视觉和演出
4. 最后才动用户点名核心系统

如果第 4 步不可避免：

- 需要把该功能写进 `risk-note`
- `support-level` 至少为 `降级支持`
- 若用户明确说“必须有”，应优先回问，而不是静默删掉
