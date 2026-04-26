---
game-aprd: "0.1"
project: trace-extractor-test-001
platform: [web]
runtime: canvas
mode: 单机
language: zh-CN
is-3d: false
color-scheme:
  palette-id: pixel-retro
  theme-keywords: [test]
  primary: "#ff0000"
  secondary: "#00ff00"
  accent: "#0000ff"
  background: "#000000"
  surface: "#111111"
  text: "#ffffff"
  text-muted: "#aaaaaa"
  success: "#00ff00"
  error: "#ff0000"
  border: "#333333"
  font-family: "monospace"
  border-radius: "0"
  shadow: "none"
  fx-hint: pixel
---

# Trace Extractor Test

## 1. 项目概述
### @game(main) Trace Extractor Test
> genre: board-grid
> platform: [web]
> runtime: canvas
> mode: 单机
> core-loop: [@flow(play)]
> player-goal: "test"
> scenes: [@scene(play)]
> states: []
> levels: []
> resources: []
> controls: []

## 2. 目标玩家与使用场景
test

## 3. 核心玩法边界与 MVP 定义
test

## 4. 主干流程
### @flow(play) play
> entry: @scene(play)
> main-scene: @scene(play)
> exit: @scene(play)

## 5. 场景规格
### @scene(play) Play
> entry: true

## 6. 状态与实体
### @entity(pig) 小猪
> type: unit
> fields: "ammo: number, color: string"

## 7. 规则与系统
### @rule(score-up) 得分增加
> trigger: "match success"
> effect: "state.score += 10 ; pig.ammo -= 1"

### @rule(use-ammo) 弹药消耗
> trigger: "attack"
> effect: "pig.ammo -= 1"

## 8. 资源与数据
test

## 9. 运行方式与框架策略
test

## 10. 校验点与验收标准
test
