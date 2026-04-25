# APRD 格式规范

APRD（Annotated PRD）格式目标：**机器可精确提取，人可直接阅读**。文件名固定为 `docs/prd.md`。

---

## Front-matter

```yaml
---
aprd: "1.0"
project: my-app               # kebab-case
platform: [web]               # web / mobile / [web, mobile]
auth-mode: login              # login（需登录）/ anonymous（共享数据无登录）/ none（纯前端）
need-backend: true
language: zh-CN

stack:
  server: nextjs
  web: nextjs-app-router      # web 端时写；纯 mobile 时不写
  mobile: expo                # mobile 端时写（expo / iOS / mini-program(小程序)等）；纯 web 时不写

artifacts:
  design:
    web: design/web/          # web 设计稿目录（Phase 2 产出）
    mobile: design/mobile/    # mobile 设计稿目录（Phase 2 产出）
  prototype:
    web: prototype/web/       # web 端时写
    mobile: prototype/mobile/ # mobile 端时写
  server: server/
  web: web/                   # web 端时写，nextjs项目可能是 server/app 
  mobile: mobile/             # mobile 端时写
---
```

- `anonymous`：有后端但所有用户共享同一份数据，无用户区分，所有 API `auth: none`
- 没有的端直接省略对应字段（`platform: [mobile]` 时不写 `stack.web`、`artifacts.design.web`、`artifacts.web`）

**术语规范**：
- `mobile` 统一代表移动端（不用 `app`）。具体运行形态（Expo / React Native / 小程序 / 原生 iOS/Android）在 `stack.mobile` 中指定
- 页面 tag 用 `@mobile-page`（代表非 Web 的原生页面，无论运行在哪个移动平台）

---

## Tag 语法

```
### @tag-type(id) 显示名称
> attr1: value
> attr2: [val1, val2]    # 多值用方括号

正文自然语言描述...
```

- tag 必须在 Markdown 标题中（`##` `###` `####`）
- `> key: value` 行紧跟标题，遇空行或非 `>` 行停止
- 跨 tag 引用：`@web-page(/notes)`、`@api(create-note)` 等内联语法

---

## Tag 速查表

| Tag | 必填属性 | 说明 |
|-----|---------|------|
| `@role(id)` | — | **系统权限角色**（如 user/admin/editor），仅 `auth-mode: login` 时需要 |
| `@flow(id)` | `involves` | 业务流程，按顺序列出页面/API/角色节点 |
| `@feature(F-模块-序号)` | `module`, `pages` | 功能规格，说明功能边界和包含范围；有参考文档时加 `refdoc` |
| `@data-model(Name)` | `impl`, `module` | 数据模型及字段定义；`impl` 格式：`server/src/db/schema/{module}.ts`（按模块拆分，同模块的 model 写在同一文件） |
| `@server-module(id)` | `impl`, `depends`, `models`, `apis` | 服务端模块的职责与边界；`impl` 格式：`server/src/services/{module}.service.ts`；`depends` 用 `[@server-module(id)]`，`models` 用 `[@data-model(Name)]`；有参考文档时加 `refdoc` |
| `@api(id)` | `method`, `path`, `auth`, `module`, `impl`, `page-ref` | API 接口；`module` 用 `@server-module(id)` tag 引用格式；`impl` 格式：`server/app/api/{module}/route.ts` |
| `@nav(id)` | `type`, `platform` | 全局导航（见下） |
| `@web-page(url)` | `url`, `entry`, `params`, `impl`, `prototype`, `public`, `layout`, `nav-active` | Web 页面；`apis` 用 `[@api(id)]` 格式；`entry:false` 时 `nav-active: —`；有参考文档时加 `refdoc` |
| `@mobile-page(url)` | `url`, `entry`, `params`, `impl`, `prototype`, `public`, `nav-bar`, `tab` | Mobile 页面；`apis` 用 `[@api(id)]` 格式；非 tabbar 页 `tab: —`；有参考文档时加 `refdoc` |

---

## @nav 规范

`type` 取值：`topbar`（web）/ `sidebar`（web）/ `avatar-menu`（web）/ `tabbar`（mobile）

导航项格式：
```
- @web-page(url) 显示文字 [| roles: [admin]] [| condition: not-logged-in] [| icon: home]
- action:logout 显示文字
```

- 默认不写 roles；只有管理员或其它角色专属项才写，如 `| roles: [admin]`
- 导航项只能指向无必需参数的页面（不含 `?xxx_id`）

---

## @flow 规范

`@flow` 描述一条业务流程经过的**处理环节顺序**，供并行生成各模块时对齐流程边界。

`involves` 按流程顺序列出节点引用，节点类型：`@role`、`@web-page`、`@mobile-page`、`@api`。

```
### @flow(user-publish) 用户发布文章
> involves: [@role(user), @web-page(/article-form), @api(create-article), @web-page(/article-detail)]

用户在编辑页填写标题和内容后提交，调用创建接口，成功后跳转详情页。
```

```
### @flow(onboarding) 注册登录
> involves: [@web-page(/login), @api(register), @api(login), @web-page(/)]

新用户进入登录页选择注册，完成注册后自动登录并跳转首页。
```

**写作规则**：
- `involves` 只列关键节点，不列所有涉及页面——聚焦**主干路径**，分支和异常在正文说明
- 每条 flow 配一句正文，说明流程的触发条件和最终结果
- 流程数量：通常 2-4 条，覆盖核心用户路径即可，不穷举所有操作路径

---

## @role 规范

`@role` 描述的是**系统内的权限角色**，不是用户群体或用户画像。

```
### @role(user) 普通用户
注册登录后的默认角色，可使用全部面向用户的功能。

### @role(admin) 管理员
平台运营人员，可访问管理后台，负责 PGC 内容的增删改查。
通过头像菜单进入后台，与普通用户共用登录页。
```

**常见角色 id**：`user`（普通用户）、`admin`（管理员）、`editor`（编辑）、`moderator`（版主）

**不是用户角色的例子**（不要用 @role 描述这些）：
- ❌ `@role(pregnant-woman)` — 这是用户群体，不是权限角色
- ❌ `@role(student)` / `@role(teacher)` — 若仅描述使用场景而无权限差异，不需要 @role
- ✅ 有明确权限差异（某些页面/功能仅某角色可访问）时才定义 @role

**引入管理员角色的判断**：
- PGC 内容（平台维护） → 必须引入 `@role(admin)`
- UGC 内容（用户自己创建） → 通常不引入管理员
- 单用户工具类应用 → 只需 `@role(user)`，无需 admin

---

## @feature 规范

`@feature` 描述一个独立的功能模块，说明**包含什么、不包含什么**，供并行生成时划定边界、避免重复实现。

```
### @feature(F-NOTE-01) 笔记管理
> module: notes
> pages: [@web-page(/notes), @web-page(/note-detail), @web-page(/note-form)]
> refdoc: []

支持笔记的新建、编辑、删除和列表展示。列表支持按创建时间排序和关键词搜索。
不包含：标签/分类管理（F-TAG-01）、分享功能（F-SHARE-01）。
```

有参考文档时，`refdoc` 列出原始文档路径或解析后内容路径（路径从 `assets/` 开始）：

```
### @feature(F-ORDER-01) 收入订单管理
> module: order
> pages: [@web-page(/order-list), @web-page(/order-form), @web-page(/order-detail)]
> refdoc: [assets/_extract/_____abc123.docx/content.md, assets/_extract/_____abc123.docx/assets/img-001.png]

收入订单的新建/编辑/审核/反确认及批量导入。
不包含：付款方管理、合同管理。
```

**写作规则**：
- `module` 填对应的 `@server-module` id（前后端并行实现时的对齐锚点）
- `pages` 列出实现该功能的所有页面引用
- `refdoc` 列出本功能对应的参考文档/截图路径（路径从 `assets/` 开始），无参考时写 `[]`；**有上传文档时必须填写，不得省略**
- 正文第一句说功能包含什么（核心能力），第二句（可选）说明**不包含什么**，防止并行实现越界
- id 格式：`F-模块缩写-序号`，如 `F-NOTE-01`、`F-BILL-02`

---

## @data-model 规范

`@data-model` 描述数据库表结构。ORM 使用 **Drizzle**，schema 按 `@server-module` 模块拆分为独立文件，路径格式为 `server/src/db/schema/{module}.ts`。同一模块的多个 model 写在同一个文件里。

**字段格式**：
```
- 字段名: 类型           # 必填字段
- 字段名?: 类型          # 可选字段（数据库允许 null）
- 字段名: 类型 → ModelName   # 外键关联，→ 后写目标模型名
```

**类型列表**：`string`、`number`、`boolean`、`timestamp`、`uuid`、`enum(值A|值B)`

**enum 命名规范**：
- 枚举**成员值**用 **camelCase**（PRD 描述层）：`enum(focus|shortBreak|longBreak)`、`enum(draft|published)`
- 代码层直接用 camelCase 字符串值（Drizzle 不做映射转换，PRD 写什么代码层就用什么）
- ✅ `enum(focus|shortBreak|longBreak)`　❌ `enum(Focus|ShortBreak)`　❌ `enum(FOCUS|SHORT_BREAK)`

```
### @data-model(Note) 笔记
> impl: server/src/db/schema/notes.ts
> module: notes

- id: uuid
- title: string
- content: string
- userId: uuid → User        # 归属用户，外键
- status: enum(draft|published)
- createdAt: timestamp
- updatedAt: timestamp
```

```
### @data-model(Session) 专注会话
> impl: server/src/db/schema/timer.ts
> module: timer

- id: uuid
- startTime: timestamp
- duration: number           # 秒
- type: enum(focus|shortBreak|longBreak)
- completed: boolean
- soundType: string
- createdAt: timestamp
```

```
### @data-model(User) 用户
> impl: server/src/db/schema/auth.ts
> module: auth

- id: uuid
- email: string              # 唯一索引
- passwordHash: string
- createdAt: timestamp
```

**写作规则**：
- `impl` 路径格式为 `server/src/db/schema/{module}.ts`，`{module}` 与 `@server-module` 的 id 对齐
- 同一个 `@server-module` 下的多个 model 写在同一个 schema 文件里
- 外键字段用 `→ ModelName` 标注关联目标（由代码生成层处理 Drizzle 的 `references` 语法）
- 不写 Drizzle 的 `.primaryKey()`、`.notNull()`、`.unique()` 等链式调用（由实现层决定）
- 只描述业务字段，不写 `deletedAt`、`version` 等技术字段

---

## @server-module 规范

`@server-module` 描述一个服务端模块的**职责边界**，是并行生成后端代码时的模块划分依据。

```
### @server-module(notes) 笔记模块
> impl: server/src/services/notes.service.ts
> depends: [@server-module(auth)]
> models: [@data-model(Note)]
> apis: [@api(list-notes), @api(get-note), @api(create-note), @api(update-note), @api(delete-note)]

负责笔记的增删改查和全文检索。不处理用户鉴权（由 auth 模块负责），不处理附件存储。
```

```
### @server-module(auth) 认证模块
> impl: server/src/services/auth.service.ts
> depends: []
> models: [@data-model(User)]
> apis: [@api(register), @api(login), @api(get-me)]

负责用户注册、登录和 JWT 签发验证。不处理业务数据，不包含密码重置（本项目不需要）。
```

**属性格式**：
- `depends`: 依赖的其他模块，用 `[@server-module(id)]` 引用格式；无依赖写 `[]`
- `models`: 本模块负责的数据模型，用 `[@data-model(Name)]` 引用格式；无模型写 `[]`
- `apis`: 本模块暴露的 API 列表，用 `[@api(id)]` 引用格式
- `refdoc`: 本模块对应的参考文档/截图路径列表（路径从 `assets/` 开始），无参考时写 `[]`

**写作规则**：
- 正文第一句说模块的**主要职责**（做什么），第二句（可选）说明**不做什么**，明确与相邻模块的边界
- `depends` 只列直接依赖，不列传递依赖
- 一个模块通常对应一个业务域（auth、notes、statistics），不跨域合并
- **`apis` 列表中的每个 id 必须在 §7 有完整的 `@api` section**；列出但不定义会导致检查失败（MOD010）
- **`models` / `depends` 中引用的 tag id 必须在文档中有对应 section**（MOD012 / MOD013）
- **有上传文档时 `refdoc` 必须填写**，指向 `assets/_extract/` 下与本模块相关的内容片段或截图路径

---

## @api 规范

每个 `@api` 必须包含：属性行（6个必填）+ Request/Query 字段 + Response 字段 + Errors。

---

### Response 统一结构（必须严格遵守）

**所有 API 的 Response body 统一为以下信封格式**，不允许例外：

```
- success: boolean          # 是否成功，true / false
- message: string           # 操作结果描述，供前端 Toast 展示或错误提示
- data?: object             # 单个资源（GET 详情 / POST 创建 / PATCH 更新）
- datas?: object[]          # 资源列表（GET 列表）
- total?: number            # 列表总数（有分页时必填，无分页时省略）
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `success` | boolean | ✅ 必填 | `true` = 操作成功，`false` = 操作失败 |
| `message` | string | ✅ 必填 | 成功时描述结果（如"创建成功"），失败时描述原因（如"记录不存在"）；供前端直接展示 |
| `data` | object | 按场景 | 单个资源对象，GET 详情 / POST 创建 / PATCH·PUT 更新 时使用 |
| `datas` | object[] | 按场景 | 资源列表，GET 列表时使用 |
| `total` | number | 按场景 | 列表总条数，有分页时必填；无分页列表时省略 |

**按操作类型的 Response 规则**：

| HTTP 方法 | 操作语义 | success | message 示例 | data/datas | total |
|-----------|---------|---------|-------------|------------|-------|
| `GET`（列表） | 查询列表 | `true` | `"获取成功"` | `datas: object[]` | 有分页填 number，无分页省略 |
| `GET`（详情） | 查询单个 | `true` | `"获取成功"` | `data: object` | — |
| `POST` | 创建资源 | `true` | `"创建成功"` | `data: object`（新建资源） | — |
| `PATCH` / `PUT` | 更新资源 | `true` | `"更新成功"` | `data: object`（更新后资源） | — |
| `DELETE` | 删除资源 | `true` | `"删除成功"` | — （无 data/datas） | — |

**禁止写法**：
- ❌ 禁止裸返回数组（`- items: object[]` 直接作为顶层字段，不包在信封里）
- ❌ 禁止 `success: boolean` 作为唯一返回字段（必须有 `message`）
- ❌ 禁止返回 `204 No Content`（统一用 `200` + 信封格式，DELETE 也不例外）
- ❌ 禁止用 `items` 作为顶层列表响应字段（`datas` 已承担此职责；`data.items` 作为对象内部子字段是合法的）
- ❌ 禁止 `id: string`（所有 ID 字段统一用 `uuid` 类型）

**错误响应**（`success: false`）由 **Errors 段**声明，格式不变，框架层统一返回：

```
{
  "success": false,
  "message": "记录不存在"
}
```

---

### Response 示例（按操作类型）

**POST 创建**：

```
### @api(create-note) 创建记事
> method: POST
> path: /api/notes
> auth: required
> module: @server-module(notes)
> impl: server/app/api/notes/route.ts
> page-ref: [@web-page(/)]

**Request** `multipart/form-data`
- audioFile: File                        # 必填，音频文件
- duration?: number                      # 可选，时长（秒）

**Response** `200`
- success: boolean
- message: string                        # "创建成功"
- data: object
  - id: uuid                             # 新建记事 ID
  - status: "processing" | "done"        # AI 解析状态
  - createdAt: string                    # ISO 8601

**Errors**
- 401: 未登录
- 413: 文件超过大小限制
```

**GET 列表（有分页）**：

```
### @api(list-articles) 获取文章列表
> method: GET
> path: /api/articles
> auth: none
> module: @server-module(content)
> impl: server/app/api/articles/route.ts
> page-ref: [@web-page(/)]

**Query**
- page?: number (默认 1)
- size?: number (默认 20)
- keyword?: string

**Response** `200`
- success: boolean
- message: string                        # "获取成功"
- total: number
- datas: object[]
  - id: uuid
  - title: string
  - createdAt: string

**Errors**
- 无
```

**GET 列表（无分页）**：

```
**Request** 无

**Response** `200`
- success: boolean
- message: string                        # "获取成功"
- datas: object[]
  - id: uuid
  - name: string
```

**GET 详情**：

```
**Request** 无

**Response** `200`
- success: boolean
- message: string                        # "获取成功"
- data: object
  - id: uuid
  - title: string
  - content: string
  - createdAt: string
```

**PATCH / PUT 更新**：

```
**Request** `application/json`
- title?: string
- content?: string

**Response** `200`
- success: boolean
- message: string                        # "更新成功"
- data: object
  - id: uuid
  - updatedAt: string
```

**DELETE 删除**：

```
**Request** 无

**Response** `200`
- success: boolean
- message: string                        # "删除成功"
```

---

**API 命名规范**（建议遵守，不强制检查）：

| 前缀 | HTTP 方法 | 语义 | 示例 |
|------|-----------|------|------|
| `list-` | GET | 返回资源列表（全量/分页），Response 必须有 `datas: object[]` | `list-orders`, `list-hairstylists` |
| `search-` | GET | 关键词搜索，Response 必须有 `datas: object[]` | `search-articles`, `search-members` |
| `get-` | GET | 获取单个资源详情或聚合数据，Response 使用 `data: object` | `get-order`, `get-dashboard-stats` |
| `check-` | GET | 校验类查询（如手机号是否存在），Response 使用 `data: object` | `check-phone` |
| `export-` | GET | 导出类接口 | `export-orders` |
| `create-` | POST | 创建资源 | `create-order`, `create-member` |
| `update-` | PUT/PATCH | 更新资源 | `update-order`, `update-profile` |
| `delete-` | DELETE | 删除资源 | `delete-order` |

> `list-` 和 `search-` 开头的接口会被自动检查 Response 是否包含 `datas: object[]` 字段。

**书写规则**：
- 字段格式：`- 字段名: 类型` 或 `- 字段名?: 类型`（`?` 表示可选）
- 类型：`uuid` / `string` / `number` / `boolean` / `string[]` / `"值A" | "值B"` / `object`
- **所有 ID 字段（`id`、`userId`、`articleId` 等）统一使用 `uuid` 类型，禁止写 `string`**
- **`module` 字段必须用 tag 引用格式**：`@server-module(id)`，例如 `> module: @server-module(notes)`，禁止直接写模块名字符串
- Response 始终要写，且必须包含 `success` 和 `message` 两个字段
- Errors 段必须写，无错误时写 `- 无`
- **Request 段必须写**，无请求体时写 `**Request** 无`；有请求体时写对应的 content-type 和字段（见下方示例）

**`page-ref` 写法**：列出所有直接消费此 API 的页面，多值逗号分隔：

```
# 单端
> page-ref: [@web-page(/notes)]

# 同一 API 被 web 和 mobile 共用（多端项目）
> page-ref: [@web-page(/notes), @mobile-page(/notes)]

# 同一 API 在多个页面使用
> page-ref: [@web-page(/), @web-page(/notes)]

# 仅后台调用，无前端页面直接消费
> page-ref: —
```

`impl` 路径格式：**`server/app/api/{module}/route.ts`**

架构说明（两层分离）：
- `@api impl` → **路由层**：`server/app/api/{module}/route.ts`（处理 HTTP，参数校验，调用 service）
- `@server-module impl` → **业务层**：`server/src/services/{module}.service.ts`（业务逻辑，不感知 HTTP）

---

## params / entry 规范

每个页面（`@web-page` / `@mobile-page`）必须包含 `entry` 和 `params` 两个属性，**无论是否有参数都必须写**。

### entry

```
> entry: true    # 一级页：可从导航/tabbar 直接进入，无需上级页面传参
> entry: false   # 非一级页：需要上级页面 push/navigate，通常需要 params
```

### params

```
> params: —                                              # 明确无参数（一级页常见）
> params: article_id:uuid                                # 单必填参数
> params: note_id:uuid, tab:enum(list|timeline)          # 多参数，enum 列出所有合法值
> params: article_id:uuid, start_date?:date(2024-01-01)  # ? 表示可选参数
```

**类型系统**：

| 类型 | 写法 | 说明 |
|------|------|------|
| UUID/ID | `uuid` | 资源唯一标识，无需示例 |
| 字符串 | `string` | 任意字符串，无需示例 |
| 数字 | `number` | 整数或小数，无需示例 |
| 布尔 | `boolean` | true/false，无需示例 |
| 枚举 | `enum(a\|b\|c)` | **必须**列出所有合法值 |
| 日期 | `date(2024-01-01)` | **必须**给 ISO 格式示例 |
| 时间戳 | `datetime(2024-01-01T00:00:00)` | **必须**给 ISO 格式示例 |

**`?` 后缀**：表示可选参数。form 页常见：有 `article_id` = 编辑，无 = 新建。

---

## 登录保护规则（`auth-mode` + `public`）

页面的登录要求由 `auth-mode`（全局）和 `public`（页面级例外）共同决定，**不再使用 `need-login` 字段**。

| `auth-mode` | 默认行为 | 例外声明 |
|-------------|---------|---------|
| `login` | 所有页面需要登录 | 用 `> public: true` 标记允许匿名访问的页面（如登录页、落地页） |
| `anonymous` | 所有页面无需登录 | 无需例外声明 |
| `none` | 所有页面无需登录（纯前端） | 无需例外声明 |

**`public: true` 的适用场景**（仅 `auth-mode: login` 时有意义）：
- 登录页 `/login`、注册页 `/register`
- 公开落地页、首页可匿名浏览
- 不写 `public` = 默认受登录保护

```
# auth-mode: login 时，大多数页面不写 public（默认需登录）
#### @web-page(/) 首页
> public: true      # 落地页允许匿名浏览

#### @web-page(/login) 登录
> public: true      # 登录页必须公开

#### @web-page(/notes) 笔记列表
#（不写 public = 需登录，auth-mode 决定）
```

---

## @web-page 规范

必填属性：`url`, `entry`, `params`, `impl`, `prototype`, `layout`, `nav-active`
登录例外页额外加：`public: true`
有参考文档时额外加：`refdoc: [路径1, 路径2]`（无参考文档时写 `refdoc: []`，**有上传文档时不得省略**）

```
#### @web-page(/) 首页
> url: /
> entry: true
> params: —
> impl: web/app/page.tsx
> prototype: prototype/web/home.html
> public: true
> layout: single-column   # sidebar-main / single-column / full-width / auth
> nav-active: /
> apis: [@api(list-notes)]
> refdoc: []

**核心职责**：一句话。
**访问路径**：导航直接访问。
**布局**：顶部导航栏 + 主内容区。
**状态**：空态 / 加载态 / 错误态。

**交互说明**（强制，不得省略）

| 元素 | 动作 | 响应 | 传参 |
|------|------|------|------|
| Logo | 点击 | 跳转 @web-page(/) | — |
| 用户头像 | 点击 | 展开 @nav(web-avatar-menu) | — |
| 文章卡片 | 点击 | 跳转 @web-page(/article-detail)?article_id | article_id |
```

```
#### @web-page(/article-detail) 文章详情
> url: /article-detail
> entry: false
> params: article_id:uuid
> impl: web/app/article-detail/page.tsx
> prototype: prototype/web/article-detail.html
> layout: single-column
> nav-active: —
> apis: [@api(get-article)]
```

```
#### @web-page(/article-form) 文章编辑
> url: /article-form
> entry: false
> params: article_id?:uuid           # 可选：有=编辑，无=新建
> impl: web/app/article-form/page.tsx
> prototype: prototype/web/article-form.html
> layout: single-column
> nav-active: —
> apis: [@api(create-article), @api(update-article)]
```

`apis` 规则：有 API 调用时写 `> apis: [@api(id1), @api(id2)]`；该页面无需调用任何 API 时写 `> apis: —`（不得省略此字段）。

URL 规则：单级路径（`/article-detail` ✅，`/articles/detail` ❌）；`params` 中的参数名即 URL 查询参数名，类型和示例供前后端对齐。

---

## @mobile-page 规范

必填属性：`url`, `entry`, `params`, `impl`, `prototype`, `nav-bar`
登录例外页额外加：`public: true`
有参考文档时额外加：`refdoc: [路径1, 路径2]`（无参考文档时写 `refdoc: []`，**有上传文档时不得省略**）

与 `@web-page` 差异属性：

| 属性 | 说明 |
|------|------|
| `nav-bar` | NavigationBar 标题（替代 `layout`/`nav-active`） |
| `tab` | 所属 tabbar url，**tabbar 页必填**；非 tabbar 页写 `—` |
| `gesture` | 手势：`pull-to-refresh` / `swipe-back` / `swipe-to-delete` |
| `apis` | 同 `@web-page`：有 API 写 `[@api(id)]`；无 API 写 `—` |

```
#### @mobile-page(/) 首页
> url: /
> entry: true
> params: —
> impl: mobile/app/index.tsx
> prototype: prototype/mobile/home.html
> tab: /
> nav-bar: 首页
> apis: [@api(list-notes)]
> refdoc: []
```

```
#### @mobile-page(/note-detail) 笔记详情
> url: /note-detail
> entry: false
> params: note_id:uuid
> impl: mobile/app/note-detail/index.tsx
> prototype: prototype/mobile/note-detail.html
> tab: —
> nav-bar: 笔记详情
> apis: [@api(get-note)]
```

```
#### @mobile-page(/note-form) 新建/编辑笔记
> url: /note-form
> entry: false
> params: note_id?:uuid
> impl: mobile/app/note-form/index.tsx
> prototype: prototype/mobile/note-form.html
> tab: —
> nav-bar: 编辑笔记
> apis: [@api(create-note), @api(update-note)]
```

交互表格强制，跳转目标用 `@mobile-page(url)` 引用。

---

## 文档章节顺序

```
front-matter
## 1. 产品概述
## 2. 用户角色        （auth-mode: login 时）
## 3. 用户流程
## 4. 功能规格
## 5. 数据模型        （need-backend: true 时）
## 6. 服务端模块      （need-backend: true 时）
## 7. API 接口        （need-backend: true 时）
   ### 7.1 模块名一   （按 @server-module 分组）
       #### 7.1.1 @api(id-1) 接口名
       #### 7.1.2 @api(id-2) 接口名
   ### 7.2 模块名二
       #### 7.2.1 @api(id-3) 接口名
## 8. 页面规格
   ### 8.1 全局导航   （@nav tags）
   ### 8.2 页面详情   （@web-page / @mobile-page tags）
       #### 8.2.1 @web-page(/xxx) 页面名
       #### 8.2.2 @web-page(/yyy) 页面名
```

**编号规范**：
- §7 API 接口：按所属 `@server-module` 分组为 `### 7.x 模块名`，每个模块内的接口编为 `#### 7.x.y @api(id) 接口名`，便于一眼看出共有多少个 API 接口
- §8.2 页面详情：每个页面编为 `#### 8.2.x @web-page(url) / @mobile-page(url) 页面名`，便于一眼看出共有多少个页面
