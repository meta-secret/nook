import assert from 'node:assert/strict';
import { ok } from 'neverthrow';
import { EXECUTABLE_SKILL_CATALOG } from '../src/skill-action-registry.ts';
import { ExecutableSkillResponse } from '../src/cli.ts';
import {
  ExecutableSkillYamlEncoding,
  SkillYamlEncodingIssue,
} from '../src/skill-yaml-codec.ts';
import { ExecutableSkillRequest } from '../src/cli.ts';
import { describe, expect, test } from 'bun:test';

import {
  CortexArticleRequestDecodeError,
  CortexArticleTransport,
} from '../../../cortex-article-structure/scripts/src/codec.ts';

import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_PATH_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleStructureResult,
} from '../../../cortex-article-structure/scripts/src/domain.ts';

import {
  DelegationVisualizationContractKind,
  DelegationVisualizationTeam,
} from '../../../delegation-visualization/scripts/src/domain.ts';

import {
  type RunSkillCliRequest,
  type SkillSuccessResponse,
  ExecutableSkillCli,
} from '../src/cli.ts';

import {
  SKILL_TOOLS_LIST_INVOKE,
  ExecutableSkillActions,
} from '../src/skill-action-registry.ts';

import {
  CortexArticleStructureOperation,
  SkillCommandIssue,
  SkillCommandPhase,
  SKILL_HOST_RESPONSE_BYTE_LIMIT,
  SkillRequestFamily,
  type SkillCommandErrorResponse,
} from '../src/skill-command-domain.ts';

import {
  SKILL_YAML_DEPTH_LIMIT,
  type UntrustedSkillYamlMap,
  type UntrustedSkillYamlNode,
  ExecutableSkillYamlAdmission,
  ExecutableSkillYaml,
  ExecutableSkillYamlProperty,
  SkillYamlValue,
  type SkillYamlProperty,
  type SkillYamlPropertyRequest,
} from '../src/skill-yaml-codec.ts';

import {
  type SkillSchemaValidationRequest,
  ExecutableSkillInputSchema,
} from '../src/skill-schema-validator.ts';

export class ExecutableSkillHostCliScenario {
  private constructor(private readonly request: ArticleRequestInput) {}

  static parseResponse(yaml: string): CliResponse {
    const parsed = ExecutableSkillYamlAdmission.from(
      Bun.YAML.parse(yaml),
    ).execute();
    assert(parsed.isOk());
    assert(this.isResponse(parsed.value));
    return parsed.value;
  }

  private static isResponse(
    value: UntrustedSkillYamlNode,
  ): value is CliResponse {
    const candidate = new SkillYamlValue(value);
    if (!candidate.isMap() || typeof candidate.value.ok !== 'boolean') {
      return false;
    }
    return (
      this.optionalString({ key: 'family', map: candidate.value }) &&
      this.optionalString({ key: 'operation', map: candidate.value }) &&
      this.optionalString({ key: 'phase', map: candidate.value }) &&
      this.optionalErrors(candidate.value) &&
      this.optionalResult(candidate.value) &&
      this.optionalRecovery(candidate.value)
    );
  }

  private static optionalString(request: SkillYamlPropertyRequest): boolean {
    const property = new ExecutableSkillYamlProperty(request).execute();
    return !property.found || typeof property.value === 'string';
  }

  private static property(
    request: SkillYamlPropertyRequest,
  ): SkillYamlProperty {
    return new ExecutableSkillYamlProperty(request).execute();
  }

  private static optionalErrors(map: UntrustedSkillYamlMap): boolean {
    if (!Object.hasOwn(map, 'errors')) return true;
    const property = this.property({ key: 'errors', map });
    if (!property.found) return false;
    const candidate = new SkillYamlValue(property.value);
    return (
      candidate.isList() &&
      candidate.value.every((value) => {
        const error = new SkillYamlValue(value);
        return (
          error.isMap() &&
          typeof error.value.path === 'string' &&
          typeof error.value.issue === 'string' &&
          typeof error.value.message === 'string'
        );
      })
    );
  }

  private static optionalResult(map: UntrustedSkillYamlMap): boolean {
    if (!Object.hasOwn(map, 'result')) return true;
    const property = this.property({ key: 'result', map });
    if (!property.found) return false;
    const candidate = new SkillYamlValue(property.value);
    if (!candidate.isMap()) return false;
    return (
      this.optionalMapList({ key: 'findings', map: candidate.value }) &&
      this.optionalActions(candidate.value) &&
      this.optionalDocument(candidate.value)
    );
  }

  private static optionalMapList(request: SkillYamlPropertyRequest): boolean {
    if (!Object.hasOwn(request.map, request.key)) return true;
    const property = this.property(request);
    if (!property.found) return false;
    const candidate = new SkillYamlValue(property.value);
    return (
      candidate.isList() &&
      candidate.value.every((value) => new SkillYamlValue(value).isMap())
    );
  }

  private static optionalActions(map: UntrustedSkillYamlMap): boolean {
    if (!Object.hasOwn(map, 'actions')) return true;
    const property = this.property({ key: 'actions', map });
    if (!property.found) return false;
    const candidate = new SkillYamlValue(property.value);
    return (
      candidate.isList() &&
      candidate.value.every((value) => {
        const action = new SkillYamlValue(value);
        if (!action.isMap()) return false;
        const schemaProperty = this.property({
          key: 'inputSchema',
          map: action.value,
        });
        if (!schemaProperty.found) return false;
        const schema = new SkillYamlValue(schemaProperty.value);
        return (
          typeof action.value.description === 'string' &&
          typeof action.value.exampleRequest === 'string' &&
          typeof action.value.exampleYaml === 'string' &&
          typeof action.value.resolvedExampleYaml === 'string' &&
          schema.isMap() &&
          typeof schema.value.type === 'string' &&
          typeof schema.value.additionalProperties === 'boolean'
        );
      })
    );
  }

  private static optionalDocument(map: UntrustedSkillYamlMap): boolean {
    if (!Object.hasOwn(map, 'document')) return true;
    const documentProperty = this.property({ key: 'document', map });
    if (!documentProperty.found) return false;
    const document = new SkillYamlValue(documentProperty.value);
    if (!document.isMap()) return false;
    const gizmoProperty = this.property({
      key: 'gizmo',
      map: document.value,
    });
    if (!gizmoProperty.found) return false;
    const gizmo = new SkillYamlValue(gizmoProperty.value);
    if (!gizmo.isMap()) return false;
    const tasksProperty = this.property({ key: 'tasks', map: gizmo.value });
    if (!tasksProperty.found) return false;
    const tasks = new SkillYamlValue(tasksProperty.value);
    return (
      tasks.isList() &&
      tasks.value.every((value) => {
        const task = new SkillYamlValue(value);
        if (!task.isMap()) return false;
        const dependenciesProperty = this.property({
          key: 'depends_on',
          map: task.value,
        });
        if (!dependenciesProperty.found) return false;
        const dependencies = new SkillYamlValue(dependenciesProperty.value);
        return (
          typeof task.value.id === 'string' &&
          typeof task.value.team === 'string' &&
          typeof task.value.description === 'string' &&
          dependencies.isList() &&
          dependencies.value.every(
            (dependency) => typeof dependency === 'string',
          )
        );
      })
    );
  }

  private static optionalRecovery(map: UntrustedSkillYamlMap): boolean {
    if (!Object.hasOwn(map, 'recover')) return true;
    const recoveryProperty = this.property({ key: 'recover', map });
    if (!recoveryProperty.found) return false;
    const recovery = new SkillYamlValue(recoveryProperty.value);
    return (
      recovery.isMap() && typeof recovery.value.toolsListRequest === 'string'
    );
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

type CliResponse = UntrustedSkillYamlMap & {
  readonly ok: boolean;
  readonly family?: string;
  readonly operation?: string;
  readonly phase?: string;
  readonly errors?: readonly (UntrustedSkillYamlMap & {
    readonly path: string;
    readonly issue: string;
    readonly message: string;
  })[];
  readonly result?: UntrustedSkillYamlMap & {
    readonly findings?: readonly UntrustedSkillYamlMap[];
    readonly document?: UntrustedSkillYamlMap & {
      readonly gizmo: UntrustedSkillYamlMap & {
        readonly tasks: readonly (UntrustedSkillYamlMap & {
          readonly id: string;
          readonly team: string;
          readonly description: string;
          readonly depends_on: readonly string[];
        })[];
      };
    };
    readonly actions?: readonly (UntrustedSkillYamlMap & {
      readonly description: string;
      readonly exampleRequest: string;
      readonly exampleYaml: string;
      readonly resolvedExampleYaml: string;
      readonly inputSchema: UntrustedSkillYamlMap & {
        readonly type: string;
        readonly additionalProperties: boolean;
      };
    })[];
  };
  readonly recover?: UntrustedSkillYamlMap & {
    readonly toolsListRequest: string;
  };
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
    const specialOutcomeResult = new ExecutableSkillYamlEncoding(specialRequest)
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
    const outcomeResult = new ExecutableSkillYamlEncoding(request)
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
    const oversizedScalar = 'é'.repeat(524_288);
    const oversizedFindings = new Array<number>(9).fill(0).map(() => ({
      code: CortexArticleFindingCode.DenseArticle,
      file: '.cortex/example.md',
      line: 1,
      message: oversizedScalar,
    }));
    const oversizedResult: CortexArticleStructureResult = {
      kind: CortexArticleContractKind.Result,
      findings: oversizedFindings,
    };
    const successResponse: SkillSuccessResponse = {
      ok: true,
      family: SkillRequestFamily.CortexArticleStructure,
      operation: CortexArticleStructureOperation.Audit,
      result: oversizedResult,
    };
    const errorResponse: SkillCommandErrorResponse = {
      ok: false,
      isError: true,
      phase: SkillCommandPhase.Execute,
      errors: new Array<number>(9).fill(0).map(() => ({
        path: 'result',
        issue: SkillCommandIssue.InvalidRequest,
        message: oversizedScalar,
      })),
      recover: {
        toolsListRequest: SKILL_TOOLS_LIST_INVOKE,
        hint: 'Retry the request.',
      },
    };
    for (const [exitCode, response] of [
      [0, successResponse],
      [2, errorResponse],
    ] as const) {
      const request = { exitCode, response };
      const outcomeResult = new ExecutableSkillResponse(request).execute();
      assert(outcomeResult.isErr());
      expect(outcomeResult.error.kind).toBe(
        SkillYamlEncodingIssue.ResponseCapacity,
      );
    }
  });
  test('propagates invalid action result serialization without a fallback', () => {
    for (const value of [NaN, Infinity, 2 ** 53, 'é'.repeat(524_289)]) {
      const result: CortexArticleStructureResult = {
        kind: CortexArticleContractKind.Result,
        findings: [
          {
            code: CortexArticleFindingCode.DenseArticle,
            file: '.cortex/example.md',
            line: typeof value === 'number' ? value : 1,
            message: typeof value === 'string' ? value : 'invalid number',
          },
        ],
      };
      const response: SkillSuccessResponse = {
        ok: true,
        family: SkillRequestFamily.CortexArticleStructure,
        operation: CortexArticleStructureOperation.Audit,
        result,
      };
      const request = {
        exitCode: 0,
        response,
      };
      const outcomeResult = new ExecutableSkillResponse(request).execute();
      assert(outcomeResult.isErr());
      expect(outcomeResult.error.kind).toBe(
        SkillYamlEncodingIssue.InvalidValue,
      );
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
  test('rejects malformed decoded CLI response shapes', () => {
    for (const yaml of [
      '- invalid\n',
      'ok: invalid\n',
      'ok: false\nerrors: invalid\n',
      'ok: false\nerrors:\n  - path: result\n    issue: 1\n    message: invalid\n',
      'ok: true\nresult:\n  actions:\n    - description: invalid\n',
    ]) {
      expect(() =>
        ExecutableSkillHostCliScenario.parseResponse(yaml),
      ).toThrow();
    }
  });
});
