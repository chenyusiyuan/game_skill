import { emitMilestone } from "./milestone";

const canvas = document.createElement("canvas");
canvas.width = 160;
canvas.height = 90;
document.body.append(canvas);

const maybeContext = canvas.getContext("2d");
if (!maybeContext) throw new Error("2d canvas unavailable");
const context = maybeContext;

let playerX = 20;
let score = 0;

function syncState(): void {
  window.__state = { score, playerX };
}

function draw(): void {
  context.fillStyle = "#101820";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f6d365";
  context.fillRect(playerX, 35, 20, 20);
}

window.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowRight") return;
  playerX += 40;
  score += 1;
  syncState();
  draw();
  emitMilestone("primary-progress", { kind: "move-right", value: score });
});

syncState();
draw();
