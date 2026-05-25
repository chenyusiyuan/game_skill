# decisions.md

> 这是 decision log / rationale log，不是 chain-of-thought dump。
>
> 只记录可复核的外显内容：决策结论、依据、权衡、后续风险。
> 不要求、也不允许记录私密推理过程。

## A. 设计期决策 (Phase A 写，5-15 条 Q&A)

每条 Q&A 标来源标签：

- `from-query`：用户原文明确给出。
- `from-genre-knowledge`：来自品类公约或常识。
- `from-reasoning`：根据当前 case 的约束做出的现场判断。

### A.1 OpenGame 交互原型识别 — 来源: <from-query | from-genre-knowledge | from-reasoning>

**Q**: 用户 query 最接近哪个 OpenGame 五交互原型？如果不属于五原型，是否需要自行设计？

**A**: <结论。只从 platformer / top_down / grid_logic / tower_defense / ui_heavy 中选择，或写“未加载 primer，自行设计”。例：类幸存者生存割草是 top_down；推箱子是 grid_logic；卡牌/剧情/问答是 ui_heavy。>

**依据**: <引用 query 中的物理、视角、输入结构、状态推进方式，而不是题材名。>

**风险**: <误判会带来的实现偏差。>

### A.2 视觉意象锚点 — 来源: <from-query | from-genre-knowledge | from-reasoning>

**Q**: 这个 case 的 `visualIdentity.motif` 用什么真实场景描述？

**A**: <一句可观察的视觉意象。>

**依据**: <为什么这个意象服务于玩法。>

**风险**: <如果过暗、过花、过拟真，会影响什么。>

### A.3 UI 表面优先级 — 来源: <from-query | from-genre-knowledge | from-reasoning>

**Q**: 玩家每秒都必须看到的信息是什么？哪些信息可以放到低频面板？

**A**: <primary / secondary / transient 的结论。>

**依据**: <玩法中哪些信息驱动下一次输入。>

**风险**: <信息过多或过少的后果。>

### A.4 桌面画布与布局取舍 — 来源: <from-query | from-genre-knowledge | from-reasoning>

**Q**: 这个 case 使用 960×720、1280×720 还是 800×600？为什么这个尺寸适合当前玩法？

**A**: <默认选 960×720；需要宽视野时选 1280×720；紧凑玩法可选 800×600 并说明信息密度足够。>

**依据**: <玩家视野、HUD 密度、目标数量、操作精度、smoke viewport 的取舍。>

**风险**: <画布过小会模糊或拥挤；过大会增加 headless pixel readback 压力。>

### A.5 暂停与继续体验 — 来源: <from-genre-knowledge | from-reasoning>

**Q**: 暂停界面如何落地，暂停时需要展示哪些核心信息？

**A**: <Escape/P 切换暂停；显示遮罩、继续提示、核心操作说明；恢复后不重置进度。>

**依据**: <桌面试玩默认需要可中断；暂停不应破坏主循环状态。>

**风险**: <若暂停只停视觉不停止计时/物理，会造成恢复后状态跳变。>

### A.6 主闭环与成功信号 — 来源: <from-query | from-genre-knowledge | from-reasoning>

**Q**: `coreLoop.primaryAction` 和 `coreLoop.successSignal` 分别是什么？

**A**: <动作链 + 成功反馈。>

**依据**: <对应 rawQuery 的哪一项最低体验。>

**风险**: <如果反馈太弱，delivery 过了但体验仍会怎样。>

### A.7 必须避开的反例 — 来源: <from-query | from-genre-knowledge | from-reasoning>

**Q**: `mustAvoid` 中除 `default-purple-blue-orbs` 外，还要禁止哪些具体失败形态？

**A**: <至少两条 case 专属禁忌。>

**依据**: <为什么这些禁忌会破坏该 case。>

**风险**: <若 Phase B 忘记，会造成什么可见问题。>

### A.N 其他设计期 Q&A

继续用同一格式补充，总数保持 5-15 条。推荐覆盖：数值节奏、关卡边界、失败反馈、素材抽象、阅读负担、是否延后某些非主闭环需求。

---

## B. 实现期决策 (Phase B 写，in-flight 增条)

每当新增文件、合并职责、删除复杂度或调整数值，补一条外显记录。

### B.1 文件与职责 — 来源: <from-plan | from-design | from-reasoning>

**决策**: <实际拆成哪些文件或模块，每个负责什么。>

**与计划差异**: <如无差异写“无”。如有差异，写清为何合并、删减或改名。>

**风险**: <后续扩展或维护可能遇到的问题。>

### B.2 数值选择 — 来源: <from-design | from-genre-knowledge | from-reasoning>

**决策**: <速度、血量、波次、分数、冷却、计时等关键起点。>

**依据**: <来自 query、primer 或 DESIGN.md 的哪条约束。>

**风险**: <过快、过慢、过密、过稀会怎样。>

### B.3 反馈实现取舍 — 来源: <from-design | from-reasoning>

**决策**: <哪些反馈已实现，哪些延后。>

**依据**: <哪些反馈服务主闭环证据，哪些只是增强体验。>

**风险**: <延后项对后续演进的影响。>

### B.N 其他实现期决策

继续用同一格式补充。不要写内心过程，只写可检查的结论、依据和风险。

---

## C. Retrospective (Phase C 后写，可选但建议)

读 delivery 结果、截图路径、summary、warning 和质量提示后，再写复盘。

### C.1 如果重来我会改的事

- <例：某个成功信号太弱，下次会把粒子数量从 8 提到 18。>
- <例：某个 UI 元素不该常驻，应该放到低频面板。>

### C.2 质量指标读后感

- <例：颜色数量偏少，下一轮增加敌方和奖励的差异化色。>
- <例：canvas 有变化但 milestone 后画面趋静，下一轮增加持续状态反馈。>

### C.3 scope 自评

- from-query 标记的核心项：<完成 / 延后 / 放弃及理由>。
- from-genre-knowledge 标记的品类项：<完成 / 延后 / 放弃及理由>。
- from-reasoning 标记的现场判断：<哪些被验证，哪些需要后续修正>。

## 命名约束

- 推荐称呼：`decision log` / `rationale log` / `design notes` / `implementation notes`。
- 禁用称呼：任何暗示记录私密推理过程的命名。
- 本文档是外显决策记录，不是私密推理复刻。
