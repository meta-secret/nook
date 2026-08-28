import { describe, expect, test } from 'bun:test';
import {
  dispatchSkillYamlText,
  finalizeSkillCliResponse,
  runSkillCli,
  type FinalSkillCliResponseRequest,
  type RunSkillCliRequest,
} from '../src/cli.ts';
import {
  listDiscoverableSkillActions,
  SKILL_TOOLS_LIST_INVOKE,
} from '../src/skill-action-registry.ts';
import {
  SkillCommandIssue,
  SkillCommandPhase,
  SKILL_HOST_RESPONSE_BYTE_LIMIT,
  SkillRequestFamily,
} from '../src/skill-command-domain.ts';
import {
  SKILL_YAML_DEPTH_LIMIT,
  parseSkillYamlText,
  type UntrustedSkillYamlNode,
} from '../src/skill-yaml-codec.ts';
type CliResponse = {
  readonly ok: boolean;
  readonly family?: string;
  readonly operation?: string;
  readonly phase?: string;
  readonly errors?: readonly {
    readonly path: string;
    readonly issue: string;
    readonly message: string;
  }[];
  readonly result?: {
    readonly actions?: readonly {
      readonly description: string;
      readonly exampleRequest: string;
      readonly exampleYaml: string;
      readonly resolvedExampleYaml: string;
      readonly inputSchema: {
        readonly type: string;
        readonly additionalProperties: boolean;
      };
    }[];
  };
  readonly recover?: { readonly toolsListRequest: string };
};
function parseResponse(yaml: string): CliResponse {
  return Bun.YAML.parse(yaml) as CliResponse;
}
describe('provider-neutral executable skill YAML host', () => {
  test('discovers exactly its closed tools-list action', async () => {
    const request: RunSkillCliRequest = { argv: [] };
    const outcome = await runSkillCli(request);
    const response = parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(parseSkillYamlText(outcome.yaml).ok).toBe(true);
    expect(response.ok).toBe(true);
    const actions = response.result?.actions;
    if (!actions) throw new Error('Missing discovered actions.');
    expect(actions).toHaveLength(1);
    const action = actions[0];
    if (!action) throw new Error('Missing tools-list action.');
    expect(action.description).not.toBeEmpty();
    expect(action.exampleRequest).toBe(SKILL_TOOLS_LIST_INVOKE);
    expect(action.exampleYaml).not.toBeEmpty();
    expect(action.resolvedExampleYaml).toBe(action.exampleYaml);
    const expectedSchema = {
      type: 'object',
      additionalProperties: false,
    };
    expect(action.inputSchema).toMatchObject(expectedSchema);
    expect(dispatchSkillYamlText(action.exampleYaml).exitCode).toBe(0);
    for (const argv of [['--help'], ['--default', 'toolsList']]) {
      const invocationRequest: RunSkillCliRequest = { argv };
      expect((await runSkillCli(invocationRequest)).exitCode).toBe(0);
    }
  });
  test('executes tools-list and rejects CLI flags', async () => {
    const outcome = dispatchSkillYamlText('skillToolsList:\n  list: {}\n');
    const response = parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.family).toBe(SkillRequestFamily.ToolsList);
    expect(response.operation).toBe('list');
    const request: RunSkillCliRequest = {
      argv: ['audit', '--path', '.cortex'],
    };
    expect((await runSkillCli(request)).exitCode).toBe(2);
  });
  test('reports canonical paths without echoing unknown keys or values', () => {
    const cases = [
      ['skillToolsList: {}\n', 'skillToolsList.list'],
      ['skillToolsList:\n  list: false\n', 'skillToolsList.list'],
      [
        'skillToolsList:\n  extra: {}\n  list: {}\n',
        'skillToolsList["<unknown-key>"]',
      ],
      [
        'skillToolsList:\n  list:\n    "api.token[0]": SECRET_MARKER\n',
        'skillToolsList.list["<unknown-key>"]',
      ],
      ['"SECRET_IN_KEY": value\n', '["<unknown-key>"]'],
      ['hyphen-marker: value\n', '["<unknown-key>"]'],
    ] as const;
    for (const [yaml, path] of cases) {
      const outcome = dispatchSkillYamlText(yaml);
      const response = parseResponse(outcome.yaml);
      expect(outcome.exitCode).toBe(2);
      expect(response.errors?.at(0)?.path).toBe(path);
      expect(outcome.yaml).not.toMatch(/SECRET|MARKER/u);
      expect(response.recover?.toolsListRequest).toBe(SKILL_TOOLS_LIST_INVOKE);
    }
  });
  test('keeps strict-YAML failures bounded and redacted', () => {
    const secret = 'SECRET_MARKER';
    const aliasLines = [`level0: &level0 [${secret}]`];
    for (let level = 1; level <= 12; level += 1) {
      const previous = `level${level - 1}`;
      aliasLines.push(
        `level${level}: &level${level} [*${previous}, *${previous}]`,
      );
    }
    for (const yaml of [
      `skillToolsList: [${secret}\n`,
      `skillToolsList:\n  list:\n    token: ${secret}\n  list: {}\n`,
      `skillToolsList:\n  list: {}\n---\ntoken: ${secret}\n`,
      aliasLines.join('\n'),
      aliasLines.join('\r'),
      `${'['.repeat(SKILL_YAML_DEPTH_LIMIT + 1)}${secret}`,
    ]) {
      const outcome = dispatchSkillYamlText(yaml);
      const response = parseResponse(outcome.yaml);
      const expectedError = {
        issue: SkillCommandIssue.InvalidYaml,
        message: 'Invalid YAML syntax.',
      };
      expect(response.errors?.at(0)).toMatchObject(expectedError);
      expect(outcome.yaml).not.toContain(secret);
      expect(new TextEncoder().encode(outcome.yaml).byteLength).toBeLessThan(
        1_024 * 1_024,
      );
    }
  });
  test('rejects generic name and arguments envelopes', () => {
    const outcome = dispatchSkillYamlText(
      'name: skill-tools-list\narguments:\n  action: list\n',
    );
    const response = parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.path).toBe('');
    expect(outcome.yaml).toContain(
      'Expected exactly one skill request family.',
    );
  });
  test('bounds requests and final success or failure envelopes', () => {
    const oversizedInput = dispatchSkillYamlText(
      `# ${'x'.repeat(4 * 1_024 * 1_024)}\n`,
    );
    expect(parseResponse(oversizedInput.yaml).errors?.at(0)?.issue).toBe(
      SkillCommandIssue.RequestTooLarge,
    );
    const oversizedScalar = 'x'.repeat(SKILL_HOST_RESPONSE_BYTE_LIMIT);
    for (const [exitCode, response] of [
      [0, { ok: true, result: oversizedScalar }],
      [2, { ok: false, errors: [oversizedScalar] }],
    ] as const) {
      const request: FinalSkillCliResponseRequest = {
        exitCode,
        response: response as UntrustedSkillYamlNode,
      };
      const outcome = finalizeSkillCliResponse(request);
      expect(outcome.exitCode).toBe(1);
      const expectedError = {
        issue: SkillCommandIssue.ResponseTooLarge,
      };
      expect(parseResponse(outcome.yaml).errors?.at(0)).toMatchObject(
        expectedError,
      );
      expect(
        new TextEncoder().encode(outcome.yaml).byteLength,
      ).toBeLessThanOrEqual(SKILL_HOST_RESPONSE_BYTE_LIMIT);
    }
  });
  test('returns typed bounded failures for non-finite action results', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const request: FinalSkillCliResponseRequest = {
        exitCode: 0,
        response: { ok: true, result: value },
      };
      const outcome = finalizeSkillCliResponse(request);
      expect(outcome.exitCode).toBe(1);
      expect(parseResponse(outcome.yaml).errors?.at(0)?.issue).toBe(
        SkillCommandIssue.InvalidResponse,
      );
      expect(parseSkillYamlText(outcome.yaml).ok).toBe(true);
      expect(outcome.yaml).not.toMatch(/\.nan|\.inf/iu);
      expect(outcome.yaml.length).toBeLessThan(1_024 * 1_024);
    }
  });
  test('uses decode phase for malformed input', () => {
    const response = parseResponse(dispatchSkillYamlText('[').yaml);
    expect(response.phase).toBe(SkillCommandPhase.Decode);
  });
});
