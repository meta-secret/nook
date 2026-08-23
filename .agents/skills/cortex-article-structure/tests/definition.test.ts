import { expect, test } from 'bun:test';
import { auditCortexArticleStructure } from '../src/audit.ts';
import {
  decodeCortexArticleRequest,
  encodeCortexArticleRequest,
  encodeCortexArticleResult,
} from '../src/codec.ts';
import {
  CortexArticleContractKind,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleStructureResult,
} from '../src/domain.ts';
import { verifyCortexArticleStructureResult } from '../src/verification.ts';

const request: AuditCortexArticleStructureRequest = {
  kind: CortexArticleContractKind.Request,
  documents: [],
  migrationBaselineEntries: false,
  migrationLedger: {
    relativePath: '.cortex/article-structure-migration.txt',
    content: false,
  },
};

type ExecutableSkillDefinition = {
  readonly limits: {
    readonly requestBytes: number;
    readonly resultBytes: number;
  };
};

test('keeps codec byte bounds equal to the executable manifest', async () => {
  const definitionText = await Bun.file(
    `${import.meta.dir}/../executable-skill.json`,
  ).text();
  const definition = JSON.parse(definitionText) as ExecutableSkillDefinition;
  expect(definition.limits.requestBytes).toBe(
    CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  );
  expect(definition.limits.resultBytes).toBe(CORTEX_ARTICLE_RESULT_BYTE_LIMIT);
});

test('audits and self-verifies through typed in-process contracts', () => {
  const serializedRequest = encodeCortexArticleRequest(request);
  const auditRequest = decodeCortexArticleRequest(serializedRequest);
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings: auditCortexArticleStructure(auditRequest),
  };
  const verificationRequest = { auditRequest, result };
  verifyCortexArticleStructureResult(verificationRequest);
  const serializedResult = encodeCortexArticleResult(result);
  expect(serializedResult).toContain('cortex-article-structure-findings-v1');
});

test('rejects malformed serialized input before audit', () => {
  expect(() => decodeCortexArticleRequest('{}')).toThrow(
    'Invalid Cortex article-structure request',
  );
});
