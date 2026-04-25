---
name: appgen-testing
description: "应用生成 Phase 5: 测试。为生成的代码编写单元测试和 E2E 测试，确保 API 端点和核心用户流程可用。"
---

# Phase 5: 测试

## 职责

为 Phase 4 生成的代码编写和运行测试。测试不是可选的——每个 API 端点至少一个测试用例，核心用户流程至少一个 E2E 测试。

## 输出

| 文件 | 说明 |
|------|------|
| `workspace/server/__tests__/` | API 端点测试 |
| `workspace/web/e2e/` | Web E2E 测试 |
| 测试运行结果 | 控制台输出 + 通过率 |

## 测试策略

### API 测试（必须）

- 框架：Vitest
- 覆盖：api-contract.md 中的每个端点
- 模式：请求 → 预期 status + body 结构
- 数据：基于 PRD 数据模型生成 fixtures

### Web E2E 测试（必须）

- 框架：Playwright
- 覆盖：PRD 中定义的核心用户流程（如注册→登录→创建→查看）
- 不要求覆盖所有页面，但核心流程必须通过

### Mobile 测试（如有移动端）

- 基于 Expo，使用 Jest + React Native Testing Library
- 覆盖核心组件渲染和 API 调用

## 流程

1. **读取 api-contract.md** — 确定需要测试的端点
2. **编写 API 测试** — 每个端点至少一个 happy path 测试
3. **运行 API 测试** — `npx vitest run`
4. **编写 E2E 测试** — 核心用户流程
5. **运行 E2E 测试** — `npx playwright test`
6. **修复失败** — 区分代码 bug 和测试 bug
7. **报告结果** — 说明通过率和已知问题

## 质量检查

- [ ] API 测试覆盖所有端点
- [ ] E2E 测试覆盖至少一个核心流程
- [ ] 所有测试通过（或已知问题已标记）
