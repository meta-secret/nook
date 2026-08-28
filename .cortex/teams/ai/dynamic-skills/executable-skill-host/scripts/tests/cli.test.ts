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
  CortexArticleFindingCode,
  SKILL_FINDING_CODES,
  SKILL_PROVIDER_RESULT_BYTE_LIMIT,
  SKILL_TOOLS_LIST_INVOKE,
} from '../src/skill-action-registry.ts';
import {
  SkillCommandIssue,
  SkillCommandPhase,
  SKILL_HOST_RESPONSE_BYTE_LIMIT,
  SkillRequestFamily,
} from '../src/skill-command-domain.ts';
import {
  parseSkillYamlText,
  type UntrustedSkillYamlNode,
} from '../src/skill-yaml-codec.ts';
type SkillCliResponseTransport = {
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
      readonly skillId: string;
      readonly family: string;
      readonly operation: string;
      readonly description: string;
      readonly exampleRequest: string;
      readonly exampleYaml: string;
      readonly resolvedExampleYaml: string;
      readonly inputSchema: {
        readonly type: string;
        readonly additionalProperties: boolean;
      };
    }[];
    readonly kind?: string;
    readonly findings?: readonly {
      readonly code: string;
    }[];
  };
  readonly recover?: {
    readonly toolsListRequest: string;
    readonly hint: string;
  };
};
function parseCliResponse(yaml: string): SkillCliResponseTransport {
  return Bun.YAML.parse(yaml) as SkillCliResponseTransport;
}
function articleExampleYaml(): string {
  const action = listDiscoverableSkillActions().actions.find(
    (candidate) =>
      candidate.family === SkillRequestFamily.CortexArticleStructure,
  );
  if (!action) throw new Error('Missing article-structure action.');
  return action.exampleYaml;
}
describe('executable skill YAML command protocol', () => {
  test('lists every action with a schema and executable YAML example', async () => {
    const request: RunSkillCliRequest = { argv: [] };
    const outcome = await runSkillCli(request);
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(parseSkillYamlText(outcome.yaml).ok).toBe(true);
    expect(response.ok).toBe(true);
    const actions = response.result?.actions;
    if (!actions) throw new Error('Missing discovered actions.');
    expect(actions).toHaveLength(2);
    for (const action of actions) {
      expect(action.description).not.toBeEmpty();
      expect(action.exampleRequest).not.toBeEmpty();
      expect(action.exampleRequest).not.toContain('skills:run');
      expect(action.exampleYaml).not.toBeEmpty();
      expect(action.resolvedExampleYaml).toBe(action.exampleYaml);
      expect(action.inputSchema.type).toBe('object');
      expect(action.inputSchema.additionalProperties).toBe(false);
      expect(dispatchSkillYamlText(action.exampleYaml).exitCode).toBe(0);
    }
    for (const argv of [['--help'], ['--default', 'toolsList']]) {
      const invocationRequest: RunSkillCliRequest = { argv };
      expect((await runSkillCli(invocationRequest)).exitCode).toBe(0);
    }
    const usageRequest: RunSkillCliRequest = {
      argv: ['audit', '--path', '.cortex'],
    };
    expect((await runSkillCli(usageRequest)).exitCode).toBe(2);
  });
  test('executes the article-structure audit through its domain YAML action', () => {
    const outcome = dispatchSkillYamlText(articleExampleYaml());
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.family).toBe(SkillRequestFamily.CortexArticleStructure);
    expect(response.operation).toBe('audit');
    expect(response.result?.kind).toBe('cortex-article-structure-findings-v1');
    expect(response.result?.findings).toEqual([]);
  });
  test('publishes exact disjoint heading and simple-block schemas', () => {
    const action = listDiscoverableSkillActions().actions.find(
      (candidate) =>
        candidate.family === SkillRequestFamily.CortexArticleStructure,
    );
    if (!action) throw new Error('Missing article-structure action.');
    const documents = action.inputSchema.properties.documents;
    if (!documents) throw new Error('Missing documents schema.');
    if (!('items' in documents)) throw new Error('Missing document schema.');
    expect(documents.maxItems).toBe(10_000);
    const blocks = documents.items;
    if (!('properties' in blocks)) throw new Error('Missing blocks schema.');
    const blockItems = blocks.properties.blocks;
    if (!blockItems) throw new Error('Missing block items schema.');
    if (!('items' in blockItems)) throw new Error('Missing block item schema.');
    expect(blockItems.maxItems).toBe(100_000);
    expect(action.inputSchema.maximumRequestBytes).toBe(4 * 1_024 * 1_024);
    expect(action.inputSchema.maximumResponseBytes).toBe(
      SKILL_HOST_RESPONSE_BYTE_LIMIT,
    );
    const expectedResultConstraints = {
      maximumBytes: 1_024 * 1_024,
      maximumFindings: 50_000,
      rule: 'The deterministic audit result derived from this request must fit both limits.',
    };
    expect(action.inputSchema.derivedResultConstraints).toEqual(
      expectedResultConstraints,
    );
    if (!('oneOf' in blockItems.items)) {
      throw new Error('Missing semantic block variants.');
    }
    expect(blockItems.items.oneOf).toHaveLength(2);
    const headingSchema = blockItems.items.oneOf.at(0);
    const simpleBlockSchema = blockItems.items.oneOf.at(1);
    if (!headingSchema || !('required' in headingSchema)) {
      throw new Error('Missing heading schema.');
    }
    if (!simpleBlockSchema || !('required' in simpleBlockSchema)) {
      throw new Error('Missing simple-block schema.');
    }
    expect(headingSchema.additionalProperties).toBe(false);
    expect(headingSchema.required).toEqual(['depth', 'kind', 'line', 'text']);
    const depthSchema = headingSchema.properties.depth;
    const textSchema = headingSchema.properties.text;
    if (!depthSchema || !('maximum' in depthSchema)) {
      throw new Error('Missing heading-depth bound.');
    }
    if (!textSchema || !('maxLength' in textSchema)) {
      throw new Error('Missing heading-text bound.');
    }
    expect(depthSchema.maximum).toBe(6);
    expect(textSchema.maxLength).toBe(3_800);
    expect(simpleBlockSchema.additionalProperties).toBe(false);
    expect(simpleBlockSchema.required).toEqual(['kind', 'line']);
    const migrationLedger = action.inputSchema.properties.migrationLedger;
    if (!migrationLedger || !('properties' in migrationLedger)) {
      throw new Error('Missing migration-ledger schema.');
    }
    const content = migrationLedger.properties.content;
    if (!content || !('oneOf' in content)) {
      throw new Error('Missing migration-ledger content variants.');
    }
    const textContent = content.oneOf.at(0);
    if (!textContent || !('maxTrimmedLineLength' in textContent)) {
      throw new Error('Missing migration-ledger line bound.');
    }
    expect(textContent.maxTrimmedLineLength).toBe(3_800);
    expect(textContent.maxTrimmedLines).toBe(50_000);
  });
  test('fails closed with typed error and corrective recovery', () => {
    const outcome = dispatchSkillYamlText(
      'cortexArticleStructure:\n  unsupported: {}\n',
    );
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.phase).toBe(SkillCommandPhase.Decode);
    expect(response.errors?.at(0)?.path).toBe(
      'cortexArticleStructure["<unknown-key>"]',
    );
    expect(response.errors?.at(0)?.issue).toBe(
      SkillCommandIssue.InvalidRequest,
    );
    expect(response.recover?.toolsListRequest).toBe(SKILL_TOOLS_LIST_INVOKE);
    expect(response.recover?.hint).toContain('List skill actions');
  });
  test('reports exact operation and canonical structural-key paths', () => {
    const audit = articleExampleYaml();
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
      ['cortexArticleStructure: {}\n', 'cortexArticleStructure.audit'],
      [
        audit.replace('  audit:', '  unsupported: {}\n  audit:'),
        'cortexArticleStructure["<unknown-key>"]',
      ],
      [
        `${audit}  unsupported: {}\n`,
        'cortexArticleStructure["<unknown-key>"]',
      ],
      ['"SECRET_IN_KEY": value\n', '["<unknown-key>"]'],
      ['"\\u202eBIDI_MARKER": value\n', '["<unknown-key>"]'],
      ['"\\u2028SEP_MARKER": value\n', '["<unknown-key>"]'],
      ['"\\u2029PARA_MARKER": value\n', '["<unknown-key>"]'],
      ['"\\u0085C1_MARKER": value\n', '["<unknown-key>"]'],
      ['"NEW\\nLINE_MARKER": value\n', '["<unknown-key>"]'],
      ['"ESC\\eAPE_MARKER": value\n', '["<unknown-key>"]'],
      ['hyphen-marker: value\n', '["<unknown-key>"]'],
    ] as const;
    for (const [yaml, path] of cases) {
      const outcome = dispatchSkillYamlText(yaml);
      const response = parseCliResponse(outcome.yaml);
      expect(outcome.exitCode).toBe(2);
      expect(response.errors?.at(0)?.path).toBe(path);
      expect(outcome.yaml).not.toMatch(/SECRET|MARKER|BIDI|LINE|APE/u);
    }
  });
  test('uses tools-list recovery for unmatched and ambiguous roots', () => {
    for (const yaml of [
      'unsupported: {}\n',
      'skillToolsList:\n  list: {}\ncortexArticleStructure:\n  audit: {}\n',
    ]) {
      const response = parseCliResponse(dispatchSkillYamlText(yaml).yaml);
      expect(response.recover?.toolsListRequest).toBe(SKILL_TOOLS_LIST_INVOKE);
    }
  });
  test('reports codec-only and migration field paths', () => {
    const audit = articleExampleYaml();
    const cases = [
      [
        audit.replace(
          '    migrationBaselineEntries:',
          '      - relativePath: .cortex/example.md\n        blocks: []\n    migrationBaselineEntries:',
        ),
        'cortexArticleStructure.audit.documents[1].relativePath',
      ],
      [
        audit.replace('            line: 3', '            line: 1'),
        'cortexArticleStructure.audit.documents[0].blocks[1].line',
      ],
      [
        audit.replace(
          '    migrationBaselineEntries: false',
          '    migrationBaselineEntries:\n      - README.md',
        ),
        'cortexArticleStructure.audit.migrationBaselineEntries[0]',
      ],
      [
        audit.replace(
          '.cortex/article-structure-migration.txt',
          '.cortex/other-ledger.txt',
        ),
        'cortexArticleStructure.audit.migrationLedger.relativePath',
      ],
      [
        audit.replace('content: false', `content: "${'x\\n'.repeat(50_001)}"`),
        'cortexArticleStructure.audit.migrationLedger.content',
      ],
    ] as const;
    for (const [yaml, path] of cases) {
      const response = parseCliResponse(dispatchSkillYamlText(yaml).yaml);
      expect(response.errors?.at(0)?.path).toBe(path);
    }
  });
  test('rejects terminal controls before they reach YAML diagnostics', () => {
    const audit = articleExampleYaml();
    expect(
      dispatchSkillYamlText(
        audit.replace('text: Overview', 'text: "Family 👨‍👩‍👧‍👦️"'),
      ).exitCode,
    ).toBe(0);
    const cases = [
      [
        'text: Overview',
        'text: "MARKER\\u061c"',
        'documents[0].blocks[0].text',
      ],
      [
        '.cortex/example.md',
        '".cortex/MARKER\\u200f.md"',
        'documents[0].relativePath',
      ],
      [
        'migrationBaselineEntries: false',
        'migrationBaselineEntries: [".cortex/MARKER\\u2066.md"]',
        'migrationBaselineEntries[0]',
      ],
      ['content: false', 'content: "MARKER\\u001b"', 'migrationLedger.content'],
      ['content: false', 'content: "MARKER\\rtext"', 'migrationLedger.content'],
    ] as const;
    for (const [source, replacement, suffix] of cases) {
      const outcome = dispatchSkillYamlText(audit.replace(source, replacement));
      const response = parseCliResponse(outcome.yaml);
      expect(response.errors?.at(0)?.path).toBe(
        `cortexArticleStructure.audit.${suffix}`,
      );
      expect(new TextEncoder().encode(outcome.yaml)).not.toContain(0x1b);
      expect(outcome.yaml).not.toMatch(
        /MARKER|[\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/u,
      );
    }
  });
  test('rejects nested unknown fields at their exact path', () => {
    const request = articleExampleYaml().replace(
      '    documents:',
      '    unsupported: true\n    documents:',
    );
    const outcome = dispatchSkillYamlText(request);
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.path).toBe(
      'cortexArticleStructure.audit["<unknown-key>"]',
    );
  });
  test('redacts unknown-field scalar values from corrective diagnostics', () => {
    const secretMarker = 'SECRET_MARKER';
    const request = articleExampleYaml().replace(
      '    documents:',
      `    apiToken: ${secretMarker}\n    documents:`,
    );
    const outcome = dispatchSkillYamlText(request);
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.path).toBe(
      'cortexArticleStructure.audit["<unknown-key>"]',
    );
    expect(outcome.yaml).not.toContain(secretMarker);
  });
  test('rejects generic name and arguments envelopes', () => {
    const outcome = dispatchSkillYamlText(
      'name: cortex-article-structure\narguments:\n  action: audit\n',
    );
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.path).toBe('');
    expect(outcome.yaml).toContain(
      'Expected exactly one skill request family.',
    );
  });
  test('reports YAML syntax failures without echoing source scalars', () => {
    const secretMarker = 'SECRET_MARKER';
    const outcome = dispatchSkillYamlText(
      `cortexArticleStructure: [${secretMarker}\n`,
    );
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.issue).toBe(SkillCommandIssue.InvalidYaml);
    expect(response.errors?.at(0)?.message).toBe('Invalid YAML syntax.');
    expect(outcome.yaml).not.toContain(secretMarker);
  });
  test('rejects duplicate-key bypasses and multiple documents with bounded redaction', () => {
    const secretMarker = 'SECRET_MARKER';
    const duplicateAudit = articleExampleYaml().replace(
      '  audit:',
      `  audit:\n    apiToken: ${secretMarker}\n  audit:`,
    );
    const multipleDocuments = `${articleExampleYaml()}---\napiToken: ${secretMarker}\n`;
    for (const request of [duplicateAudit, multipleDocuments]) {
      const outcome = dispatchSkillYamlText(request);
      const response = parseCliResponse(outcome.yaml);
      expect(outcome.exitCode).toBe(2);
      expect(response.errors?.at(0)?.issue).toBe(SkillCommandIssue.InvalidYaml);
      expect(outcome.yaml).not.toContain(secretMarker);
      expect(
        new TextEncoder().encode(outcome.yaml).byteLength,
      ).toBeLessThanOrEqual(SKILL_PROVIDER_RESULT_BYTE_LIMIT);
    }
  });
  test('rejects LF and bare-CR alias expansion with bounded redacted YAML', () => {
    const secretMarker = 'SECRET_MARKER';
    for (const lineEnding of ['\n', '\r']) {
      const lines = [`level0: &level0 [${secretMarker}]`];
      for (let level = 1; level <= 12; level += 1) {
        const previous = `level${level - 1}`;
        const aliases = new Array<string>(8).fill(`*${previous}`).join(', ');
        lines.push(`level${level}: &level${level} [${aliases}]`);
      }
      const request = `${lines.join(lineEnding)}${lineEnding}`;
      const outcome = dispatchSkillYamlText(request);
      const response = parseCliResponse(outcome.yaml);
      expect(outcome.exitCode).toBe(2);
      expect(response.errors?.at(0)?.issue).toBe(SkillCommandIssue.InvalidYaml);
      expect(outcome.yaml).not.toContain(secretMarker);
      expect(
        new TextEncoder().encode(outcome.yaml).byteLength,
      ).toBeLessThanOrEqual(SKILL_PROVIDER_RESULT_BYTE_LIMIT);
    }
  });
  test('bounds source input and echoed corrective YAML before parsing', () => {
    const oversizedYaml = `# ${'x'.repeat(4 * 1_024 * 1_024)}\n`;
    const outcome = dispatchSkillYamlText(oversizedYaml);
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.issue).toBe(
      SkillCommandIssue.RequestTooLarge,
    );
    expect(new TextEncoder().encode(outcome.yaml).byteLength).toBeLessThan(
      1_024 * 1_024,
    );
  });
  test('bounds host response envelopes', () => {
    const oversizedScalar = 'x'.repeat(SKILL_HOST_RESPONSE_BYTE_LIMIT);
    const successResponse = {
      ok: true,
      result: oversizedScalar,
    } as UntrustedSkillYamlNode;
    const failureResponse = {
      ok: false,
      errors: [oversizedScalar],
    } as UntrustedSkillYamlNode;
    const successRequest: FinalSkillCliResponseRequest = {
      exitCode: 0,
      response: successResponse,
    };
    const failureRequest: FinalSkillCliResponseRequest = {
      exitCode: 2,
      response: failureResponse,
    };
    for (const request of [successRequest, failureRequest]) {
      const outcome = finalizeSkillCliResponse(request);
      const response = parseCliResponse(outcome.yaml);
      expect(outcome.exitCode).toBe(1);
      expect(response.errors?.at(0)?.issue).toBe(
        SkillCommandIssue.ResponseTooLarge,
      );
      expect(
        new TextEncoder().encode(outcome.yaml).byteLength,
      ).toBeLessThanOrEqual(SKILL_HOST_RESPONSE_BYTE_LIMIT);
    }
  });
  test('accepts near-limit YAML and rejects true provider oversize', () => {
    for (const [count, exitCode, path] of [
      [9_000, 0, false],
      [15_000, 2, 'cortexArticleStructure.audit.documents[0].blocks[14999]'],
    ] as const) {
      const lines = [
        'cortexArticleStructure:',
        '  audit:',
        '    kind: cortex-article-structure-audit-v1',
        '    documents:',
        '      - relativePath: .cortex/aa.md',
        '        blocks:',
      ];
      for (let index = 0; index < count; index += 1)
        lines.push(
          '          - depth: 2',
          '            kind: heading',
          `            line: ${index + 1}`,
          '            text: ""',
        );
      lines.push(
        '    migrationBaselineEntries: false',
        '    migrationLedger:',
        '      relativePath: .cortex/article-structure-migration.txt',
        '      content: false',
      );
      const outcome = dispatchSkillYamlText(`${lines.join('\n')}\n`);
      expect(outcome.exitCode).toBe(exitCode);
      const response = parseCliResponse(outcome.yaml);
      expect(Boolean(response.errors)).toBe(path !== false);
      if (path !== false) expect(response.errors?.at(0)?.path).toBe(path);
      expect(
        new TextEncoder().encode(outcome.yaml).byteLength,
      ).toBeLessThanOrEqual(SKILL_HOST_RESPONSE_BYTE_LIMIT);
    }
  });
  test('keeps every article finding code visible to the executable action', () => {
    expect(SKILL_FINDING_CODES).toEqual([
      CortexArticleFindingCode.InvalidMigrationLedger,
      CortexArticleFindingCode.EmptyArticle,
      CortexArticleFindingCode.DenseArticle,
      CortexArticleFindingCode.UnorderedProcedure,
    ]);
  });
});
