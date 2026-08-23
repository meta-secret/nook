import { describe, expect, test } from 'bun:test';
import { ExecutableSkillExecutionKind } from '../../src/executable-skills/domain.ts';
import type { ExecutableSkillManifest } from '../../src/executable-skills/domain.ts';
import { decodeExecutableSkillManifest } from '../../src/executable-skills/manifest-codec.ts';
import { analyzeExecutableSkillSource } from '../../src/executable-skills/source-policy.ts';

type AnalyzeFixtureRequest = {
  readonly source: string;
};

function analyzeFixture(request: AnalyzeFixtureRequest): readonly string[] {
  const analysisRequest = {
    ...request,
    relativePath: '.agents/skills/fixture/src/runner.ts',
  };
  return analyzeExecutableSkillSource(analysisRequest).moduleSpecifiers;
}

const manifest: ExecutableSkillManifest = {
  schemaVersion: 1,
  id: 'fixture',
  executionKind: ExecutableSkillExecutionKind.DockerReadOnly,
  requestKind: 'fixture-request-v1',
  resultKind: 'fixture-result-v1',
  policyPaths: ['.cortex/architecture/fixture.md'],
  limits: { requestBytes: 1024, resultBytes: 1024, timeoutMs: 1000 },
};

describe('executable skill manifest codec', () => {
  test('decodes the exact bounded manifest contract', () => {
    expect(decodeExecutableSkillManifest(JSON.stringify(manifest))).toEqual(
      manifest,
    );
  });

  test('rejects extra fields, dot aliases, unsafe policies, and bad limits', () => {
    const invalid = [
      { ...manifest, extra: true },
      { ...manifest, policyPaths: ['.cortex/./fixture.md'] },
      { ...manifest, policyPaths: ['.agents/skills/fixture/SKILL.md'] },
      { ...manifest, limits: { ...manifest.limits, timeoutMs: 0 } },
      {
        ...manifest,
        limits: { requestBytes: 1024, resultBytes: 1024 },
      },
      { ...manifest, limits: { ...manifest.limits, extra: true } },
    ];
    for (const candidate of invalid) {
      expect(() =>
        decodeExecutableSkillManifest(JSON.stringify(candidate)),
      ).toThrow();
    }
  });
});

describe('executable skill source policy', () => {
  test('accepts audited local modules and type-only external modules', () => {
    const source = [
      "import type { Root } from 'mdast';",
      "import type { InspectOptions } from 'node:util';",
      "export type { Node } from 'unist';",
      "import { audit } from './audit.ts';",
      'const values = [1, 2];',
      'Bun.write(Bun.stdout, JSON.stringify(audit(values[0])));',
      "Bun.write(Bun.stderr, 'audited failure');",
    ].join('\n');
    const request: AnalyzeFixtureRequest = {
      source,
    };
    expect(analyzeFixture(request)).toEqual(['./audit.ts']);
  });

  test('rejects runtime external packages in every static form', () => {
    const sources = [
      "import 'package-name';",
      "import value from '@scope/package/subpath';",
      "export { value } from 'npm:package-name';",
      "export * from 'jsr:package-name';",
      "import value = require('package-name');",
      "import value from '#alias';",
      "import value from 'data:text/javascript,export default 1';",
    ];
    for (const source of sources) {
      const request: AnalyzeFixtureRequest = {
        source,
      };
      expect(() => analyzeFixture(request)).toThrow('external runtime package');
    }
  });

  test('rejects every runtime node module form', () => {
    const sources = [
      "import { inspect } from 'node:util';",
      "export { strict } from 'node:assert';",
      "export * from 'node:path';",
      "import value = require('node:buffer');",
    ];
    for (const source of sources) {
      const request: AnalyzeFixtureRequest = { source };
      expect(() => analyzeFixture(request)).toThrow('forbidden ambient module');
    }
  });

  test('rejects loader, network, process, evaluator, and worker capabilities', () => {
    const sources = [
      "import { spawn } from 'node:child_process';",
      "import http2 from 'node:http2';",
      "import { Worker } from 'node:worker_threads';",
      "import { $ as shell } from 'bun';",
      "const load = require; load('node:fs');",
      "import.meta.require('node:fs');",
      "module.require('node:fs');",
      "const loader = process.getBuiltinModule; loader('child_process');",
      "const run = eval; run('1 + 1');",
      "const C = (() => {}).constructor; C('return 1')();",
      "const { constructor: C } = (() => {}); C('return 1')();",
      "const key = 'constructor'; (() => {})[key]('return 1')();",
      "new Worker('data:text/javascript,postMessage(1)');",
      "const Launch = Worker; new Launch('./worker.ts');",
      "const DynamicLoader = Loader; new DynamicLoader('./module.ts');",
      'const Realm = ShadowRealm; new Realm();',
      "Bun.stdout = '/tmp/out';",
      "Bun.stderr += '/tmp/out';",
      'Bun.stdout ??= value;',
      'Bun.stderr &&= value;',
      'Bun.stdin ||= value;',
      '++Bun.stdin;',
      'Bun.stdout--;',
      'delete Bun.stderr;',
      '({ stdout: Bun.stdout } = value);',
      '({ ...Bun.stdout } = value);',
      'for (Bun.stdout in value) {}',
      'for ({ stderr: Bun.stderr } of values) {}',
      'for ({ ...Bun.stderr } of values) {}',
      'const io = Bun; io.stdout = value;',
      "fetch('https://example.com');",
      'Bun.$`echo unsafe`;',
      "fs.readFileSync('/etc/passwd');",
      "child_process.execSync('echo unsafe');",
      "http.get('http://example.com');",
      "ffi.dlopen('/tmp/unsafe.so', {});",
    ];
    for (const source of sources) {
      const request: AnalyzeFixtureRequest = {
        source,
      };
      expect(() => analyzeFixture(request)).toThrow();
    }
  });

  test('always applies capability audit at the production analyzer seam', () => {
    const localRequest: AnalyzeFixtureRequest = {
      source: "import { audit } from './audit.ts';",
    };
    expect(analyzeFixture(localRequest)).toEqual(['./audit.ts']);
    const packageRequest: AnalyzeFixtureRequest = {
      source: "import value from 'package-name';",
    };
    expect(() => analyzeFixture(packageRequest)).toThrow(
      'external runtime package',
    );
  });
});
