import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const compileDockerfilePath = path.resolve(
  "nook-app/nook-platform/docker/rust/compile.Dockerfile",
);

const forbiddenOperationPatterns = [
  /cargo\s+test/i,
  /cargo\s+clippy/i,
  /(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?(?:test|check|lint|verify|audit|coverage|e2e|preflight)(?:[^a-z0-9_]|$)/i,
  /(?:bun|npm|pnpm|yarn)\s+run\s+build(?:[^a-z0-9_]|$)/i,
  /coverage/i,
  /(?:^|[^a-z0-9_])e2e(?:[^a-z0-9_]|$)/i,
  /(?:^|[^a-z0-9_])preflight(?:[^a-z0-9_]|$)/i,
];

void test("compile-only Dockerfile contains no forbidden operations", () => {
  const dockerfile = fs.readFileSync(compileDockerfilePath, "utf8");

  for (const forbiddenOperationPattern of forbiddenOperationPatterns) {
    assert.doesNotMatch(dockerfile, forbiddenOperationPattern);
  }

  assert.doesNotMatch(dockerfile, /^COPY[^\n]*\bTaskfile\.yml\s+\.\/$/m);
  assert.match(
    dockerfile,
    /task --dir nook-app\/nook-platform rust:ci:verify-built/,
  );
});
