import "./milestone";

Object.defineProperty(window, "WebGLRenderingContext", {
  configurable: true,
  value: undefined,
});
Object.defineProperty(window, "WebGL2RenderingContext", {
  configurable: true,
  value: undefined,
});

void (async () => {
  const Phaser = (await import("phaser")).default;
  const { PlayScene } = await import("./scenes/PlayScene");

  const config = {
    type: Phaser.CANVAS,
    parent: "app",
    width: 640,
    height: 360,
    backgroundColor: "#101820",
    scene: [PlayScene],
  };

  new Phaser.Game(config);
})();
