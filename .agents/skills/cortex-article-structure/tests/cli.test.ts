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
    expect(action).toBeDefined();
    if (!action) throw new Error('Missing article-structure action.');

    const outcome = dispatchSkillYamlText(action.exampleYaml);
    const response = parseCliResponse(outcome.yaml);
    expect(outcome.exitCode).toBe(0);
    expect(response.result?.kind).toBe('cortex-article-structure-findings-v1');
    expect(response.result?.findings).toEqual([]);
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

  test('keeps every article finding code visible to the executable action', () => {
    expect(SKILL_FINDING_CODES).toEqual([
      CortexArticleFindingCode.InvalidMigrationLedger,
      CortexArticleFindingCode.EmptyArticle,
      CortexArticleFindingCode.DenseArticle,
      CortexArticleFindingCode.UnorderedProcedure,
    ]);
  });
});
