import { expect, test } from 'bun:test';
import {
  CortexArticleContractKind,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
} from '../src/domain.ts';

type CortexArticleExecutableSkillDefinition = {
  readonly executionKind: string;
  readonly id: string;
  readonly limits: {
    readonly requestBytes: number;
    readonly resultBytes: number;
    readonly timeoutMs: number;
  };
  readonly policyPaths: readonly string[];
  readonly requestKind: string;
  readonly resultKind: string;
  readonly schemaVersion: number;
};

test('keeps the dormant manifest aligned with the semantic contract', async () => {
  const definitionText = await Bun.file(
    `${import.meta.dir}/../executable-skill.json`,
  ).text();
  const definition = JSON.parse(
    definitionText,
  ) as CortexArticleExecutableSkillDefinition;
  const expectedDefinition: CortexArticleExecutableSkillDefinition = {
    schemaVersion: 1,
    id: 'cortex-article-structure',
    executionKind: 'docker-read-only',
    requestKind: CortexArticleContractKind.Request,
    resultKind: CortexArticleContractKind.Result,
    policyPaths: ['.cortex/dynamic-skills/cortex-article-structure.md'],
    limits: {
      requestBytes: CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
      resultBytes: CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
      timeoutMs: 120_000,
    },
  };
  expect(definition).toEqual(expectedDefinition);
});
