import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const gameDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(gameDir, '../../..');
const caseName = path.basename(path.dirname(gameDir));

export default defineConfig({
  root: gameDir,
  cacheDir: path.join(repoRoot, 'node_modules/.vite-mini-game', caseName),
  server: { fs: { allow: [repoRoot] } },
  build: { outDir: 'dist', emptyOutDir: true }
});
