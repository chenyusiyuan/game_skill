import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanForbiddenImports } from "../scripts/scan_forbidden_imports.js";

const tempRoot = mkdtempSync(join(tmpdir(), "import-scan-"));

function writeCase(slug, source) {
  const caseDir = join(tempRoot, "cases", slug);
  mkdirSync(join(caseDir, "game/src/scenes"), { recursive: true });
  writeFileSync(join(caseDir, "game/src/main.ts"), source, "utf8");
  writeFileSync(join(caseDir, "game/src/scenes/PlayScene.ts"), "export const ok = true;\n", "utf8");
  return caseDir;
}

try {
  const local = scanForbiddenImports(writeCase("local", 'import "./scenes/PlayScene";\nimport "./milestone";\n'), { repoRoot: tempRoot });
  assert.equal(local.ok, true);

  const templates = scanForbiddenImports(
    writeCase("template-import", 'import "../../../templates/scaffold/main";\n'),
    { repoRoot: tempRoot },
  );
  assert.equal(templates.ok, false);
  assert.equal(templates.reason, "forbidden-repo-dependency");

  const scripts = scanForbiddenImports(
    writeCase("script-import", 'import "../../../scripts/check_delivery";\n'),
    { repoRoot: tempRoot },
  );
  assert.equal(scripts.ok, false);
  assert.equal(scripts.reason, "forbidden-repo-dependency");

  const schemas = scanForbiddenImports(
    writeCase("schema-import", 'import "../../../schemas/plan.schema.json";\n'),
    { repoRoot: tempRoot },
  );
  assert.equal(schemas.ok, false);
  assert.equal(schemas.reason, "forbidden-repo-dependency");

  const archive = scanForbiddenImports(
    writeCase("archive-import", 'import "../../../archive/old-runtime/index";\n'),
    { repoRoot: tempRoot },
  );
  assert.equal(archive.ok, false);
  assert.equal(archive.reason, "forbidden-repo-dependency");

  const legacy = scanForbiddenImports(
    writeCase("legacy-import", 'import "../../../legacy/old-runtime/index";\n'),
    { repoRoot: tempRoot },
  );
  assert.equal(legacy.ok, false);
  assert.equal(legacy.reason, "forbidden-repo-dependency");

  const siblingCase = scanForbiddenImports(
    writeCase("sibling-case", 'const mod = await import("../../../other-case/game/src/main");\n'),
    { repoRoot: tempRoot },
  );
  assert.equal(siblingCase.ok, false);
  assert.equal(siblingCase.reason, "sibling-case-dependency");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("OK forbidden_import_smoke");
