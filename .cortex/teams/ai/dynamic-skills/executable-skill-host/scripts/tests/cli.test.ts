import { describe, expect, test } from 'bun:test';
import {
  CortexArticleRequestDecodeError,
  decodeCortexArticleRequest,
} from '../../../cortex-article-structure/scripts/src/codec.ts';
import {
  CortexArticleContractKind,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_PATH_LIMIT,
  type AuditCortexArticleStructureRequest,
} from '../../../cortex-article-structure/scripts/src/domain.ts';
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
import {
  validateSkillInput,
  type SkillSchemaValidationRequest,
} from '../src/skill-schema-validator.ts';
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
    readonly findings?: readonly {
      readonly code: string;
      readonly file: string;
      readonly line: number;
      readonly message: string;
    }[];
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
type ArticleRequestInput = {
  readonly heading: string;
  readonly relativePath: string;
};
function articleRequest(
  input: ArticleRequestInput,
): AuditCortexArticleStructureRequest {
  return {
    kind: CortexArticleContractKind.Request,
    documents: [
      {
        relativePath: input.relativePath,
        blocks: [
          {
            depth: 2,
            kind: CortexArticleSemanticKind.Heading,
            line: 1,
            text: input.heading,
          },
        ],
      },
    ],
  };
}
function providerFailurePath(
  request: AuditCortexArticleStructureRequest,
): string {
  try {
    decodeCortexArticleRequest(JSON.stringify(request));
  } catch (error) {
    if (error instanceof CortexArticleRequestDecodeError) return error.path;
    throw error;
  }
  throw new Error('Expected provider rejection.');
}
describe('provider-neutral executable skill YAML host', () => {
  test('discovers the closed tools-list and article audit actions', async () => {
    const request: RunSkillCliRequest = { argv: [] };
    const outcome = await runSkillCli(request);
    const response = parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(parseSkillYamlText(outcome.yaml).ok).toBe(true);
    expect(response.ok).toBe(true);
    const actions = response.result?.actions;
    if (!actions) throw new Error('Missing discovered actions.');
    expect(actions).toHaveLength(2);
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
    for (const discovered of actions) {
      expect(discovered.exampleRequest).toMatch(/^task skills:/u);
      expect(dispatchSkillYamlText(discovered.exampleYaml).exitCode).toBe(0);
    }
    for (const argv of [[], ['--tools-list']]) {
      const invocationRequest: RunSkillCliRequest = { argv };
      expect((await runSkillCli(invocationRequest)).exitCode).toBe(0);
    }
  });
  test('executes the article action through its validated provider contract', () => {
    const action = listDiscoverableSkillActions().actions.at(1);
    if (!action) throw new Error('Missing article action.');
    const outcome = dispatchSkillYamlText(action.exampleYaml);
    const response = parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.family).toBe(SkillRequestFamily.CortexArticleStructure);
    expect(response.operation).toBe('audit');
    expect(response.result).toMatchObject({ findings: [] });
    const invalid = dispatchSkillYamlText(
      action.exampleYaml.replace(
        'documents:',
        'secret: MARKER\n    documents:',
      ),
    );
    expect(invalid.exitCode).toBe(2);
    expect(invalid.yaml).not.toContain('MARKER');
  });
  test('aligns discovered and provider UTF-16 string limits', () => {
    const action = listDiscoverableSkillActions().actions.at(1);
    if (!action) throw new Error('Missing article action.');
    const boundaryPath = `.cortex/${'😀'.repeat(2_042)}a.md`;
    const boundaryHeading = '😀'.repeat(1_900);
    expect(boundaryPath.length).toBe(CORTEX_ARTICLE_PATH_LIMIT);
    expect(boundaryHeading.length).toBe(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT);
    const overflowPath = `${boundaryPath.slice(0, -3)}a.md`;
    const overflowHeading = `${boundaryHeading}a`;
    expect(overflowPath.length).toBe(CORTEX_ARTICLE_PATH_LIMIT + 1);
    expect(overflowHeading.length).toBe(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT + 1);
    const accepted = articleRequest({
      heading: boundaryHeading,
      relativePath: boundaryPath,
    });
    const validationRequest: SkillSchemaValidationRequest = {
      path: 'cortexArticleStructure.audit',
      schema: action.inputSchema,
      value: accepted,
    };
    expect(validateSkillInput(validationRequest).ok).toBe(true);
    expect(() =>
      decodeCortexArticleRequest(JSON.stringify(accepted)),
    ).not.toThrow();
    const wrapped = {
      [SkillRequestFamily.CortexArticleStructure]: {
        audit: accepted,
      },
    };
    expect(dispatchSkillYamlText(JSON.stringify(wrapped)).exitCode).toBe(0);

    for (const [request, schemaPath, providerPath] of [
      [
        articleRequest({
          heading: 'Heading',
          relativePath: overflowPath,
        }),
        'cortexArticleStructure.audit.documents[0].relativePath',
        'documents[0].relativePath',
      ],
      [
        articleRequest({
          heading: overflowHeading,
          relativePath: '.cortex/example.md',
        }),
        'cortexArticleStructure.audit.documents[0].blocks[0].text',
        'documents[0].blocks[0].text',
      ],
    ] as const) {
      const rejectedValidationRequest: SkillSchemaValidationRequest = {
        path: 'cortexArticleStructure.audit',
        schema: action.inputSchema,
        value: request,
      };
      const validation = validateSkillInput(rejectedValidationRequest);
      expect(validation.ok).toBe(false);
      if (validation.ok) throw new Error('Expected schema rejection.');
      expect(validation.path).toBe(schemaPath);
      expect(providerFailurePath(request)).toBe(providerPath);
      const rejectedWrapped = {
        [SkillRequestFamily.CortexArticleStructure]: { audit: request },
      };
      expect(
        dispatchSkillYamlText(JSON.stringify(rejectedWrapped)).exitCode,
      ).toBe(2);
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
    const oversizedScalar = new Array<string>(9).fill('x'.repeat(1_048_576));
    for (const [exitCode, response] of [
      [0, { ok: true, result: oversizedScalar }],
      [2, { ok: false, errors: oversizedScalar }],
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
    for (const value of [NaN, Infinity, 2 ** 53, 'é'.repeat(524_289)]) {
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
