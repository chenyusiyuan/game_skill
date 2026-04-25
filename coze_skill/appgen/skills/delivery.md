---
name: appgen-delivery
description: "应用生成 Phase 6: 交付。运行构建验证，整理产出物，生成交付文档。"
---

# Phase 6: 交付

## 职责

确认生成的代码工程可以正常构建和运行，整理产出物，生成交付文档。

## 输出

| 文件 | 说明 |
|------|------|
| `docs/delivery.md` | 交付文档 |
| `README.md` | 项目 README |

## 流程

1. **构建验证**
   - `cd server && npm install && npm run build`
   - `cd web && npm install && npm run build`（如有独立 web）
   - 确认零错误
2. **Lint 检查**（如有配置）
3. **生成 delivery.md**
4. **生成 README.md**

## delivery.md 模板

```markdown
# 交付文档

## 项目概述
- 产品名称：
- 目标平台：Web / Mobile / 多端
- 技术栈：

## 项目结构
（目录树说明）

## 本地运行
### 环境要求
- Node.js >= 18
- npm >= 9

### 启动步骤
1. `cd server && npm install`
2. `npx drizzle-kit push`（如有数据库）
3. `npm run dev`

## 环境变量
| 变量 | 说明 | 默认值 |
|------|------|--------|

## 数据库
- ORM：Drizzle
- 开发环境：SQLite
- 初始化：`npx drizzle-kit push`

## 已知限制
（列出当前版本的局限）

## 后续建议
（部署、性能优化、功能扩展建议）
```

## 质量检查

- [ ] 所有工程 `npm run build` 通过
- [ ] delivery.md 完整
- [ ] README.md 包含启动步骤
