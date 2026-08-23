import path from 'node:path';
import { expect, setDefaultTimeout, test } from 'bun:test';
import {
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_HEADING_TEXT_LIMIT,
  CortexArticleFindingCode,
  decodeCortexArticleResult,
  encodeCortexArticleRequest,
} from '../src/executable-skills/cortex-article-transport.ts';
import {
  ExecutableSkillRegistryInspectionKind,
  inspectExecutableSkillRegistry,
} from '../src/executable-skills/registry.ts';
import { executeRegisteredSkill } from '../src/executable-skills/runtime.ts';
import type { ExecuteRegisteredSkillRequest } from '../src/executable-skills/runtime.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');
setDefaultTimeout(180_000);

test('round-trips maximal headings through the registered container', async () => {
  const emptyDocumentRequest: ArticleDocumentRequest = {
    body: '',
    headingPrefix: 'Empty article ',
    relativePath: '.cortex/max-empty.md',
  };
  const denseDocumentRequest: ArticleDocumentRequest = {
    body: 'One.\n\nTwo.\n\nThree.\n\nFour.\n',
    headingPrefix: 'Purpose ',
    relativePath: '.cortex/max-dense.md',
  };
  const procedureDocumentRequest: ArticleDocumentRequest = {
    body: 'One.\n\nTwo.\n\nThree.\n\nFour.\n',
    headingPrefix: 'Recovery procedure ',
    relativePath: '.cortex/max-procedure.md',
  };
  const articleRequest = {
    documents: [
      articleDocument(emptyDocumentRequest),
      articleDocument(denseDocumentRequest),
      articleDocument(procedureDocumentRequest),
    ],
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: false,
    },
  } as const;
  const serializedRequest = encodeCortexArticleRequest(articleRequest);
  const inspectionRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    repositoryRoot: REPOSITORY_ROOT,
    signal: false,
  } as const;
  const inspection = await inspectExecutableSkillRegistry(inspectionRequest);
  if (inspection.kind !== ExecutableSkillRegistryInspectionKind.Verified) {
    throw new Error('Executable skill boundary registry is invalid.');
  }
  const executionRequest: ExecuteRegisteredSkillRequest = {
    registryAuthority: inspection.authority,
    skillId: 'cortex-article-structure',
    serializedRequest,
    signal: false,
  };
  const execution = await executeRegisteredSkill(executionRequest);
  const findings = decodeCortexArticleResult(execution.serializedResult);
  expect(findings.map((finding) => finding.code)).toEqual([
    CortexArticleFindingCode.EmptyArticle,
    CortexArticleFindingCode.DenseArticle,
    CortexArticleFindingCode.DenseArticle,
    CortexArticleFindingCode.UnorderedProcedure,
  ]);
  expect(
    findings.every(
      (finding) =>
        finding.message.length <= CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
    ),
  ).toBe(true);
});

type ArticleDocumentRequest = {
  readonly body: string;
  readonly headingPrefix: string;
  readonly relativePath: string;
};

function articleDocument(request: ArticleDocumentRequest) {
  const heading = `${request.headingPrefix}${'x'.repeat(
    CORTEX_ARTICLE_HEADING_TEXT_LIMIT - request.headingPrefix.length,
  )}`;
  return {
    relativePath: request.relativePath,
    content: `# Boundary\n\n## Document map\n\n- Entry\n\n## ${heading}\n\n${request.body}`,
  };
}
