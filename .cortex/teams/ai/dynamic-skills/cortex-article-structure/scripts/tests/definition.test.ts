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
  };
  readonly policyPaths: readonly string[];
  readonly requestKind: string;
  readonly resultKind: string;
  readonly schemaVersion: number;
};

type ExecutableSkillPackage = {
  readonly scripts: Readonly<Record<string, string>>;
};

test('keeps the application manifest aligned with the semantic contract', async () => {
  const definitionText = await Bun.file(
    `${import.meta.dir}/../executable-skill.json`,
  ).text();
  const definition = JSON.parse(
    definitionText,
  ) as CortexArticleExecutableSkillDefinition;
  const expectedDefinition: CortexArticleExecutableSkillDefinition = {
    schemaVersion: 1,
    id: 'cortex-article-structure',
    executionKind: 'in-process-read-only',
    requestKind: CortexArticleContractKind.Request,
    resultKind: CortexArticleContractKind.Result,
    policyPaths: [
      '.cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md',
    ],
    limits: {
      requestBytes: CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
      resultBytes: CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
    },
  };
  expect(definition).toEqual(expectedDefinition);
});

test('keeps the independent package commands development-only', async () => {
  const packageText = await Bun.file(
    `${import.meta.dir}/../package.json`,
  ).text();
  const packageDocument = JSON.parse(packageText) as ExecutableSkillPackage;
  const expectedScripts: Readonly<Record<string, string>> = {
    check: 'tsc --noEmit',
    lint: 'eslint .',
    format:
      'prettier --write "src/**/*.ts" "tests/**/*.ts" executable-skill.json "*.{json,md}" eslint.config.js .prettierrc',
    'format:check':
      'prettier --check "src/**/*.ts" "tests/**/*.ts" executable-skill.json "*.{json,md}" eslint.config.js .prettierrc',
    test: 'bun test tests',
    verify:
      'bun run format:check && bun run lint && bun run check && bun test tests',
  };
  expect(packageDocument.scripts).toEqual(expectedScripts);
});
