---
name: appgen-codegen
description: "应用生成 Phase 4: 代码生成。基于 PRD + 设计系统 + 原型，生成可运行的工程代码。支持多端架构：一套服务端 API 供多个客户端调用。"
---

# Phase 4: 代码生成

## 职责

将原型转化为可运行的工程代码。核心架构原则：**一套服务端，多个客户端**。

```
                    ┌─────────────┐
                    │  Server API │  ← 统一 RESTful API
                    │  (Next.js)  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Web 端   │ │ Expo 端  │ │ 小程序端 │
        │ (Next.js)│ │ (RN)     │ │ (未来)   │
        └──────────┘ └──────────┘ └──────────┘
```

## 输出

| 目录 | 说明 |
|------|------|
| `server/` | 服务端 API（Next.js API Routes / 或独立 Express） |
| `web/` | Web 客户端（Next.js App Router） |
| `mobile/` | Mobile 客户端（Expo，如需） |
| `shared/` | 多端共享类型和工具（TypeScript 类型、API client） |

## 多端架构

### 纯 Web 项目

如果只有 Web 端，server 和 web 可以合并为一个 Next.js 全栈项目：

```
server/              ← Next.js 全栈（API Routes + Pages）
shared/              ← 类型定义
```

### 多端项目（Web + Mobile）

服务端必须独立，通过 API 服务所有客户端：

```
server/              ← 独立 API 服务（Next.js API Routes 或 Express）
web/                 ← Web 客户端（Next.js，仅前端，调 server API）
mobile/              ← Expo 客户端（调 server API）
shared/              ← 共享类型 + API client 封装
```

**shared/ 目录**的作用：
- `shared/types/` — 所有端共享的 TypeScript 类型
- `shared/api-client.ts` — API 调用封装（多端复用）
- `shared/constants.ts` — 共享常量

### 判断逻辑

```
用户需求 → PRD 中有 Mobile 页面规格?
  是 → 多端架构（server/ + web/ + mobile/ + shared/）
  否 → 纯 Web（server/ 全栈）
```

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 服务端 | Next.js 15 (API Routes) / Express | API + 数据库 |
| Web 客户端 | Next.js 15 (App Router) | TypeScript + Tailwind |
| Mobile 客户端 | Expo SDK 52+ (Expo Router) | TypeScript + NativeWind |
| ORM | Drizzle + SQLite (dev) | schema 按模块拆分在 `server/src/db/schema/*.ts`，可切换 PostgreSQL |
| 共享层 | TypeScript | 类型 + API client |

## Server 目录结构

```
server/
├── app/
│   └── api/                          ← 路由层：HTTP 处理、参数校验、调用 service
│       ├── notes/
│       │   └── route.ts
│       └── auth/
│           ├── login/route.ts
│           └── register/route.ts
├── src/
│   ├── db/
│   │   ├── schema/                   ← Drizzle schema，按模块拆分
│   │   │   ├── auth.ts               ← @server-module(auth) 的所有 model
│   │   │   ├── notes.ts              ← @server-module(notes) 的所有 model
│   │   │   └── ...
│   │   └── index.ts                  ← db client（drizzle()）+ re-export schema
│   ├── services/                     ← 业务逻辑层：与 HTTP 无关，调用 db
│   │   ├── auth.service.ts           ← 对应 @server-module(auth)
│   │   ├── notes.service.ts          ← 对应 @server-module(notes)
│   │   └── ...
│   └── lib/                          ← 工具函数：不含业务逻辑
│       ├── auth.ts                   ← JWT 签发/验证、密码哈希
│       └── response.ts               ← 统一响应格式工具
├── drizzle/                          ← drizzle-kit 生成的 migrations
└── drizzle.config.ts                 ← drizzle-kit 配置（schema glob: src/db/schema/*.ts）
```

**三层分离原则**：
- **路由层** (`app/api/*/route.ts`)：解析 HTTP 请求、参数校验、调用 service、返回响应。不写业务逻辑。
- **业务层** (`src/services/*.service.ts`)：调用 db 操作数据库，实现业务规则。不感知 HTTP（无 `Request`/`Response`）。对应 `@server-module`。
- **DB 层** (`src/db/`)：schema 定义 + db client。每个 schema 文件对应一个 `@server-module`，供业务层 import。
- **工具层** (`src/lib/`)：无业务的纯工具函数（JWT、加密、格式化）。

## 流程

1. **读取 PRD**：确定功能模块和 API 端点
2. **确定架构**：纯 Web 还是多端
3. **生成 server/**：API Routes + Drizzle schema + 业务逻辑
4. **生成 shared/**（多端时）：类型定义 + API client
5. **生成 web/**：从原型 HTML 还原为 React 组件
6. **生成 mobile/**（如需）：从原型映射为 RN 组件
7. **按模块并行**：使用 module-codegen 子 agent 通过 `task_new` 按功能模块并行生成

## 子 Agent 并行

Phase 4 通过 `task_new` 将功能模块分发给 module-codegen 子 agent，在同一 turn 内并发发出：

```
主 agent（同一 turn 内并发）：
  → task_new({ task: "生成 auth 模块 ...", task_id: "codegen-auth", agent_role: "module-codegen" })
  → task_new({ task: "生成 user 模块 ...", task_id: "codegen-user", agent_role: "module-codegen" })
  → task_new({ task: "生成 order 模块 ...", task_id: "codegen-order", agent_role: "module-codegen" })
  → 等待所有 task_new 返回
  → 整合、检查引用关系、运行 build
```

## 质量检查

- [ ] `npm install` 无错误
- [ ] `npm run build` 通过
- [ ] API 端点与 PRD 中 `@api` 定义一一对应
- [ ] React 组件与原型视觉一致
- [ ] 如多端，shared/ 类型被所有端正确引用
