import { Application, Graphics, Text, Container, Rectangle, Assets, Sprite } from "pixi.js";
import { state } from "./state.js";

(async () => {
  const app = new Application();
  await app.init({
    width: 800,
    height: 600,
    background: "#1e293b",
    antialias: true,
  });

  // === 素材加载（对照 specs/assets.yaml 中的 local-file 条目） ===
  // 路径前缀：游戏代码在 cases/{project}/game/ 下，素材在项目根的 assets/library_2d/ 下
  // 需要回退 3 级：../../../assets/library_2d/...
  //
  // 示例（根据 assets.yaml 替换为实际素材路径）：
  // const BASE = "../../../assets/library_2d";
  // await Assets.load([
  //   { alias: "player", src: `${BASE}/tiles/dungeon/tile_0030.png` },
  //   { alias: "floor", src: `${BASE}/tiles/dungeon/tile_0000.png` },
  // ]);
  // const playerSprite = Sprite.from("player");
  //
  // ⚠️ 如果 assets.yaml 有 local-file 素材，此处必须加载，禁止全部用 Graphics 程序化绘制替代

  document.getElementById("root").appendChild(app.canvas);

  window.app = app;

  const title = new Text({
    text: "PixiJS v8 Template",
    style: { fontSize: 28, fill: "#f8fafc", fontFamily: "system-ui, sans-serif" },
  });
  title.x = 20;
  title.y = 20;
  app.stage.addChild(title);

  const scoreLabel = new Text({
    text: "Score: 0",
    style: { fontSize: 20, fill: "#fbbf24", fontFamily: "system-ui, sans-serif" },
  });
  scoreLabel.x = 20;
  scoreLabel.y = 60;
  app.stage.addChild(scoreLabel);

  const box = new Graphics()
    .rect(0, 0, 100, 100)
    .fill({ color: 0x0ea5e9 })
    .stroke({ width: 2, color: 0xffffff });
  box.x = 400;
  box.y = 300;
  box.pivot.set(50, 50);
  box.eventMode = "static";
  box.cursor = "pointer";
  box.on("pointerdown", () => {
    state.phase = "playing";
    state.score += 1;
    scoreLabel.text = `Score: ${state.score}`;
  });
  app.stage.addChild(box);

  app.ticker.add((ticker) => {
    if (state.phase === "playing") {
      box.rotation += 0.02 * ticker.deltaTime;
    }
  });

  // === Test API (Phase 5 校验需要) ===
  window.gameTest = window.gameTest || {};
  window.gameTest.observers = {
    getSnapshot: () => JSON.parse(JSON.stringify(window.gameState)),
    getTrace: () => [...(window.__trace || [])],
    getAssetUsage: () => [...(window.__assetUsage || [])],
  };
  window.gameTest.drivers = {
    // codegen 阶段按实际 UI 填充
  };
  window.gameTest.probes = {
    resetWithScenario: (scenario) => {
      // TODO(codegen): 此 stub 必须被完整实现，不是占位符。契约清单（codegen.md Step 4.0.5.1）：
      //   1. scenario.fields 每一条都要写回 state（entities[].initial 里声明的所有字段）
      //   2. scenario 每个 entity collection（moles / grid-cells / pigs / blocks 等）
      //      teardown（销毁 sprite + off 事件）+ rebuild（按声明重建）
      //   3. 清所有 spawn/cooldown timer（clearTimeout / app.ticker.remove）+ pool/gate accounting
      //   4. 尊重 scenario.fields['game.phase']，不硬写成 idle
      //   5. 结束前刷 UI（updateUI()、scoreLabel.text 等）
      // check_project 会静态扫描；只 warn 或只改 score/misses 都会 fail。
      console.warn('probes.resetWithScenario: stub — codegen 需实现完整契约');
    },
    stepTicks: (n) => {
      console.warn('probes.stepTicks: stub — codegen 需实现');
    },
  };
})();
