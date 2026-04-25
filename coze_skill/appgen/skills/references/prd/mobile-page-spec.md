# Mobile PRD 规范

生成 Mobile 端 `docs/prd.md` 时遵循此规范。APRD 通用格式（tag 语法、属性字段）见 [aprd-format.md](aprd-format.md)。

---

## 文档章节结构

```
front-matter
## 1. 产品概述
## 2. 用户角色          ← auth-mode: login 时必须；anonymous/none 时省略
## 3. 用户流程
## 4. 功能规格
## 5. 数据模型          ← need-backend: true 时必须；否则省略
## 6. 服务端模块        ← need-backend: true 时必须；否则省略
## 7. API 接口          ← need-backend: true 时必须；否则省略
## 8. 页面规格
   ### 8.1 全局导航
   ### 8.2 页面详情
```

---

## Front-matter 判断

```yaml
platform: [mobile]        # 或 [web, mobile] 多端时
stack:
  server: nextjs          # 有后端时
  mobile: expo
```

`auth-mode` 判断：
- 用户需要保存个人数据 → `login`
- 用户明确不需要登录但有后端 → `anonymous`（所有用户共享数据）
- 用户明确不要后端 → `none`，`need-backend: false`
- 模糊需求 → 倾向 `login` + `need-backend: true`

---

## 用户角色（§2）

只在 `auth-mode: login` 时生成此节。

**@role 是系统权限角色，不是用户群体描述**：
- ✅ `@role(user)` 普通用户 → 有权限意义
- ❌ `@role(pregnant-woman)`、`@role(student)`、`@role(pet-owner)` → 用户画像，不是权限角色

Mobile 工具类/个人应用通常只有 `@role(user)`，不需要 admin。
只有应用有内容后台（PGC 管理）时才引入 `@role(admin)`。

---

## 全局导航（§8.1）

Mobile 端必须生成 `@nav(mobile-tabbar)`（有 tabbar 的应用）：

```markdown
### @nav(mobile-tabbar) 底部导航

> type: tabbar
> platform: mobile

- @mobile-page(/) 首页 | icon: home
- @mobile-page(/discover) 发现 | icon: compass
- @mobile-page(/profile) 我的 | icon: person
```

**Tabbar 原则**：
- Tab 数量 3-5 个，建议奇数（便于中心对称）
- 每个 tab 对应一个顶层 `@mobile-page`，tab 名称与页面名称一致
- Tab 只能指向无必需参数的页面（不含 `?xxx_id`）
- 特殊样式按钮（凸起大按钮）只能在中间位置
- 不需要登录的应用不生成头像/个人 tab

**Tabbar 命名一致性**：`@nav(mobile-tabbar)` 中的显示文字必须与对应 `@mobile-page` 的标题一致：

```markdown
# nav 里写
- @mobile-page(/notes) 我的记事 | icon: list

# 页面 section 标题也要一致
#### @mobile-page(/notes) 我的记事
```

---

## Mobile 页面规范（§8.2 @mobile-page）

### URL 规则

Mobile 使用 Expo Router 文件路由，url 即文件路径：
- 根页面：`/`
- 列表页：`/notes`
- 详情页：`/note-detail?note_id=uuid`（查询参数，非路径参数）
- 表单页：`/note-form`（编辑时加 `?note_id=uuid`）

### 页面命名规则（url 推导 impl 和 prototype）

| url | impl 路径 | prototype 路径 |
|-----|----------|--------------|
| `/` | `mobile/app/index.tsx` | `prototype/mobile/home.html` |
| `/notes` | `mobile/app/notes/index.tsx` | `prototype/mobile/notes.html` |
| `/note-detail` | `mobile/app/note-detail/index.tsx` | `prototype/mobile/note-detail.html` |
| `/profile` | `mobile/app/profile/index.tsx` | `prototype/mobile/profile.html` |

规则：url 去掉 `/`，中划线保留，即为目录名。首页 `/` 例外，原型命名为 `home.html`。

### 登录保护（public）

页面默认继承 `auth-mode`：
- `auth-mode: login` → 所有页面默认需登录；允许匿名访问的页面单独加 `> public: true`
- `auth-mode: anonymous` / `none` → 所有页面均无需登录，不写 `public`

### entry / tab 规则

| 页面类型 | entry | tab |
|---------|-------|-----|
| Tabbar 页（从底部导航直接访问） | `true` | 对应的 tabbar url，如 `/notes` |
| 登录/注册页（`auth-mode: login`） | `false` | `—` |
| 详情页、表单页（需上级传参） | `false` | `—` |

**登录/注册页设计为 `entry:false`**：登录页不在 tabbar 中，是 App 未登录时的拦截跳转目标，无需视为顶层页面；`params: —` 完全合法，表示无需参数即可进入。

### 必须包含的属性

```markdown
#### @mobile-page(/notes) 记事列表

> url: /notes
> entry: true                   ← tabbar 页写 true；登录/注册页和详情/表单页写 false
> params: —                     ← 无参数写 —；有参数写 name:type，枚举/日期必须给示例
> impl: mobile/app/notes/index.tsx
> prototype: prototype/mobile/notes.html
> tab: /notes                   ← tabbar 页填写对应 tabbar url；其余页面写 —
> gesture: pull-to-refresh      ← 支持的手势（可多个，逗号分隔）
> nav-bar: 我的记事             ← NavigationBar 标题
> apis: [@api(list-notes)]
```

**手势类型**：
- `pull-to-refresh`：下拉刷新
- `swipe-back`：左滑返回（Expo Router 默认支持）
- `swipe-to-delete`：列表项左滑删除

### 禁止生成的页面

- 启动页（Splash）
- 法规/合规页、帮助中心、FAQ、新手引导
- 主题/字体设置、语言设置、时区设置
- 云同步设置、离线缓存设置

### 导航约束

- Tabbar 不指向详情页（含 `?xxx_id` 的页面）
- 详情页只通过列表页交互进入

---

## @mobile-page 正文规范

每个 `@mobile-page` 正文必须包含以下全部内容，**缺任何一项都不合格**：

1. **核心职责**：一句话，明确该页面的单一目标

2. **访问路径**
   - `entry: true`：写"Tabbar 直接访问"或"App 启动默认页"
   - `entry: false`：写从哪个页面 push 进入，且说明**缺少 params 时的降级**（如"缺少 note_id 时返回 @mobile-page(/notes)"）

3. **布局**：先写 NavigationBar 构成，再写主内容区结构

   **列表页示例**：
   ```
   **布局**：顶部 NavigationBar（左：返回，中：标题，右：新增按钮）+ 主内容列表区。
   列表使用 FlatList，每行展示记事卡片（标题 + 时间 + 状态）。
   ```

   **列表页额外要求**：页面中有列表展示时，必须列出列表项包含的字段，格式如下：
   ```
   **列表项字段**：记事标题 / 创建时间 / 状态（处理中/完成）/ 右滑操作（删除）
   ```

   **表单页示例**（新建/编辑模式通过 params 区分）：
   ```
   **布局**：顶部 NavigationBar（左：返回，中：新增记录/编辑记录，右：删除按钮（仅编辑模式））+ 表单区。
   表单区：血糖值输入框 → 单位标签（只读）→ 测量时间选择器 → 餐次单选组 → 备注多行文本框 → 保存按钮。
   ```

4. **状态**：只写有意义的非正常态，简单页面可省略
   ```
   **状态**：
   - 空态：显示 XX 插图 + "暂无数据"文字 + XX 操作按钮
   - 加载态：列表骨架屏
   - 错误态：错误提示 + 重试按钮
   - 校验失败态（表单页）：高亮出错字段，字段下方显示错误提示文本
   - 提交中：保存/删除按钮显示加载状态并禁止重复点击
   ```

5. **交互说明表格**：**强制，不得省略**（见下节）

---

## 交互说明表格

### 格式

表格为 5 列，最后一列"备注"用于标注条件可见性、交互限制等，无备注时写 `—`。

```markdown
**交互说明**

| 元素 | 动作 | 响应 | 传参 | 备注 |
|------|------|------|------|------|
| 记事卡片 | 点击 | 跳转 @mobile-page(/note-detail)?note_id | note_id | — |
| 右上角"+" | 点击 | 跳转 @mobile-page(/note-form) | — | — |
| 列表项 | 左滑 | 显示删除按钮 | — | — |
| 删除按钮 | 点击 | 弹出确认 @modal(confirm-delete) | note_id | — |
| 下拉 | 下拉刷新 | 重新加载列表 | — | — |
| 返回按钮 | 点击 | 有未保存改动时弹出确认 @modal(discard-confirm)，否则直接返回 | — | 表单页 |
| 保存按钮 | 点击 | 校验必填项，通过后提交，成功返回上一页 | note_id, title, content | note_id 为空表示新建 |
| 删除按钮 | 点击 | 弹出确认 @modal(delete-confirm)，确认后删除并返回列表页 | note_id | 仅编辑模式显示 |
```

### 跳转目标写法

| 场景 | 写法 |
|------|------|
| 跳转到无参数页面 | `@mobile-page(/notes)` |
| 跳转到详情页（带参数） | `@mobile-page(/note-detail)?note_id` |
| 打开底部面板 | `@sheet(filter-panel)` |
| 打开模态 | `@modal(confirm-delete)` |
| 无跳转，区域内响应 | 直接描述："刷新列表"、"显示 Toast" |

### 覆盖原则（强制）

**每个 `@mobile-page` 正文末尾必须有交互说明表格，不得省略。**

- 覆盖所有可交互元素：按钮、卡片点击、输入框、手势、选择器
- 表单页必须包含：返回按钮（含未保存改动的确认逻辑）、提交按钮（含多参数传参和新建/编辑模式说明）、删除按钮（仅编辑模式，在备注列标注）
- 条件可见的元素（仅编辑模式、仅某角色）在"备注"列注明
- 传参列可写多个参数，逗号分隔；无参数写 `—`

---

## 底部面板和模态

不单独建 `@mobile-page`，在触发它的页面正文中描述：

```markdown
**底部面板 filter-panel**：
- 筛选条件：状态（全部/处理中/完成）、时间范围
- 操作：确认（刷新列表）、重置
```

---

## 选择功能本页化

所有选择类操作（搜索、筛选、单选/多选等）必须在本页完成：
- ✅ 底部弹出面板（`@sheet`）或模态（`@modal`）
- ❌ 跳转到单独的选择页面

例外：新增/编辑操作跳转独立页面。

---

## 多端项目（Web + Mobile）

当 `platform: [web, mobile]` 时：
- §1-§7（概述、角色、流程、功能、数据模型、服务端模块、API）**共用**，写一份
- §8.1 全局导航：分别写 `@nav(web-*)` 和 `@nav(mobile-tabbar)`
- §8.2 页面详情：`@web-page` 和 `@mobile-page` 各自独立描述，不合并

```markdown
### 8.2 页面详情

#### @web-page(/) 首页
...（Web 端首页描述）

#### @mobile-page(/) 首页
...（Mobile 端首页描述，可有差异）
```

两端共用同一套 API 和数据模型，页面交互、布局各自描述。
