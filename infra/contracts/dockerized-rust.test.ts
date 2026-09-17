import { test, expect } from 'bun:test';
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { DockerizedRustE2eContract } from './dockerized-rust-e2e.fixture';
import { DockerizedRustToolingContract } from './dockerized-rust-tooling.fixture';

const tasksSchema = z.object({
  tasks: z.object({
    'preflight:policy:run': z.object({ cmds: z.array(z.string()) }),
  }),
});

interface GitFixtureCommand {
  cwd: string;
  args: string[];
}

class DockerizedRustContract {
  private readonly root = resolve(import.meta.dir, '../..');

  previewGates(): void {
    const workflow = z
      .object({
        jobs: z.record(
          z.string(),
          z.object({
            needs: z.union([z.string(), z.array(z.string())]).optional(),
            if: z.string().optional(),
            steps: z
              .array(
                z.object({
                  run: z.string().optional(),
                  if: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ),
      })
      .parse(Bun.YAML.parse(this.read('.github/workflows/pr.yml')));
    const preview = z
      .object({
        needs: z.array(z.string()),
        steps: z
          .tuple([z.object({ run: z.string() })])
          .rest(z.object({ run: z.string().optional() })),
      })
      .parse(workflow.jobs.preview);
    const script = preview.steps[0].run;
    expect(preview.needs).toContain('wasm-node-test');
    expect(preview.needs).toContain('extension-e2e');
    expect(Object.keys(workflow.jobs)).not.toContain(
      'auth-sensitive-extension-e2e',
    );
    expect(Object.keys(workflow.jobs)).not.toContain('full-extension-e2e');
    const extension = z
      .object({
        if: z.string(),
        steps: z.array(
          z.object({ if: z.string().optional(), run: z.string().optional() }),
        ),
      })
      .parse(workflow.jobs['extension-e2e']);
    expect(extension.if).toContain('always()');
    expect(extension.if).toContain("needs.verify.result == 'success'");
    expect(extension.if).toContain(
      "inputs.full_e2e_requested || needs.verify.outputs.auth-sensitive-e2e-required == 'true'",
    );
    expect(extension.steps).toEqual([
      { if: 'inputs.full_e2e_requested', run: 'task _extension:test:e2e' },
      {
        if: '${{ !inputs.full_e2e_requested }}',
        run: 'task _extension:test:e2e:file',
      },
    ]);
    for (const job of ['extension-e2e', 'full-e2e-shard']) {
      const dependent = z
        .object({ needs: z.array(z.string()) })
        .parse(workflow.jobs[job]);
      expect(dependent.needs).not.toContain('wasm-node-test');
      expect(dependent.needs).toContain('verify');
    }
    for (const full of ['true', 'false']) {
      for (const auth of ['true', 'false']) {
        for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
          for (const node of ['success', 'failure', 'cancelled', 'skipped']) {
            const run = spawnSync('bash', ['-c', script], {
              encoding: 'utf8',
              env: {
                ...process.env,
                NATIVE_RESULT: 'success',
                WASM_RESULT: 'success',
                WEB_RESULT: 'success',
                WASM_NODE_RESULT: node,
                UI_DEMOS_ENABLED: 'false',
                UI_DEMO_REQUIRED: 'false',
                UI_DEMO_RESULT: 'skipped',
                AUTH_SENSITIVE_E2E_REQUIRED: auth,
                FULL_E2E_REQUESTED: full,
                EXTENSION_E2E_RESULT: result,
              },
            });
            expect(run.status === 0, run.stdout).toBe(
              (result === 'success' ||
                (full === 'false' && auth === 'false')) &&
                node === 'success',
            );
          }
        }
      }
    }
  }

  ecosystemResults(): void {
    const tasks = z
      .object({
        tasks: z.object({
          'docker:ecosystem:smoke': z.object({ cmds: z.array(z.string()) }),
        }),
      })
      .parse(
        Bun.YAML.parse(this.read('nook-app/nook-platform/docker/Taskfile.yml')),
      );
    const script = z
      .string()
      .parse(tasks.tasks['docker:ecosystem:smoke'].cmds[0]);
    const temporary = mkdtempSync(join(tmpdir(), 'nook-ecosystem-results-'));
    try {
      writeFileSync(
        join(temporary, 'task'),
        '#!/bin/sh\ncase ",$FAILURES," in *",$1,"*) exit 1 ;; *) exit 0 ;; esac\n',
        { mode: 0o755 },
      );
      for (let failures = 0; failures < 8; failures += 1) {
        const selected = [];
        if (failures & 1) selected.push('docker:ecosystem:deterministic');
        if (failures & 2) selected.push('docker:ecosystem:fuzz');
        if (failures & 4) selected.push('docker:ecosystem:kani');
        const run = spawnSync('bash', ['-e', '-c', script], {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${temporary}:${process.env.PATH}`,
            FAILURES: selected.join(','),
          },
        });
        expect(run.status === 0, run.stdout).toBe(failures === 0);
        expect(run.stdout).toContain('Deterministic tests');
        expect(run.stdout).toContain('Fuzz smoke');
        expect(run.stdout).toContain('Kani proofs');
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  coverageAndExporter(): void {
    const pr = this.read('.github/workflows/pr.yml');
    const checks = this.read('.github/workflows/rust-ecosystem-checks.yml');
    const product = this.read(
      'nook-app/nook-platform/docker/rust/product.Dockerfile',
    );
    expect(pr).toContain('native_coverage_provided: true');
    expect(checks).toContain('type: boolean\n        default: false');
    expect(product).toContain('ARG NATIVE_COVERAGE_PROVIDED=false');
    expect(product).toContain(
      'true) INSTA_UPDATE=no cargo test --locked -p nook-replication --doc',
    );
    expect(product).toContain(
      'false) INSTA_UPDATE=no cargo test --locked -p nook-replication ;;',
    );
    expect(product).toContain(
      'INSTA_UPDATE=no cargo llvm-cov nextest --no-clean --profile ci -p nook-replication',
    );
    expect(product).toContain(
      "RUSTFLAGS='--cfg loom' cargo test --locked -p nook-replication loom_tests --release",
    );
  }

  workflowTooling(): void {
    for (const file of readdirSync(join(this.root, '.github/workflows'))) {
      if (!file.endsWith('.yml')) continue;
      const source = readFileSync(
        join(this.root, '.github/workflows', file),
        'utf8',
      );
      expect(source).not.toMatch(
        /uses: (?:dtolnay\/rust-toolchain|Swatinem\/rust-cache)/,
      );
      expect(source).not.toMatch(/^\s*(?:run:\s*)?(?:cargo|rustup|rustfmt)\s/m);
    }
    const ecosystem = this.read('.github/workflows/rust-ecosystem-checks.yml');
    expect(ecosystem).toContain('SCCACHE_OPTIONAL:');
    expect(ecosystem).toContain("'dependabot[bot]') && '1' || ''");
    expect(ecosystem.match(/uses: docker\/setup-buildx-action/g)).toHaveLength(
      3,
    );
    let routedJobs = 0;
    for (const line of ecosystem.split('\n')) {
      if (!line.trimStart().startsWith('runs-on:')) continue;
      routedJobs += 1;
      expect(line).toContain(
        'github.event.pull_request.head.repo.full_name == github.repository',
      );
      expect(line).toContain(
        "github.event.pull_request.user.login != 'dependabot[bot]'",
      );
      expect(line).toContain(
        "(vars.NOOK_RUNS_ON || 'nook-k0s') || 'ubuntu-latest'",
      );
    }
    expect(routedJobs).toBe(3);

    expect(this.read('.github/formatting/Dockerfile')).toContain(
      'prettier-skill.json',
    );
    const audit = this.read('.github/docker/rust-maintenance.hcl');
    expect(audit).toContain('no-cache-filter = ["audit"]');
    expect(audit).not.toContain('no-cache = true');
    expect(this.read('.github/scripts/remote-task-batch.sh')).toContain(
      'loom:verify) run_with_timeout "$timeout_minutes" task preflight:loom-verify',
    );
    const dockerignore = this.read('.dockerignore').split('\n');
    const generatedWasm =
      'nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm';
    expect(dockerignore).toContain(`${generatedWasm}*`);
    expect(
      dockerignore.indexOf(`!${generatedWasm}/.gitignore`),
    ).toBeGreaterThan(dockerignore.indexOf(`${generatedWasm}*`));
    expect(dockerignore).toContain('**/node_modules');
  }

  compileExtensionUsesOwnFrozenDependencies(): void {
    const compile = this.read(
      'nook-app/nook-platform/docker/rust/compile.Dockerfile',
    );
    const extensionDependencyStage = compile.indexOf(
      'FROM compile-web-dependencies AS compile-web-extension-dependencies',
    );
    const webStage = compile.indexOf('FROM web-base AS compile-web');
    const extensionTypecheck = compile.indexOf(
      'RUN cd nook-app/nook-web/nook-web-extension',
    );
    const extensionBuild = compile.indexOf(
      'bun scripts/build.ts',
      extensionTypecheck,
    );
    expect(extensionDependencyStage).toBeGreaterThanOrEqual(0);
    expect(webStage).toBeGreaterThan(extensionDependencyStage);
    expect(extensionTypecheck).toBeGreaterThan(webStage);
    expect(extensionBuild).toBeGreaterThan(extensionTypecheck);

    const dependencyStage = compile.slice(extensionDependencyStage, webStage);
    expect(dependencyStage).toContain(
      'COPY nook-app/nook-web/nook-web-extension/package.json nook-app/nook-web/nook-web-extension/bun.lock',
    );
    expect(dependencyStage).toContain('bun install --frozen-lockfile');

    const webBuildStage = compile.slice(webStage, extensionTypecheck);
    expect(webBuildStage).toContain(
      'COPY --from=compile-web-extension-dependencies /meta-secret/nook/nook-app/nook-web/nook-web-extension/node_modules',
    );
    expect(webBuildStage).not.toContain(
      'ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-web-extension/node_modules',
    );
  }

  portableGitMetadata(): void {
    const temporary = mkdtempSync(join(tmpdir(), 'nook-policy-git-'));
    try {
      this.command({ cwd: temporary, args: ['init', '-q'] });
      this.command({
        cwd: temporary,
        args: ['config', 'user.email', 'test@example.invalid'],
      });
      this.command({
        cwd: temporary,
        args: ['config', 'user.name', 'Policy Test'],
      });
      writeFileSync(join(temporary, 'source.txt'), 'baseline\n');
      this.command({ cwd: temporary, args: ['add', '.'] });
      this.command({ cwd: temporary, args: ['commit', '-qm', 'baseline'] });
      const base = this.command({
        cwd: temporary,
        args: ['rev-parse', 'HEAD'],
      }).trim();
      this.command({
        cwd: temporary,
        args: ['update-ref', 'refs/remotes/origin/main', base],
      });
      writeFileSync(join(temporary, 'source.txt'), 'head\n');
      this.command({ cwd: temporary, args: ['commit', '-qam', 'head'] });
      this.command({
        cwd: temporary,
        args: [
          'config',
          'http.https://example.invalid/.extraheader',
          'fixture-credential',
        ],
      });
      writeFileSync(join(temporary, '.git/hooks/pre-commit'), 'fixture-hook');
      const event = join(temporary, 'event.json');
      writeFileSync(
        event,
        JSON.stringify({ pull_request: { base: { sha: base } } }),
      );
      const task = tasksSchema.parse(
        Bun.YAML.parse(this.read('preflight/Taskfile.yml')),
      );
      const command = task.tasks['preflight:policy:run'].cmds[0];
      if (!command) throw new Error('Policy command missing');
      const prefix = command
        .slice(0, command.indexOf('PREFLIGHT_SOURCE_CONTEXT='))
        .replaceAll('{{.REPO_ROOT}}', temporary)
        .replaceAll('{{.POLICY_STAGE}}', 'repository-policy');
      const result = spawnSync(
        'bash',
        [
          '-c',
          prefix +
            `
        test "$(git --git-dir="$metadata/git" show HEAD:source.txt)" = head
        test "$(git --git-dir="$metadata/git" show origin/main:source.txt)" = baseline
        test "$(git --git-dir="$metadata/git" ls-files)" = source.txt
        test ! -e "$metadata/git/objects/info/alternates"
        test ! -e "$metadata/git/hooks/pre-commit"
        ! git --git-dir="$metadata/git" config --get-regexp 'http.*extraheader'
        ! git --git-dir="$metadata/git" config --get remote.origin.url
        test "$(jq -r .pull_request.base.sha "$metadata/event.json")" = '${base}'
      `,
        ],
        { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event } },
      );
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  formatterExport(): void {
    const temporary = mkdtempSync(join(tmpdir(), 'nook-formatter-export-'));
    try {
      const implementation = join(temporary, 'implementation');
      const bin = join(temporary, 'bin');
      mkdirSync(join(implementation, 'preflight'), { recursive: true });
      mkdirSync(join(implementation, '.git'));
      mkdirSync(bin);
      writeFileSync(join(implementation, '.git/config'), 'fixture-credential');
      writeFileSync(join(implementation, 'preflight/selected.rs'), 'before\n');
      writeFileSync(join(implementation, 'untouched.txt'), 'untouched\n');
      writeFileSync(join(temporary, 'outside.txt'), 'outside\n');
      symlinkSync(temporary, join(implementation, 'escape'));
      const dockerLog = join(temporary, 'docker.log');
      writeFileSync(
        join(bin, 'docker'),
        `#!/bin/bash
  set -euo pipefail
  printf 'called\\n' >> "$DOCKER_LOG"
  for arg in "$@"; do
    case "$arg" in
      format-export.contexts.implementation-source=*) source_dir="\u0024{arg#*=}" ;;
      format-export.output=type=local,dest=*) output_dir="\u0024{arg#*dest=}" ;;
    esac
  done
  test -f "$source_dir/preflight/selected.rs"
  test ! -e "$source_dir/.git"
  test ! -e "$source_dir/untouched.txt"
  if [ "$FORMAT_EXPORT_MODE" = complete ]; then
    mkdir -p "$output_dir/preflight"
    printf 'formatted\\n' > "$output_dir/preflight/selected.rs"
    printf 'must not be applied\\n' > "$output_dir/untouched.txt"
  fi
  `,
        { mode: 0o755 },
      );
      const files = join(temporary, 'files');
      for (const scenario of [
        'complete',
        'missing',
        'escape',
        'traversal',
        'git',
      ]) {
        const path =
          scenario === 'escape'
            ? 'escape/outside.txt'
            : scenario === 'traversal'
              ? '../outside.txt'
              : scenario === 'git'
                ? '.git/config'
                : 'preflight/selected.rs';
        writeFileSync(files, `${path}\0`);
        writeFileSync(dockerLog, '');
        const result = spawnSync(
          'task',
          [
            '--taskfile',
            join(this.root, 'Taskfile.yml'),
            'ci:format:implementation',
          ],
          {
            cwd: this.root,
            encoding: 'utf8',
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              FORMAT_CHANGED_FILES: files,
              REPO_ROOT: this.root,
              IMPLEMENTATION_REPO_ROOT: implementation,
              DOCKER_LOG: dockerLog,
              FORMAT_EXPORT_MODE: scenario,
            },
          },
        );
        if (scenario === 'complete') {
          expect(result.status, result.stderr).toBe(0);
          expect(
            readFileSync(join(implementation, 'preflight/selected.rs'), 'utf8'),
          ).toBe('formatted\n');
        } else {
          expect(result.status).not.toBe(0);
          if (scenario !== 'missing')
            expect(readFileSync(dockerLog, 'utf8')).toBe('');
        }
        expect(
          readFileSync(join(implementation, 'untouched.txt'), 'utf8'),
        ).toBe('untouched\n');
        expect(readFileSync(join(temporary, 'outside.txt'), 'utf8')).toBe(
          'outside\n',
        );
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  formatterContext(): void {
    const temporary = mkdtempSync(join(tmpdir(), 'nook-format-context-'));
    try {
      const shared =
        'nook-app/nook-web/nook-web-shared/src/vault-app/fixture.ts';
      const skill =
        '.cortex/teams/ai/dynamic-skills/new-fixture/scripts/src/fixture.ts';
      const prelude = this.read('.github/formatting/ci.Dockerfile').match(
        /^RUN mkdir -p .+$/m,
      );
      if (!prelude)
        throw new Error('CI formatter working directory setup missing');
      for (const path of [shared, skill]) {
        const directory = path.slice(0, path.lastIndexOf('/'));
        mkdirSync(join(temporary, directory), { recursive: true });
        writeFileSync(
          join(temporary, path),
          'export const value={name:"example"}\n',
        );
        const files = join(temporary, 'files');
        writeFileSync(files, `${path}\0`);
        const prepare = prelude[0].slice(4).replaceAll('/workspace', temporary);
        const result = spawnSync(
          'bash',
          ['-c', `${prepare}\nbash "$FORMAT_SCRIPT"`],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              NOOK_REPO_ROOT: temporary,
              NOOK_FORMATTER_ROOT: join(this.root, '.github/formatting'),
              FORMAT_CHANGED_FILES: files,
              FORMAT_SCRIPT: join(this.root, '.github/formatting/format.sh'),
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        const quote = path === shared ? '"' : "'";
        expect(readFileSync(join(temporary, path), 'utf8')).toBe(
          `export const value = { name: ${quote}example${quote} };\n`,
        );
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  compilerFirstWebVerification(): void {
    const taskSchema = z.object({
      tasks: z.record(
        z.string(),
        z.object({
          deps: z.array(z.string()).default([]),
          cmds: z
            .array(z.union([z.string(), z.object({ task: z.string() })]))
            .default([]),
        }),
      ),
    });
    const tasks = taskSchema.parse(
      Bun.YAML.parse(this.read('nook-app/Taskfile.yml')),
    ).tasks;
    const testTask = tasks['_test:parallel'];
    const compileTask = tasks['_compile:parallel'];
    const unitTask = tasks['_unit:parallel'];
    const lintTask = tasks['_lint:parallel'];
    if (!testTask || !compileTask || !unitTask || !lintTask) {
      throw new Error('Parallel task definitions are missing');
    }
    expect(
      testTask.cmds.map((command) =>
        typeof command === 'string' ? command : command.task,
      ),
    ).toEqual(['_compile:parallel', '_unit:parallel']);
    expect(compileTask.deps.sort()).toEqual([
      '_extension:typecheck',
      '_web:check:parallel',
    ]);
    expect(unitTask.deps.sort()).toEqual([
      '_extension:test:parallel',
      '_web:test:parallel',
    ]);
    expect(testTask.deps).toEqual([]);
    expect(
      lintTask.cmds.map((command) =>
        typeof command === 'string' ? command : command.task,
      ),
    ).toContain('_extension:lint:parallel');

    const extension = this.read(
      'nook-app/nook-web/nook-web-extension/Taskfile.yml',
    );
    expect(extension).toContain('_extension:lint:parallel:');
    expect(extension).toContain('bun run typecheck');
    expect(extension).toContain('bun run test:unit');

    const temporary = mkdtempSync(join(tmpdir(), 'nook-compiler-first-'));
    try {
      const taskfile = join(temporary, 'Taskfile.yml');
      const probe = join(temporary, 'probe.log');
      writeFileSync(
        taskfile,
        `version: '3'
tasks:
  compiler:web:
    cmds:
      - sh -c 'echo compiler:web >> "$PROBE_LOG"; test "${'${FAIL_COMPILERS:-}'}" != 1'
  compiler:extension:
    cmds:
      - sh -c 'echo compiler:extension >> "$PROBE_LOG"; test "${'${FAIL_COMPILERS:-}'}" != 1'
  compiler:all:
    deps: [compiler:web, compiler:extension]
  unit:web:
    cmds:
      - sh -c 'echo unit:web >> "$PROBE_LOG"'
  unit:extension:
    cmds:
      - sh -c 'echo unit:extension >> "$PROBE_LOG"'
  unit:all:
    deps: [unit:web, unit:extension]
  verify:
    cmds:
      - task: compiler:all
      - task: unit:all
`,
      );
      for (const failure of ['1', '0']) {
        writeFileSync(probe, '');
        const result = spawnSync('task', ['--taskfile', taskfile, 'verify'], {
          encoding: 'utf8',
          env: {
            ...process.env,
            FAIL_COMPILERS: failure,
            PROBE_LOG: probe,
          },
        });
        const output = readFileSync(probe, 'utf8');
        expect(output).toContain('compiler:web');
        expect(output).toContain('compiler:extension');
        if (failure === '1') {
          expect(result.status).not.toBe(0);
          expect(output).not.toContain('unit:web');
          expect(output).not.toContain('unit:extension');
        } else {
          expect(result.status, result.stderr).toBe(0);
          expect(output).toContain('unit:web');
          expect(output).toContain('unit:extension');
        }
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  private read(path: string): string {
    return readFileSync(join(this.root, path), 'utf8');
  }
  private command(request: GitFixtureCommand): string {
    const { cwd, args } = request;
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }
}

const contract = new DockerizedRustContract();
const e2eContract = new DockerizedRustE2eContract();
const toolingContract = new DockerizedRustToolingContract();
test(
  'PR browser scheduling preserves covering extension and Node gates',
  contract.previewGates.bind(contract),
);
test(
  'grouped ecosystem reports every result and fails for any failed check',
  contract.ecosystemResults.bind(contract),
);
test(
  'PR dedup retains standalone coverage and source-correct exports',
  contract.coverageAndExporter.bind(contract),
);
test(
  'workflow Rust tools are Docker owned and dependency audits stay live',
  contract.workflowTooling.bind(contract),
);
test(
  'sealed web compile installs extension dependencies from its own lockfile',
  contract.compileExtensionUsesOwnFrozenDependencies.bind(contract),
);
test(
  'policy Git metadata retains exact head and real baseline without credentials',
  contract.portableGitMetadata.bind(contract),
);

test(
  'trusted formatter exports only bounded files and rejects hostile paths',
  contract.formatterExport.bind(contract),
  15_000,
);

test(
  'actual formatter supports shared-only files and new skill packages',
  contract.formatterContext.bind(contract),
);
test(
  'e2e orchestration reports every selected suite before failing',
  e2eContract.e2eCompletion.bind(e2eContract),
);
test(
  'web verification aggregates compilers before starting unit suites',
  contract.compilerFirstWebVerification.bind(contract),
);
test(
  'tooling installs every package before checking successful installs',
  toolingContract.toolingStaticInstallsBeforeChecks.bind(toolingContract),
);
