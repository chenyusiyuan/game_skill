---
name: appgen-prd
description: "在appgen中生成 Phase 1: PRD 需求分析。将用户需求转化为结构化产品需求文档（APRD 格式），包含功能规格、页面规格、数据模型、API 契约。适用于 Web 和 Mobile 两种平台。"
---

# Phase 1: PRD 需求分析

## 职责

将用户需求转化为结构化的产品需求文档（APRD 格式）。
PRD 是后续所有阶段的基础——设计系统参考它确定风格，原型参考它确定页面，代码参考它确定 API 和模块结构。

**输出文件**：`docs/prd.md`（单一文件，API 契约内嵌其中）

---

## 可用性原则（生成 PRD 前必须内化）

系统生成的是**产品级应用，不是 Demo**。PRD 必须经过可用性思考，确保产品在真实场景下可以运转，而不只是功能点的堆砌。

在动笔写任何页面或 API 之前，先用以下四条原则做一次心智推演。

---

### 原则一：角色与权限先行

先明确系统中有哪些角色，再决定谁有哪些入口。角色是后三条原则的前提。

- 常见角色：游客 / 普通用户 / 管理员 / 运营 / 超级管理员
- 每类实体的 Create / Update / Delete 操作归属哪个角色？
- **PGC 类产品**（内容由运营或管理员生产）：写入入口在管理后台，不在用户前台——但同样不能缺失，否则数据永远进不来
- **UGC 类产品**（内容由用户生产）：普通用户有写入权限，但需要明确边界（能否编辑他人内容？能否删除？）

> ⚠️ 常见遗漏：只设计了用户前台，忘记管理后台；或者忘记区分"自己的内容"和"他人的内容"的操作权限。

---

### 原则二：实体完整性——每个实体必须有完整生命周期

找出 PRD 中所有核心实体，结合角色权限，逐一检查 CRUDL 是否有对应入口。

**操作步骤**：
1. 列出所有名词实体（用户、家庭、日程、诗词、订单……）
2. 对每个实体过一遍：Create / Read / Update / Delete / List
3. 如果某项操作缺失，必须有意识地判断：是业务上不需要，还是遗漏了？

**典型遗漏举例**：
- 家庭日历 App：有"查看日程"，无"删除日程"；有"家庭成员列表"，无"移除成员"
- 诗词网站：有"浏览诗词"，无管理员"添加/编辑诗词"入口
- 订单系统：有"创建订单"，无"取消订单"或"退款"

> ⚠️ 不需要的操作可以明确标注"不支持"，但不能因为没想到而缺失。

---

### 原则三：数据来源自洽——产品必须能从零启动

假设数据库完全为空，不同角色的用户第一次打开产品：

- 管理员：能否通过产品自身录入第一条数据？
- 普通用户：能否通过产品自身创建第一条内容（如果允许）？
- 游客：空状态下看到的是什么？有没有引导？

**如果以上任何一个角色被卡住，说明缺少对应的写入入口，产品不可用。**

> ⚠️ 常见遗漏：只做了展示页，没有添加入口；或者添加入口只在某个深层页面，首次打开完全找不到。

---

### 原则四：关系实体不可隐式

多用户之间的关系（家庭、团队、组织、好友）本身是一个需要独立管理的实体，不能只当成一个字段处理。

关系实体需要回答：
- **建立**：谁能发起？通过邀请码 / 链接 / 搜索？需要对方确认吗？
- **变更**：成员角色能否变更？谁有权限操作？
- **解除**：普通成员能退出吗？管理员能踢人吗？关系解除后数据如何处理？

**典型遗漏举例**：
- 家庭日历：有"家庭"概念，但没有"创建家庭 / 邀请成员 / 退出家庭"的页面和 API
- 团队协作工具：有"团队"字段，但无团队管理页，成员无法加入或离开

> ⚠️ 关系实体的管理页面和 API 往往被遗漏，因为它们不在主业务流程上，但缺少它们产品就无法正常运转。

---

## 流程

**第一步：判断平台（必须在读规范文件之前完成）**

根据用户描述判断 platform，**优先以用户明确表述为准**：

| 用户说了什么 | platform | 读哪个规范 |
|------------|---------|-------------|
| "App"、"应用"、"移动应用"、"手机应用"、"iOS"、"Android"、"移动端"、"闪卡"、"小程序" | `[mobile]` | `mobile-page-spec.md` |
| "网站"、"Web"、"网页"、"系统"、"平台"、"后台"、"管理系统" | `[web]` | `web-page-spec.md` |
| 同时提到"网站和 App"、"多端" | `[web, mobile]` | 两个都读 |
| 无明确表述 | 默认 `[web]` | `web-page-spec.md` |

**platform 决定了后续所有内容，必须先确定**：
- `[mobile]` → `stack` 只有 `server` + `mobile: expo`（**无 `web:`**），页面全用 `@mobile-page`，导航用 `@nav(mobile-tabbar)`
- `[web]` → `stack` 只有 `server` + `web: nextjs-app-router`（**无 `mobile:`**），页面全用 `@web-page`，导航用 `@nav(web-*)`
- `[web, mobile]` → 两套 stack 都写，§8 页面分别用 `@web-page` 和 `@mobile-page`

**第二步：用 `multi_read` 一次性读取所有规范文件（不得跳过任何一个，必须全部读完再生成）**

根据 platform 确定文件列表后，**一次 `multi_read` 调用读完所有文件**：

- `[web]`：`multi_read([references/prd/aprd-format.md, references/prd/web-page-spec.md])`
- `[mobile]`：`multi_read([references/prd/aprd-format.md, references/prd/mobile-page-spec.md])`
- `[web, mobile]`：`multi_read([references/prd/aprd-format.md, references/prd/web-page-spec.md, references/prd/mobile-page-spec.md])`

**第三步：判断复杂度**

auth-mode 判断：login / anonymous / none（见 web-page-spec.md 或 mobile-page-spec.md）

**第四步：生成 prd.md**

按规范文件生成。

**第五步：运行检查脚本，有错误必须修正后再 task_done**

prd.md 写入后，执行以下命令进行完整检查：

```bash
node /path/to/plugins/appgen/skills/scripts/check_prd.js docs/prd.md
```

脚本路径需替换为实际的绝对路径（与 AGENTS.md 同目录的 `skills/scripts/check_prd.js`）。

- 退出码 `0`：通过，可以 task_done
- 退出码 `1`：有错误（❌），**必须逐条修正 prd.md，然后重新运行脚本确认通过后才能 task_done**
- 只有警告（⚠️）没有错误：可以 task_done，但建议修复警告

脚本检查范围：front-matter 完整性、platform 与 stack/tag 类型一致性、页面必填属性（含 entry/params）、params 类型格式、交互表格、URL 格式、API 必填属性、导航引用、跨引用一致性、章节结构等。

---



---

## APRD 格式概要

prd.md 使用 APRD（Annotated PRD）格式：

- **Front-matter**：项目级全局属性（平台、技术栈、auth-mode、产出物目录）
- **@tag 语义标注**：`@role`、`@flow`、`@feature`、`@data-model`、`@server-module`、`@api`、`@nav`、`@web-page`、`@mobile-page`
- **属性行**：tag 下的 `> key: value` 行，机器可精确提取
- **正文**：tag 下的自然语言描述，供人阅读和模型理解
- **交互跳转**：用 `@web-page(url)` 或 `@mobile-page(url)` 引用，不写自然语言页面名称

完整格式说明见 [references/prd/aprd-format.md](references/prd/aprd-format.md)。

---

## 符号规范（必须严格遵守）

**PRD 属性值中只使用半角 ASCII 符号，禁止全角或特殊 Unicode 符号。**

检查脚本通过正则解析属性值，全角符号会导致解析提前终止，误报大量"缺少必填属性"错误。

| 场景 | ✅ 正确写法 | ❌ 禁止写法 |
|------|-----------|-----------|
| 无参数标记 | `> params: -` | `> params: —`（全角破折号 U+2014） |
| 无参数标记 | `> tab: -` | `> tab: ──`（连续破折号） |
| 枚举分隔符 | `enum(a\|b\|c)` | `enum(a｜b｜c)`（全角竖线） |
| 日期示例 | `date(2024-01-01)` | `date（2024-01-01）`（全角括号） |
| 冒号分隔 | `> key: value` | `> key：value`（全角冒号） |
| 括号 | `@web-page(/home)` | `@web-page（/home）` |

**检查脚本兼容说明**：脚本已对"无参数"标记做兼容处理，`-`、`—`（U+2014）、`–`（U+2013）、`none` 均被识别为合法的无参数标记。但**生成新 PRD 时仍应使用半角 `-`**，避免依赖兼容逻辑。

---

## 上传文档处理

系统会在上传时自动将 PDF/DOCX 解析为 Markdown，并将文本内容和图片**直接注入到你的上下文中**（作为 user message 的一部分）。你在消息里即可直接看到文档内容和图片，**无需再调用 read 工具**。

如果仍看到 `[uploaded_files]` 提示行，说明框架注入时文件尚未解析完成，此时可手动读取：

```
# [uploaded_files] 含如下提示时可手动读取：
# assets/_____abc123.docx （已解析 → assets/_extract/_____abc123.docx/content.md）
read assets/_extract/_____abc123.docx/content.md
```

**refdoc 填写规则**：有上传文档时，所有 `@feature`、`@server-module`、`@web-page`、`@mobile-page` tag 必须包含 `refdoc` 属性，值为与该功能/页面相关的文档路径列表（路径从 `assets/` 开始），无直接关联的内容写 `[]`：

```
> refdoc: [assets/_extract/_____abc123.docx/content.md, assets/_extract/_____abc123.docx/assets/img-003.png]
> refdoc: []
```

---

## 质量检查

生成完成后逐项核对，**不满足则必须修正后再结束**：

**Front-matter**
- [ ] `platform` 值与用户需求一致（App → `[mobile]`，网站 → `[web]`）
- [ ] `platform: [mobile]` 时 stack 只有 `server` + `mobile: expo`，**不含 `web:`**
- [ ] `platform: [mobile]` 时 artifacts 只有 `mobile: mobile/`，**不含 `web:`**
- [ ] `platform: [web]` 时 stack 只有 `server` + `web: nextjs-app-router`，**不含 `mobile:`**

**页面**
- [ ] `platform: [mobile]` 时所有页面用 `@mobile-page`，**不出现 `@web-page`**
- [ ] `platform: [web]` 时所有页面用 `@web-page`，**不出现 `@mobile-page`**
- [ ] 每个 `@web-page` / `@mobile-page` 都有：url、**entry**、**params**、impl、prototype（`public` 仅登录/注册页需要加）
- [ ] `@web-page` 额外有：layout、nav-active（`entry:false` 时 `nav-active: —`）
- [ ] `@mobile-page` 额外有：nav-bar、tab（tabbar 页填 url，其余页写 `—`）
- [ ] **有上传文档时**，每个 `@web-page` / `@mobile-page` 必须有 `refdoc` 属性（无直接关联写 `[]`，有关联列出路径，从 `assets/` 开始）
- [ ] `auth-mode: login` 时登录/注册页用 `entry:false`（不在 tabbar 中，是未登录时的拦截跳转目标，`params:—` 合法）
- [ ] `entry: true` 的页面，params 中**不得含必填参数**（无 `?` 后缀）；可选参数（`?` 后缀）是合法的，如搜索筛选页 `keyword?:string`
- [ ] `entry: false` 的页面，params 可以为 `—`（无参数二级页完全合法，如后台子页从侧边栏进入）；若有参数则按正常格式写
- [ ] params 中的枚举类型必须写 `enum(a\|b\|c)`，日期/时间类型必须写示例值
- [ ] **每个页面正文必须包含交互说明表格**，无例外；表中跳转目标用 `@web-page(url)` 或 `@mobile-page(url)` 引用
- [ ] **有列表展示的页面必须在布局说明中写出列表项字段**（如"列表项字段：标题 / 时间 / 状态 / 操作"）

**URL**
- [ ] Web 所有页面 url 均为**严格单级路径**，url 中无第二个 `/`（`/admin-articles` ✅，`/admin/articles` ❌）
- [ ] 详情页 url 含查询参数（`/note-detail?note_id=uuid`），**不用路径参数**（`/notes/:id` ❌）
- [ ] 导航（@nav）中无含 `?xxx_id` 的详情页 url

**编号**
- [ ] §7 API 接口按 `@server-module` 分组，标题格式 `### 7.x 模块名`，每个接口标题格式 `#### 7.x.y @api(id) 接口名`
- [ ] §8.2 页面详情每个页面标题格式 `#### 8.2.x @web-page(url) / @mobile-page(url) 页面名`

**API**
- [ ] 每个 `@api` 有：method、path、auth、module、impl、page-ref
- [ ] **每个 `@api` 必须有 `Request` 段**：有请求体时写 content-type + 字段，无请求体时写 `**Request** 无`，不得省略
- [ ] `@api` 的 `module` 字段必须使用 tag 引用格式 `@server-module(id)`，禁止直接写模块名字符串
- [ ] `@server-module` 的 `apis` 列表与实际 `@api` section 一一对应，无遗漏
- [ ] 每个 `@web-page` / `@mobile-page` 的 `apis:` 属性中列出的所有 `@api(id)`，**必须在 §7 中有完整的 `### @api(id)` section**；列了但没定义会导致检查失败
- [ ] **表单编辑页**（params 含 `?:uuid` 的 form 页，如 `/note-form?note_id=uuid`）通常需要一个对应的 `get-xxx` API 用于加载现有数据，不要遗漏
- [ ] 每个 `@api` 的 Response 必须包含 `success: boolean` 和 `message: string` 两个字段
- [ ] `list-` / `search-` 开头的接口 Response 必须包含 `datas: object[]`；详情/创建/更新接口使用 `data: object`；禁止裸数组作为顶层响应字段
- [ ] API 命名建议遵守前缀规范：`list-` / `search-` / `get-` / `check-` / `export-` / `create-` / `update-` / `delete-`（见 aprd-format.md 命名规范表）
- [ ] 有分页的列表接口必须包含 `total: number`；无分页时省略
- [ ] 所有 ID 字段（`id`、`userId`、`articleId` 等）统一使用 `uuid` 类型，**禁止** `id: string`
- [ ] DELETE 接口 Response 只有 `success` + `message`，**禁止** 返回 `204` 或包含 `data`/`datas`

**导航**
- [ ] `platform: [mobile]` 时有 `@nav(mobile-tabbar)`，**不出现 `@nav(web-*)`**
- [ ] `platform: [web]` 时有 `@nav(web-topbar)`，有登录需求时有 `@nav(web-avatar-menu)`

**跨引用一致性**
- [ ] `@nav(mobile-tabbar)` 中每个 `@mobile-page(url)` 都有对应的 `#### @mobile-page(url)` section 定义
- [ ] `@nav(web-*)` 中每个 `@web-page(url)` 都有对应的 `#### @web-page(url)` section 定义
- [ ] 所有页面交互表格中引用的 `@mobile-page(url)` / `@web-page(url)`（去掉 `?param` 后），必须有对应的页面 section 定义；**如没有则必须补充该页面的完整 section**
- [ ] `@server-module` 的 `apis` 列表中每个 api id，都必须有对应的 `### @api(id)` section

**refdoc（有上传文档时检查）**
- [ ] 每个 `@feature` 有 `refdoc` 属性（`[]` 或路径列表）
- [ ] 每个 `@server-module` 有 `refdoc` 属性（`[]` 或路径列表）
- [ ] 每个 `@web-page` / `@mobile-page` 有 `refdoc` 属性（`[]` 或路径列表）
- [ ] `refdoc` 中引用的路径必须是 `assets/_extract/` 下实际存在的文件，路径从 `assets/` 开始
