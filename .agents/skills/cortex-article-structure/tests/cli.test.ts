import { describe, expect, test } from 'bun:test';
import {
  dispatchSkillYamlText,
  runSkillCli,
  type RunSkillCliRequest,
} from '../../cli.ts';
import {
  listDiscoverableSkillActions,
  SKILL_FINDING_CODES,
} from '../../skill-action-registry.ts';
import { CortexArticleFindingCode } from '../src/domain.ts';
import {
  SkillCommandIssue,
  SkillCommandPhase,
  SkillRequestFamily,
} from '../../skill-command-domain.ts';

type SkillCliResponseTransport = {
  readonly ok: boolean;
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
};

function parseCliResponse(yaml: string): SkillCliResponseTransport {
  return Bun.YAML.parse(yaml) as SkillCliResponseTransport;
}

describe('executable skill YAML command protocol', () => {
  test('lists every action with a schema and executable YAML example', async () => {
    const request: RunSkillCliRequest = { argv: [] };
    const outcome = await runSkillCli(request);
    const response = parseCliResponse(outcome.yaml);

    expect(outcome.exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(outcome.yaml.split('\n').length).toBeGreaterThan(10);
    const actions = response.result?.actions ?? [];
    expect(actions.length).toBeGreaterThanOrEqual(2);
    for (const action of actions) {
      expect(action.description.length).toBeGreaterThan(0);
      expect(action.exampleRequest).toContain('task skills:');
      expect(action.exampleYaml.length).toBeGreaterThan(0);
      expect(action.inputSchema.type).toBe('object');
      expect(action.inputSchema.additionalProperties).toBe(false);
      expect(dispatchSkillYamlText(action.exampleYaml).exitCode).toBe(0);
    }
  });

  test('executes the article-structure audit through its domain YAML action', () => {
    const action = listDiscoverableSkillActions().actions.find(
      (candidate) =>
        candidate.family === SkillRequestFamily.CortexArticleStructure,
    );
    expect(Boolean(action)).toBe(true);
    if (!action) throw new Error('Missing article-structure action.');

    const outcome = dispatchSkillYamlText(action.exampleYaml);
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.result?.kind).toBe('cortex-article-structure-findings-v1');
    expect(response.result?.findings).toEqual([]);
  });

  test('publishes exact disjoint heading and simple-block schemas', () => {
    const action = listDiscoverableSkillActions().actions.find(
      (candidate) =>
        candidate.family === SkillRequestFamily.CortexArticleStructure,
    );
    expect(Boolean(action)).toBe(true);
    if (!action) throw new Error('Missing article-structure action.');

    const documents = action.inputSchema.properties.documents;
    if (!documents) throw new Error('Missing documents schema.');
    expect('items' in documents).toBe(true);
    if (!('items' in documents)) throw new Error('Missing document schema.');
    expect(documents.maxItems).toBe(10_000);
    const blocks = documents.items;
    expect('properties' in blocks).toBe(true);
    if (!('properties' in blocks)) throw new Error('Missing blocks schema.');
    const blockItems = blocks.properties.blocks;
    if (!blockItems) throw new Error('Missing block items schema.');
    expect('items' in blockItems).toBe(true);
    if (!('items' in blockItems)) throw new Error('Missing block item schema.');
    expect(blockItems.maxItems).toBe(100_000);
    expect(action.inputSchema.maximumRequestBytes).toBe(4 * 1_024 * 1_024);
    const expectedResultConstraints = {
      maximumBytes: 1_024 * 1_024,
      maximumFindings: 50_000,
      rule: 'The deterministic audit result derived from this request must fit both limits.',
    };
    expect(action.inputSchema.derivedResultConstraints).toEqual(
      expectedResultConstraints,
    );
    expect('oneOf' in blockItems.items).toBe(true);
    if (!('oneOf' in blockItems.items)) {
      throw new Error('Missing semantic block variants.');
    }
    expect(blockItems.items.oneOf).toHaveLength(2);
    const headingSchema = blockItems.items.oneOf.at(0);
    const simpleBlockSchema = blockItems.items.oneOf.at(1);
    expect(Boolean(headingSchema)).toBe(true);
    expect(Boolean(simpleBlockSchema)).toBe(true);
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
    expect(Boolean(depthSchema)).toBe(true);
    expect(Boolean(textSchema)).toBe(true);
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
  });

  test('fails closed with a path and corrective blueprint', () => {
    const outcome = dispatchSkillYamlText(
      'cortexArticleStructure:\n  unsupported: {}\n',
    );
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.phase).toBe(SkillCommandPhase.Decode);
    expect(response.errors?.at(0)?.path).toBe('cortexArticleStructure');
    expect(response.errors?.at(0)?.issue).toBe(
      SkillCommandIssue.InvalidRequest,
    );
    expect(outcome.yaml).toContain('blueprintYaml:');
    expect(outcome.yaml).toContain('cortexArticleStructure:');
  });

  test('reports YAML syntax failures as YAML', () => {
    const outcome = dispatchSkillYamlText('cortexArticleStructure: [\n');
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.issue).toBe(SkillCommandIssue.InvalidYaml);
    expect(outcome.yaml).toContain('parseMessage:');
  });

  test('bounds source input and echoed corrective YAML before parsing', () => {
    const oversizedYaml = `# ${'x'.repeat(4 * 1_024 * 1_024)}\n`;
    const outcome = dispatchSkillYamlText(oversizedYaml);
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.issue).toBe(
      SkillCommandIssue.RequestTooLarge,
    );
    expect(outcome.yaml).toContain('received YAML truncated');
    expect(new TextEncoder().encode(outcome.yaml).byteLength).toBeLessThan(
      1_024 * 1_024,
    );
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
