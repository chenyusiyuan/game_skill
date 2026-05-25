import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const gameDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(gameDir, '../../..');

export default defineConfig({
  root: gameDir,
  server: { fs: { allow: [repoRoot] } },
  build: { outDir: 'dist', emptyOutDir: true }
});
