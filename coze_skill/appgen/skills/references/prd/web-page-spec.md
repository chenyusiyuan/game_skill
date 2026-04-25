# Web PRD 规范

生成 Web 端 `docs/prd.md` 时遵循此规范。

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
platform: [web]
stack:
  server: nextjs
  web: nextjs-app-router
```

`auth-mode` 判断：
- 用户需要保存个人数据 → `login`
- 用户明确不需要登录但有后端 → `anonymous`（所有用户共享数据）
- 用户明确不要后端 → `none`，`need-backend: false`
- 模糊需求（如 TODO） → 倾向 `login` + `need-backend: true`

---

## 用户角色（§2）

只在 `auth-mode: login` 时生成此节。

**@role 是系统权限角色，不是用户群体描述**：
- ✅ `@role(user)` 普通用户、`@role(admin)` 管理员 → 有实际权限差异
- ❌ `@role(pregnant-woman)`、`@role(pet-owner)` → 这是用户画像，不是权限角色

**角色引入判断**：
- 几乎所有需要登录的应用都有 `@role(user)`
- PGC 内容（平台方维护） → 引入 `@role(admin)`
- UGC 内容（用户自己创建） → 通常只有 `@role(user)`，无需 admin

**管理员规则**：
- admin 与普通用户共用 `@web-page(/login)`，不单独建登录页
- admin 通过头像菜单进入后台，首页共用
- 如果用户没显式要求，默认不做用户管理、内容审核等额外功能

---

## 全局导航（§8.1）

Web 端必须生成以下 @nav：

| nav id | type | 说明 |
|--------|------|------|
| `web-topbar` | topbar | 顶部固定导航栏，含 Logo |
| `web-sidebar` | sidebar | 左侧菜单（如适用） |
| `web-avatar-menu` | avatar-menu | 头像点击菜单 |

**导航原则**：
- Logo 必须链接到 `@web-page(/)`
- 导航项只能指向无必需参数的页面（列表页、概览页）
- 详情页（url 含 `?xxx_id`）不得出现在任何导航中
- 管理员专属导航项加 `| roles: [admin]`，其余不写 roles
- 未登录专属条目加 `| condition: not-logged-in`

---

## Web 页面规范（§8.2 @web-page）

### URL 规则

- **强制单级路径**：每个页面 url 只能有一个层级，**绝对禁止子目录**
  - ✅ `/article-detail`、`/admin-articles`、`/admin-editor`
  - ❌ `/admin/articles`、`/notes/detail`、`/user/profile`
- 列表页：`/notes` 或 `/note-list`
- 详情页：`/note-detail?note_id=uuid`（查询参数，非路径参数）
- 表单页：`/note-form`（编辑时加 `?note_id=uuid`）
- 管理员页面：`/admin-xxx` 前缀（如 `/admin-articles`、`/admin-editor`）
- 中划线分隔，不用下划线：`/article-detail` 而非 `/article_detail`

### 页面命名规则（url 推导 impl 和 prototype）

| url | impl 路径 | prototype 路径 |
|-----|----------|--------------|
| `/` | `web/app/page.tsx` | `prototype/web/home.html` |
| `/notes` | `web/app/notes/page.tsx` | `prototype/web/notes.html` |
| `/note-detail` | `web/app/note-detail/page.tsx` | `prototype/web/note-detail.html` |
| `/note-form` | `web/app/note-form/page.tsx` | `prototype/web/note-form.html` |
| `/login` | `web/app/login/page.tsx` | `prototype/web/login.html` |
| `/admin-notes` | `web/app/admin-notes/page.tsx` | `prototype/web/admin-notes.html` |

规则：url 去掉 `/`，中划线保留，即为文件名。首页 `/` 例外，prototype 命名为 `home.html`。

### 登录保护（public）

页面默认继承 `auth-mode`：
- `auth-mode: login` → 所有页面默认需登录，**无需写任何属性**
- 需允许匿名访问的页面（登录页、公开落地页）单独加 `> public: true`
- `auth-mode: anonymous` / `none` → 所有页面均无需登录，**不写 `public`**

### layout 值

| layout | 结构 | 典型页面 |
|--------|------|---------|
| `sidebar-main` | 固定顶栏 + 左侧菜单 + 主内容区 | 管理后台、功能列表页 |
| `single-column` | 固定顶栏 + 单列主内容区 | 首页、内容展示页 |
| `full-width` | 固定顶栏 + 全宽内容区 | 仪表盘、地图、编辑器 |
| `auth` | 居中卡片，无顶栏无侧栏 | 登录/注册页 |

### 必须包含的页面

- `@web-page(/)` — 首页，固定存在
- `@web-page(/login)` — `auth-mode: login` 时必须，所有角色共用，需加 `> public: true`

### 禁止生成的页面

- 错误页（404/500 等用弹窗/提示处理）
- 法规/合规页（服务条款、隐私政策）
- 帮助中心、FAQ
- 功能引导/新手教程

---

## @web-page 正文规范

每个 `@web-page` 正文必须包含以下全部内容，**缺任何一项都不合格**：

1. **核心职责**：一句话，明确该页面的单一目标，避免写成功能罗列
   - ✅ "录音入口 + 最近记事时间轴，用户打开应用的主阵地。"
   - ❌ "提供录音、列表、详情跳转、用户头像等功能。"

2. **访问路径**
   - `entry: true`：写"导航直接访问"
   - `entry: false`：写从哪个页面进入，且说明**缺少 params 时的降级**（如"缺少 article_id 时重定向到 @web-page(/articles)"）

3. **布局**：先写顶层结构，再列出主内容区的区块组成，不写像素数字
   ```
   **布局**：顶部导航栏（固定）+ 左侧菜单 + 主内容区。
   主内容区：页面标题区 → 工具栏（搜索+筛选+操作按钮）→ 数据列表区 → 分页区。
   ```

   **列表页额外要求**：页面中有列表展示时，必须列出列表项包含的字段/列，格式如下：
   ```
   **列表项字段**：合同编号 / 客户名称 / 合同类型 / 合同金额 / 签署日期 / 状态（草稿/生效/已归档）/ 操作（查看、编辑、删除）
   ```
   表格视图需额外说明列头顺序；卡片视图说明主要信息区块。

4. **状态**：只写有意义的非正常态，简单页面（表单页、登录页）可省略
   ```
   **状态**：
   - 空态：无数据时显示 XX 引导语和 XX 操作按钮
   - 加载态：骨架屏 / 加载动画
   - 错误态：加载失败提示 + 重试按钮
   ```

5. **交互说明表格**：**强制，不得省略**（见下节）

---

## 交互说明表格

### 格式

表格为 5 列，最后一列"备注"用于标注角色可见性、跳转方式等补充信息，无备注时写 `—`。

```markdown
**交互说明**

| 元素 | 动作 | 响应 | 传参 | 备注 |
|------|------|------|------|------|
| Logo | 点击 | 跳转 @web-page(/) | — | — |
| 新增按钮 | 点击 | 跳转 @web-page(/note-form) | — | — |
| 记事卡片 | 点击 | 跳转 @web-page(/note-detail)?note_id | note_id | — |
| 删除按钮 | 点击 | 弹出确认对话框 @modal(confirm-delete) | note_id | — |
| 用户头像 | 点击 | 展开 @nav(web-avatar-menu) | — | — |
| 搜索框 | 回车 | 刷新列表，过滤结果 | keyword | — |
| 分页控件 | 点击页码 | 加载对应页数据 | page | — |
| 上传按钮 | 点击 | 未登录：跳转 @web-page(/login)；已登录：跳转 @web-page(/upload) | — | 登录态分支 |
| 管理入口 | 点击 | 跳转 @web-page(/admin) | — | 仅 admin 可见 |
```

### 跳转目标写法

| 场景 | 写法 |
|------|------|
| 跳转到无参数页面 | `@web-page(/)` |
| 跳转到详情页（带参数） | `@web-page(/note-detail)?note_id` |
| 打开弹窗/对话框 | `@modal(confirm-delete)` |
| 打开抽屉 | `@drawer(user-detail)` |
| 展开导航菜单 | `@nav(web-avatar-menu)` |
| 无跳转，区域内响应 | 直接描述："刷新列表"、"显示 Toast" |

### 覆盖原则（强制）

**每个 `@web-page` 正文末尾必须有交互说明表格，不得省略。**

- 覆盖所有可交互元素：按钮、链接、输入框、卡片点击、头像、Logo
- 不重复显而易见的行为：如"输入框输入"不需要写，"搜索框回车提交"需要写
- 有顶部导航的页面：Logo 点击行和头像点击行**必须存在**
- 同一元素对不同登录态响应不同时，在"响应"列用分号分隔：`未登录：跳转 @web-page(/login)；已登录：跳转 @web-page(/upload)`
- 管理员专属或角色限定的操作，在"备注"列标注：`仅 admin 可见`
- 页面内容简单（如纯登录表单）也至少要有"提交按钮"和"跳转"行

---

## 弹窗和抽屉

弹窗和抽屉不单独建 `@web-page`，在触发它的页面正文中描述：

```markdown
**弹窗 confirm-delete**：
- 标题："确认删除"
- 内容：展示记事标题
- 操作：确认（调用 @api(delete-note)，成功后刷新列表）、取消（关闭弹窗）
```

---

## 菜单项高亮（nav-active）

`nav-active` 规则按 `layout` 决定：

| layout | nav-active 填什么 | 说明 |
|--------|-----------------|------|
| `single-column` | topbar 中被激活的条目 url | 首页填 `/` |
| `sidebar-main` | **sidebar 中**被激活的条目 url | topbar 高亮由实现层推导，PRD 不表达 |
| `full-width` | topbar 中被激活的条目 url | 同 single-column |
| `auth` | `—` | 登录/注册页无导航 |

`entry: false` 的非一级页（详情页、表单页）写 `nav-active: —`。

```
# single-column 页面
> layout: single-column
> nav-active: /notes          # topbar "我的记事"高亮

# sidebar-main 页面
> layout: sidebar-main
> nav-active: /admin-articles  # sidebar "文章管理"高亮

# 详情页（非一级页）
> layout: single-column
> nav-active: —

# 登录页
> layout: auth
> nav-active: —
```

---

## 匿名应用（auth-mode: anonymous）

`auth-mode: anonymous` 时额外约束：
- 所有 API `auth: none`，不传任何用户标识
- 数据模型不含 user_id / owner_id 等归属字段
- 不生成：登录页、个人设置页、"我的 XXX" 页面
- 顶部导航不显示用户头像和登录入口
- 不生成 `@nav(web-avatar-menu)`

---

## 功能设计约束

不生成（除非用户明确要求）：
- 用户操作日志
- 过细粒度统计（每天/每周访问量等）
- 团队管理、多人协作
- 需审核的功能及流程
- 法规合规内容

所有功能均为确定需求，不出现"可选"、"建议"等字样，不给开发优先级。
