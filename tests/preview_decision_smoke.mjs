#!/usr/bin/env node
import assert from "node:assert/strict";
import { decidePreviewStatus } from "../scripts/check_preview.js";

function health(overrides = {}) {
  return {
    runtime: { status: "ok" },
    importScan: { status: "ok" },
    prepare: { status: "ok" },
    typecheck: { status: "ok" },
    build: { status: "ok" },
    devServer: { status: "ok" },
    browser: { status: "ok" },
    pageMount: { status: "ok" },
    pageError: { status: "ok" },
    canvas: { status: "ok" },
    ...overrides,
  };
}

assert.equal(decidePreviewStatus({ health: health() }).status, "preview-ready");

const buildBlocked = decidePreviewStatus({
  health: health({ build: { status: "blocked", reason: "vite-build-failed" } }),
});
assert.equal(buildBlocked.status, "preview-blocked");
assert.equal(buildBlocked.reason, "vite-build-failed");

const pageError = decidePreviewStatus({
  health: health({ pageError: { status: "blocked", reason: "pageerror-on-mount" } }),
});
assert.equal(pageError.status, "preview-blocked");
assert.equal(pageError.reason, "pageerror-on-mount");

console.log("OK preview_decision_smoke");
