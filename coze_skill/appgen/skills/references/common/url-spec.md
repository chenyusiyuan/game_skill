# URL 规范

适用于 `@web-page` 和 `@mobile-page` 的 `url` 属性，以及 API `@api` 的 `path` 属性。

---

## 页面 URL 规则（前端）

### 1. 单级路径
每个页面 url 只能有一个层级，不使用子目录：
- ✅ `/note-detail`
- ❌ `/notes/detail`

### 2. 统一使用查询参数，不使用路径参数
- ✅ `/note-detail?note_id=uuid`
- ❌ `/notes/:id`

### 3. 语义化参数名（snake_case + `_id` 后缀）
- ✅ `note_id`、`user_id`、`article_id`
- ❌ `id`、`noteId`

### 4. url 与文件名对齐
url 去掉 `/`，即为 impl 文件的目录名（首页 `/` 例外，文件名 `home`）：
- `/notes` → `app/notes/page.tsx`（web）或 `app/notes/index.tsx`（mobile）
- `/note-detail` → `app/note-detail/page.tsx`

### 页面类型与 URL 模式

| 页面类型 | URL 模式 | 示例 |
|---------|---------|------|
| 首页 | `/` | `/` |
| 列表页 | `/xxx` 或 `/xxx-list` | `/notes`、`/article-list` |
| 详情页 | `/xxx-detail?xxx_id=uuid` | `/note-detail?note_id=uuid` |
| 表单页 | `/xxx-form` | `/note-form`，编辑时加 `?note_id=uuid` |
| 登录页 | `/login` | `/login` |
| 管理首页 | `/admin` | `/admin` |
| 管理列表 | `/admin-xxx` | `/admin-notes` |

---

## API 路径规则（后端）

### RESTful 风格，资源复数，kebab-case

```
GET    /api/notes              # 列表
POST   /api/notes              # 创建
GET    /api/notes/:id          # 详情（后端用路径参数）
PUT    /api/notes/:id          # 更新
DELETE /api/notes/:id          # 删除
```

注意：API 路径（后端）与页面 URL（前端）规则不同：
- **前端**：不用路径参数，用查询参数 `?note_id=xxx`
- **后端 API**：可以用路径参数 `/api/notes/:id`

---

## 常用查询参数名

| 参数名 | 类型 | 默认值 | 说明 |
|-------|------|-------|------|
| page | int | 1 | 页码 |
| size | int | 20 | 每页数量 |
| sort_by | string | "created_at" | 排序字段 |
| order | string | "desc" | 排序方向 asc/desc |
| keyword | string | "" | 搜索关键词 |
| is_published | boolean | — | 发布状态 |
| start_date | string | — | 开始日期 YYYY-MM-DD |
| end_date | string | — | 结束日期 YYYY-MM-DD |

常用 `sort_by` 值：`created_at`、`updated_at`、`view_count`、`like_count`、`rating`、`price`

参数语义必须单一，不得复合：
- ✅ `sort_by=created_at&order=desc`
- ❌ `sort=created_at_desc`

---

## 导航约束

导航菜单（@nav 中的条目）只能指向**无必需参数**的 url：
- ✅ `/`、`/notes`、`/admin`
- ❌ `/note-detail?note_id=xxx`（含必需参数，不能作为导航入口）

缺少必需参数访问详情页时，自动重定向到对应列表页。
