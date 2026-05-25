# DESIGN.md

> 这是本 case 的视觉与体验设计契约。Phase A 先把 4 个必填 anchor 写完整，
> Phase B 按这份文档决定调色、布局、反馈强度和节奏。
>
> 必填 anchor: `visualIdentity` / `uiSurfaces` / `coreLoop` / `mustAvoid`
> 选填 anchor: `temporalShape`

## visualIdentity

```yaml
visualIdentity:
  palette:
    background: '#<hex>'    # 主背景
    primary: '#<hex>'       # 玩家、主体、主要可交互对象
    secondary: '#<hex>'     # 敌方、障碍、次级对象
    accent: '#<hex>'        # 收集物、成功、强调
    danger: '#<hex>'        # 失败、受伤、警告
  motif: <一句话视觉气质锚点>
```

写作要求：

- `motif` 写一个可观察的真实场景，不写空泛形容词。
- 好例子：`暴雨夜车站站台上的霓虹倒影`、`清晨厨房桌面上的纸质字谜`、`山谷里逐层亮灯的小镇`。
- 避免只写：`科技风`、`可爱风`、`暗黑风`、`高级感`。

## uiSurfaces

```yaml
uiSurfaces:
  primary:
    description: <主 UI 表面 + 出现时机>
    elements: [<元素 1>, <元素 2>, <元素 3>]
  secondary:
    description: <次 UI 表面 + 出现时机>
    elements: [<元素 1>, <元素 2>]
  feedback:
    description: <短暂反馈表面 + 出现时机>
    elements: [<飘字>, <闪光>, <提示条>]
```

写作要求：

- `primary` 只放玩家每秒都要看的信息，比如 HUD、棋盘、牌面、建造栏。
- `secondary` 放低频表面，比如暂停、商店、升级选择、结算。
- `feedback` 放短暂反馈，不要让它遮住主输入区域。

## coreLoop

```yaml
coreLoop:
  primaryAction: <玩家反复做的事>
  successSignal: <做对后的即时反馈>
  failureSignal: <失败或受挫后的即时反馈>
  iterationFeel: <反复执行时应该累积出的感觉>
```

写作要求：

- `primaryAction` 写成动作链，不写品类名。例：`移动挡板接球并反弹到砖块`。
- `successSignal` 必须能转译成画面或状态变化。例：`砖块碎裂 + 分数跳动 + 球速轻微上升`。
- `failureSignal` 要能被玩家立即理解。例：`资源不足时建筑半透明回退 + 红色 X 提示`。
- `iterationFeel` 写体验走向。例：`每次命中都让可用空间变清楚，最后形成收束感`。

## temporalShape (选填)

```yaml
temporalShape:
  shape: <linear-escalation | wave-based | level-based | endless | sandbox | narrative-arc | session-bounded>
  description: <时间结构与数值节奏>
```

写作要求：

- 实时游戏写清波次、倒计时、敌人增长或关卡长度。
- 回合或解谜游戏写清尝试次数、关卡边界、失败后是否重开。
- 沙盒游戏写清短期收益循环和长期目标，而不是写“无限玩”。

## mustAvoid

至少 3 条，必须包含 `default-purple-blue-orbs`：

- default-purple-blue-orbs       # 不要用默认蓝紫圆点审美糊弄所有品类
- <case 专属禁忌 1>
- <case 专属禁忌 2>
- <case 专属禁忌 3>

写作要求：

- 禁忌要具体到画面或交互。例：`不要让敌弹和玩家子弹同色`。
- 如果 query 点名了某个真实作品，必须写一条“不照搬原作素材和商标”的禁忌。
- 如果玩法靠阅读或推理，必须写一条“不要让装饰遮挡信息”的禁忌。

---

## 跨品类样例

### 雷霆战机 (vertical scrolling shooter)

```yaml
visualIdentity:
  palette: { background: '#081026', primary: '#4af0ff', secondary: '#ff4d5a', accent: '#ffd166', danger: '#ff1f5a' }
  motif: 深空航道里，驾驶舱玻璃映着敌机爆炸后的冷光碎片
uiSurfaces:
  primary: { description: 全程显示的战斗 HUD, elements: [生命, 火力等级, 分数, boss 血条] }
  secondary: { description: 波次间短暂停顿, elements: [升级选项, 下一波提示] }
  feedback: { description: 命中和受击瞬间, elements: [爆炸粒子, 飘分, 红闪, 警告横幅] }
coreLoop:
  primaryAction: 左右移动战机，持续开火，闪避敌弹
  successSignal: 敌机爆炸 + 分数飘起 + 火力条增长
  failureSignal: 战机闪烁 + 屏幕红闪 + 生命扣除
  iterationFeel: 清屏后的爽快感和下一波更密弹幕的压迫感交替出现
temporalShape:
  shape: wave-based
  description: 每 30-45 秒一波，普通敌机数量 +20%，每 5 波出现 boss
mustAvoid:
  - default-purple-blue-orbs
  - 不要让敌弹和玩家子弹同色
  - 不要让 boss 没有血条或入场提示
```

### Wordle (word puzzle)

```yaml
visualIdentity:
  palette: { background: '#ffffff', primary: '#787c7e', secondary: '#c9b458', accent: '#6aaa64', danger: '#d3d6da' }
  motif: 清晨餐桌上的纸质字谜，答案像铅字一样逐行显形
uiSurfaces:
  primary: { description: 中央字母格与虚拟键盘, elements: [6 行格子, 键盘, 当前行光标] }
  secondary: { description: 结算和规则提示, elements: [结果弹窗, 统计, 再来一局] }
  feedback: { description: 提交后的局部反馈, elements: [翻牌, 抖动, 键盘染色] }
coreLoop:
  primaryAction: 输入单词，提交，读取颜色线索，再缩小候选
  successSignal: 字母翻绿 + 行完成 + 键盘同步染色
  failureSignal: 非法词抖动 + 行不推进
  iterationFeel: 从不确定到逐步收敛，最后一次提交要有悬念
temporalShape:
  shape: session-bounded
  description: 6 次机会，猜中即胜，耗尽机会显示答案
mustAvoid:
  - default-purple-blue-orbs
  - 不要用装饰动画打断读字
  - 不要让黄绿灰语义不一致
```

### 城市建造 (city builder)

```yaml
visualIdentity:
  palette: { background: '#a8d5e2', primary: '#2f9e44', secondary: '#fab005', accent: '#fd7e14', danger: '#e03131' }
  motif: 山谷晨雾散开后，一片空地逐格长出屋顶、道路和灯火
uiSurfaces:
  primary: { description: 地图和资源栏常驻, elements: [金币, 人口, 电力, 建筑栏, 地块格] }
  secondary: { description: 建筑详情或升级面板, elements: [产出, 消耗, 升级按钮] }
  feedback: { description: 放置与收益反馈, elements: [落地弹跳, 资源飘字, 需求气泡] }
coreLoop:
  primaryAction: 选择建筑，放到合适地块，等待资源回流，再扩建
  successSignal: 建筑落地动画 + 收益数字跳动 + 周边道路亮起
  failureSignal: 资源不足或地块不合法时红色轮廓回退
  iterationFeel: 从空地到街区的可见成长，每次放置都让规划更清楚
temporalShape:
  shape: sandbox
  description: 30 秒内形成第一条收益循环，后续由人口和资源瓶颈推动扩张
mustAvoid:
  - default-purple-blue-orbs
  - 不要让所有建筑只是不同颜色矩形
  - 不要让资源变化没有飘字或栏位动效
```

### 吸血鬼幸存者 (survival arena)

```yaml
visualIdentity:
  palette: { background: '#152018', primary: '#f1e8c8', secondary: '#7a2e2e', accent: '#7bd389', danger: '#e63946' }
  motif: 月下荒野里的篝火逐渐被怪潮围住，经验宝石像萤火一样散落
uiSurfaces:
  primary: { description: 战斗 HUD 与升级进度, elements: [生命, 经验条, 计时器, 击杀数] }
  secondary: { description: 升级暂停选择, elements: [三选一技能, 当前武器列表] }
  feedback: { description: 击杀和升级反馈, elements: [宝石吸附, 范围脉冲, 升级闪屏] }
coreLoop:
  primaryAction: 控制走位，自动攻击，收集经验，选择升级
  successSignal: 怪物成片消散 + 经验宝石吸附 + 等级提升
  failureSignal: 被包围时生命条红闪 + 击退不足 + 危险音效提示
  iterationFeel: 从被追逐到反过来切开怪潮的成长感
temporalShape:
  shape: endless
  description: 每 60 秒提升怪物密度和血量，升级选择提供阶段性喘息
mustAvoid:
  - default-purple-blue-orbs
  - 不要把主要操作写成手动瞄准射击
  - 不要让经验宝石和敌人尸体颜色混在一起
```
