import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

test("native integration-test selection preserves product, rename, and explicit full gates", () => {
  const workflow = z
    .object({
      jobs: z.object({
        scope: z.object({
          steps: z.array(
            z.object({
              id: z.string().optional(),
              run: z.string().optional(),
            }),
          ),
        }),
      }),
    })
    .parse(
      Bun.YAML.parse(
        readFileSync(
          join(import.meta.dir, "../../.github/workflows/pr.yml"),
          "utf8",
        ),
      ),
    );
  const script = z
    .string()
    .parse(
      workflow.jobs.scope.steps.find((step) => step.id === "browser-scope")
        ?.run,
    );
  const temporary = mkdtempSync(join(tmpdir(), "nook-pr-scope-"));
  const cwd = join(temporary, "repo");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const commit = (message: string) => {
    git("add", ".");
    git(
      "-c",
      "user.name=CI",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      message,
    );
    return git("rev-parse", "HEAD");
  };
  const scope = (base: string, validation = false, fullE2e = false) => {
    const output = join(temporary, "outputs");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", script], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: join(temporary, "gitconfig"),
        GITHUB_WORKSPACE: cwd,
        RUNNER_TEMP: temporary,
        GITHUB_OUTPUT: output,
        BASE_SHA: base,
        DRAFT: "false",
        VALIDATION_REQUESTED: String(validation),
        FULL_E2E_REQUESTED: String(fullE2e),
      },
    });
    expect(result.status, result.stderr).toBe(0);
    return Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
  };
  try {
    mkdirSync(cwd);
    git("init", "-q");
    const base = commit("base");
    const auth = "nook-app/nook-platform/nook-auth2/tests";
    const core = "nook-app/nook-platform/nook-core/tests";
    for (const directory of [auth, core]) {
      mkdirSync(join(cwd, directory), { recursive: true });
      writeFileSync(join(cwd, directory, "flow.rs"), "");
    }
    const tests = commit("add integration tests");
    expect(scope(base)).toMatchObject({
      native_tests: "true",
      validation: "false",
      full_e2e: "false",
    });
    for (const fullE2e of [false, true]) {
      expect(scope(base, true, fullE2e)).toMatchObject({
        validation: "true",
        full_e2e: "true",
      });
    }
    git("rm", `${auth}/flow.rs`);
    commit("remove the last auth2 integration test");
    expect(scope(tests)).toMatchObject({
      native_tests: "true",
      validation: "false",
    });
    git("mv", `${core}/flow.rs`, "nook-app/nook-platform/nook-core/build.rs");
    commit("move integration code into a product build script");
    expect(scope(tests)).toMatchObject({
      native_tests: "true",
      validation: "true",
      full_e2e: "true",
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
