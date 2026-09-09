import assert from 'node:assert/strict';
import { ok } from 'neverthrow';
import { EXECUTABLE_SKILL_CATALOG } from '../src/skill-action-registry.ts';
import { ExecutableSkillResponse } from '../src/cli.ts';
import { ExecutableSkillYamlEncoding } from '../src/skill-yaml-codec.ts';
import { ExecutableSkillRequest } from '../src/cli.ts';
import { describe, expect, test } from 'bun:test';

import {
  CortexArticleRequestDecodeError,
  CortexArticleTransport,
} from '../../../cortex-article-structure/scripts/src/codec.ts';

import {
  CortexArticleContractKind,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_PATH_LIMIT,
  type AuditCortexArticleStructureRequest,
} from '../../../cortex-article-structure/scripts/src/domain.ts';

import {
  DelegationVisualizationContractKind,
  DelegationVisualizationTeam,
} from '../../../delegation-visualization/scripts/src/domain.ts';

import {
  type FinalSkillCliResponseRequest,
  type RunSkillCliRequest,
  ExecutableSkillCli,
} from '../src/cli.ts';

import {
  SKILL_TOOLS_LIST_INVOKE,
  ExecutableSkillActions,
} from '../src/skill-action-registry.ts';

import {
  SkillCommandIssue,
  SkillCommandPhase,
  SKILL_HOST_RESPONSE_BYTE_LIMIT,
  SkillRequestFamily,
} from '../src/skill-command-domain.ts';

import {
  SKILL_YAML_DEPTH_LIMIT,
  type UntrustedSkillYamlNode,
  ExecutableSkillYaml,
} from '../src/skill-yaml-codec.ts';

import {
  type SkillSchemaValidationRequest,
  ExecutableSkillInputSchema,
} from '../src/skill-schema-validator.ts';

export class ExecutableSkillHostCliScenario {
  private constructor(private readonly request: ArticleRequestInput) {}

  static parseResponse(yaml: string): CliResponse {
    return Bun.YAML.parse(yaml) as CliResponse;
  }

  static articleRequest(
    input: ArticleRequestInput,
  ): AuditCortexArticleStructureRequest {
    return new ExecutableSkillHostCliScenario(input).execute();
  }

  private execute(): AuditCortexArticleStructureRequest {
    const input = this.request;
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

  static providerFailurePath(
    request: AuditCortexArticleStructureRequest,
  ): string {
    const decoded = CortexArticleTransport.from(
      JSON.stringify(request),
    ).decodeRequest();
    expect(decoded.isErr()).toBe(true);
    return decoded.match(
      () => '',
      (failure) => failure.path,
    );
  }
}

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
    readonly document?: {
      readonly gizmo: {
        readonly tasks: readonly {
          readonly id: string;
          readonly team: string;
          readonly description: string;
          readonly depends_on: readonly string[];
        }[];
      };
    };
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

type ArticleRequestInput = {
  readonly heading: string;
  readonly relativePath: string;
};

describe('provider-neutral executable skill YAML host', () => {
  test('discovers the closed executable action catalog', async () => {
    const request: RunSkillCliRequest = { argv: [] };
    const outcomeResult = await ExecutableSkillCli.from(request).execute();
    assert(outcomeResult.isOk());
    const outcome = outcomeResult.value;
    const response = ExecutableSkillHostCliScenario.parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(ExecutableSkillYaml.from(outcome.yaml).execute().isOk()).toBe(true);
    expect(response.ok).toBe(true);
    const actions = response.result?.actions;
    assert(actions);
    expect(actions).toHaveLength(5);
    const action = actions[0];
    assert(action);
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
      expect(
        new ExecutableSkillRequest(discovered.exampleYaml)
          .execute()
          .map((response) => response.exitCode),
      ).toEqual(ok(0));
    }
    for (const argv of [[], ['--tools-list']]) {
      const invocationRequest: RunSkillCliRequest = { argv };
      expect(
        (await ExecutableSkillCli.from(invocationRequest).execute()).map(
          (response) => response.exitCode,
        ),
      ).toEqual(ok(0));
    }
  });
  test('executes the article action through its validated provider contract', () => {
    const action = EXECUTABLE_SKILL_CATALOG.list().actions.at(1);
    assert(action);
    const outcomeResult = new ExecutableSkillRequest(
      action.exampleYaml,
    ).execute();
    assert(outcomeResult.isOk());
    const outcome = outcomeResult.value;
    const response = ExecutableSkillHostCliScenario.parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.family).toBe(SkillRequestFamily.CortexArticleStructure);
    expect(response.operation).toBe('audit');
    expect(response.result).toMatchObject({ findings: [] });
    const invalidResult = new ExecutableSkillRequest(
      action.exampleYaml.replace(
        'documents:',
        'secret: MARKER\n    documents:',
      ),
    ).execute();
    assert(invalidResult.isOk());
    const invalid = invalidResult.value;
    expect(invalid.exitCode).toBe(2);
    expect(invalid.yaml).not.toContain('MARKER');
  });
  test('executes the document-map action through its provider', () => {
    const action = EXECUTABLE_SKILL_CATALOG.list().actions.at(2);
    assert(action);
    const outcomeResult = new ExecutableSkillRequest(
      action.exampleYaml,
    ).execute();
    assert(outcomeResult.isOk());
    const outcome = outcomeResult.value;
    const response = ExecutableSkillHostCliScenario.parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.family).toBe(SkillRequestFamily.CortexDocumentMap);
    expect(response.operation).toBe('audit');
    expect(response.result).toMatchObject({ findings: [] });

    const invalidResult = new ExecutableSkillRequest(
      action.exampleYaml.replace(
        'documents:',
        'secret: MARKER\n    documents:',
      ),
    ).execute();
    assert(invalidResult.isOk());
    const invalid = invalidResult.value;
    expect(invalid.exitCode).toBe(2);
    expect(invalid.yaml).not.toContain('MARKER');

    const transientLinkResult = new ExecutableSkillRequest(`cortexDocumentMap:
  audit:
    kind: cortex-document-map-audit-v1
    documents:
      - relativePath: .cortex/knowledge-graph.md
        content: "# Router\\n\\n- [Transient](.session/note.md)\\n"
      - relativePath: .cortex/.session/note.md
        content: "# Temporary\\n"
    excludedDocumentPaths:
      - .cortex/.session/note.md
`).execute();
    assert(transientLinkResult.isOk());
    const transientLink = transientLinkResult.value;
    expect(
      ExecutableSkillHostCliScenario.parseResponse(transientLink.yaml).result
        ?.findings,
    ).toEqual([
      {
        code: 'invalid-index-entry',
        file: '.cortex/knowledge-graph.md',
        line: 3,
        message:
          'Index link points to non-existent document: .cortex/.session/note.md',
      },
    ]);

    const missingExcludedDocumentResult = new ExecutableSkillRequest(
      action.exampleYaml.replace(
        'excludedDocumentPaths: []',
        'excludedDocumentPaths:\n      - .cortex/.session/MARKER.md',
      ),
    ).execute();
    assert(missingExcludedDocumentResult.isOk());
    const missingExcludedDocument = missingExcludedDocumentResult.value;
    expect(missingExcludedDocument.exitCode).toBe(2);
    expect(missingExcludedDocument.yaml).not.toContain('MARKER');
    expect(
      ExecutableSkillHostCliScenario.parseResponse(
        missingExcludedDocument.yaml,
      ).errors?.at(0)?.path,
    ).toBe('cortexDocumentMap.audit.excludedDocumentPaths[0]');
  });
  test('executes consistency through its validated provider contract', () => {
    const action = EXECUTABLE_SKILL_CATALOG.list().actions.at(3);
    assert(action);
    const outcomeResult = new ExecutableSkillRequest(
      action.exampleYaml,
    ).execute();
    assert(outcomeResult.isOk());
    const outcome = outcomeResult.value;
    const response = ExecutableSkillHostCliScenario.parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.family).toBe(SkillRequestFamily.CortexConsistency);
    expect(response.operation).toBe('compile');
    expect(response.result?.findings?.length).toBeGreaterThan(0);
  });
  test('renders delegation through its validated provider', () => {
    const action = EXECUTABLE_SKILL_CATALOG.list().actions.at(4);
    assert(action);
    const outcomeResult = new ExecutableSkillRequest(
      action.exampleYaml,
    ).execute();
    assert(outcomeResult.isOk());
    const outcome = outcomeResult.value;
    const response = ExecutableSkillHostCliScenario.parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.family).toBe(SkillRequestFamily.DelegationVisualization);
    expect(response.operation).toBe('render');
    expect(response.result?.document).toEqual({
      gizmo: {
        tasks: [
          {
            id: 'update-cortex',
            team: 'ai',
            description: 'update Cortex',
            depends_on: [],
          },
          {
            id: 'create-security-key',
            team: 'web-development',
            description: 'create security key component',
            depends_on: ['update-cortex'],
          },
          {
            id: 'steward-pr',
            team: 'pr-steward',
            description: 'perform authorized pull-request delivery mechanics',
            depends_on: ['create-security-key'],
          },
        ],
      },
    });

    const specialDescription = 'audit: "quoted" # literal \\ path [exact]';
    const specialRequest = {
      delegationVisualization: {
        render: {
          kind: DelegationVisualizationContractKind.Request,
          tasks: [
            {
              id: 'special-description',
              team: DelegationVisualizationTeam.Security,
              description: specialDescription,
              dependencies: [],
            },
          ],
        },
      },
    };
    const specialOutcomeResult = new ExecutableSkillYamlEncoding(
      specialRequest as UntrustedSkillYamlNode,
    )
      .execute()
      .andThen((yaml) => new ExecutableSkillRequest(yaml).execute());
    assert(specialOutcomeResult.isOk());
    const specialOutcome = specialOutcomeResult.value;
    expect(specialOutcome.exitCode).toBe(0);
    expect(
      ExecutableSkillHostCliScenario.parseResponse(specialOutcome.yaml).result
        ?.document?.gizmo.tasks[0]?.description,
    ).toBe(specialDescription);
  });
  test('keeps structured delegation within the trusted host response bound', () => {
    const ids: string[] = [];
    for (let index = 0; index < 64; index += 1) {
      ids.push(`${String(index).padStart(2, '0')}${'a'.repeat(6)}`);
    }
    const tasks = [];
    for (const [index, id] of ids.entries()) {
      tasks.push({
        id,
        team: DelegationVisualizationTeam.Ai,
        description: '\\'.repeat(256),
        dependencies: ids.slice(0, index),
      });
    }
    const request = {
      delegationVisualization: {
        render: {
          kind: DelegationVisualizationContractKind.Request,
          tasks,
        },
      },
    };
    const outcomeResult = new ExecutableSkillYamlEncoding(
      request as UntrustedSkillYamlNode,
    )
      .execute()
      .andThen((yaml) => new ExecutableSkillRequest(yaml).execute());
    assert(outcomeResult.isOk());
    const outcome = outcomeResult.value;
    const response = ExecutableSkillHostCliScenario.parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.result?.document?.gizmo.tasks).toHaveLength(64);
    expect(
      new TextEncoder().encode(outcome.yaml).byteLength,
    ).toBeLessThanOrEqual(SKILL_HOST_RESPONSE_BYTE_LIMIT);
  });
  test('aligns discovered and provider UTF-16 string limits', () => {
    const action = EXECUTABLE_SKILL_CATALOG.list().actions.at(1);
    assert(action);
    const boundaryPath = `.cortex/${'😀'.repeat(2_042)}a.md`;
    const boundaryHeading = '😀'.repeat(1_900);
    expect(boundaryPath.length).toBe(CORTEX_ARTICLE_PATH_LIMIT);
    expect(boundaryHeading.length).toBe(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT);
    const overflowPath = `${boundaryPath.slice(0, -3)}a.md`;
    const overflowHeading = `${boundaryHeading}a`;
    expect(overflowPath.length).toBe(CORTEX_ARTICLE_PATH_LIMIT + 1);
    expect(overflowHeading.length).toBe(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT + 1);
    const accepted = ExecutableSkillHostCliScenario.articleRequest({
      heading: boundaryHeading,
      relativePath: boundaryPath,
    });
    const validationRequest: SkillSchemaValidationRequest = {
      path: 'cortexArticleStructure.audit',
      schema: action.inputSchema,
      value: accepted,
    };
    expect(
      ExecutableSkillInputSchema.from(validationRequest).execute().isOk(),
    ).toBe(true);
    expect(
      CortexArticleTransport.from(JSON.stringify(accepted))
        .decodeRequest()
        .isOk(),
    ).toBe(true);
    const wrapped = {
      [SkillRequestFamily.CortexArticleStructure]: {
        audit: accepted,
      },
    };
    expect(
      new ExecutableSkillRequest(JSON.stringify(wrapped))
        .execute()
        .map((response) => response.exitCode),
    ).toEqual(ok(0));

    for (const [request, schemaPath, providerPath] of [
      [
        ExecutableSkillHostCliScenario.articleRequest({
          heading: 'Heading',
          relativePath: overflowPath,
        }),
        'cortexArticleStructure.audit.documents[0].relativePath',
        'documents[0].relativePath',
      ],
      [
        ExecutableSkillHostCliScenario.articleRequest({
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
      const validation = ExecutableSkillInputSchema.from(
        rejectedValidationRequest,
      ).execute();
      expect(validation.isOk()).toBe(false);
      assert(validation.isErr());
      expect(validation.error.path).toBe(schemaPath);
      expect(ExecutableSkillHostCliScenario.providerFailurePath(request)).toBe(
        providerPath,
      );
      const rejectedWrapped = {
        [SkillRequestFamily.CortexArticleStructure]: { audit: request },
      };
      expect(
        new ExecutableSkillRequest(JSON.stringify(rejectedWrapped))
          .execute()
          .map((response) => response.exitCode),
      ).toEqual(ok(2));
    }
  });
  test('executes tools-list and rejects CLI flags', async () => {
    const outcomeResult = new ExecutableSkillRequest(
      'skillToolsList:\n  list: {}\n',
    ).execute();
    assert(outcomeResult.isOk());
    const outcome = outcomeResult.value;
    const response = ExecutableSkillHostCliScenario.parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.family).toBe(SkillRequestFamily.ToolsList);
    expect(response.operation).toBe('list');
    const request: RunSkillCliRequest = {
      argv: ['audit', '--path', '.cortex'],
    };
    expect(
      (await ExecutableSkillCli.from(request).execute()).map(
        (response) => response.exitCode,
      ),
    ).toEqual(ok(2));
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
      const outcomeResult = new ExecutableSkillRequest(yaml).execute();
      assert(outcomeResult.isOk());
      const outcome = outcomeResult.value;
      const response = ExecutableSkillHostCliScenario.parseResponse(
        outcome.yaml,
      );
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
      const outcomeResult = new ExecutableSkillRequest(yaml).execute();
      assert(outcomeResult.isOk());
      const outcome = outcomeResult.value;
      const response = ExecutableSkillHostCliScenario.parseResponse(
        outcome.yaml,
      );
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
    const outcomeResult = new ExecutableSkillRequest(
      'name: skill-tools-list\narguments:\n  action: list\n',
    ).execute();
    assert(outcomeResult.isOk());
    const outcome = outcomeResult.value;
    const response = ExecutableSkillHostCliScenario.parseResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.path).toBe('');
    expect(outcome.yaml).toContain(
      'Expected exactly one skill request family.',
    );
  });
  test('bounds requests and final success or failure envelopes', () => {
    const oversizedInputResult = new ExecutableSkillRequest(
      `# ${'x'.repeat(4 * 1_024 * 1_024)}\n`,
    ).execute();
    assert(oversizedInputResult.isOk());
    const oversizedInput = oversizedInputResult.value;
    expect(
      ExecutableSkillHostCliScenario.parseResponse(
        oversizedInput.yaml,
      ).errors?.at(0)?.issue,
    ).toBe(SkillCommandIssue.RequestTooLarge);
    const oversizedScalar = new Array<string>(9).fill('x'.repeat(1_048_576));
    for (const [exitCode, response] of [
      [0, { ok: true, result: oversizedScalar }],
      [2, { ok: false, errors: oversizedScalar }],
    ] as const) {
      const request: FinalSkillCliResponseRequest = {
        exitCode,
        response: response as UntrustedSkillYamlNode,
      };
      const outcomeResult = new ExecutableSkillResponse(request).execute();
      assert(outcomeResult.isOk());
      const outcome = outcomeResult.value;
      expect(outcome.exitCode).toBe(1);
      const expectedError = {
        issue: SkillCommandIssue.ResponseTooLarge,
      };
      expect(
        ExecutableSkillHostCliScenario.parseResponse(outcome.yaml).errors?.at(
          0,
        ),
      ).toMatchObject(expectedError);
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
      const outcomeResult = new ExecutableSkillResponse(request).execute();
      assert(outcomeResult.isOk());
      const outcome = outcomeResult.value;
      expect(outcome.exitCode).toBe(1);
      expect(
        ExecutableSkillHostCliScenario.parseResponse(outcome.yaml).errors?.at(0)
          ?.issue,
      ).toBe(SkillCommandIssue.InvalidResponse);
      expect(ExecutableSkillYaml.from(outcome.yaml).execute().isOk()).toBe(
        true,
      );
      expect(outcome.yaml).not.toMatch(/\.nan|\.inf/iu);
      expect(outcome.yaml.length).toBeLessThan(1_024 * 1_024);
    }
  });
  test('uses decode phase for malformed input', () => {
    const outcome = new ExecutableSkillRequest('[').execute();
    assert(outcome.isOk());
    const response = ExecutableSkillHostCliScenario.parseResponse(
      outcome.value.yaml,
    );
    expect(response.phase).toBe(SkillCommandPhase.Decode);
  });
});
