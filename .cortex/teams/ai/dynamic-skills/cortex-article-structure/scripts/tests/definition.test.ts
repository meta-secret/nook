import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  CortexArticleContractKind,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
} from '../src/domain.ts';

const CORTEX_ARTICLE_EXECUTABLE_SKILL_DEFINITION_SCHEMA = z
  .object({
    executionKind: z.string(),
    id: z.string(),
    limits: z
      .object({ requestBytes: z.number(), resultBytes: z.number() })
      .strict(),
    policyPaths: z.array(z.string()),
    requestKind: z.string(),
    resultKind: z.string(),
    schemaVersion: z.number(),
  })
  .strict();

const EXECUTABLE_SKILL_PACKAGE_SCHEMA = z.object({
  scripts: z.record(z.string(), z.string()),
});

type CortexArticleExecutableSkillDefinition = z.output<
  typeof CORTEX_ARTICLE_EXECUTABLE_SKILL_DEFINITION_SCHEMA
>;

test('keeps the application manifest aligned with the semantic contract', async () => {
  const definitionText = await Bun.file(
    `${import.meta.dir}/../executable-skill.json`,
  ).text();
  const definition = CORTEX_ARTICLE_EXECUTABLE_SKILL_DEFINITION_SCHEMA.parse(
    JSON.parse(definitionText),
  );
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
  const packageDocument = EXECUTABLE_SKILL_PACKAGE_SCHEMA.parse(
    JSON.parse(packageText),
  );
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
