import { expect, test } from 'bun:test';
import { encodeCortexArticleRequest } from '../src/codec.ts';
import {
  CortexArticleContractKind,
  type AuditCortexArticleStructureRequest,
} from '../src/domain.ts';
import { runCortexArticleStructureSkill } from '../src/runner.ts';

const request: AuditCortexArticleStructureRequest = {
  kind: CortexArticleContractKind.Request,
  documents: [],
  migrationBaselineEntries: false,
  migrationLedger: {
    relativePath: '.cortex/article-structure-migration.txt',
    content: false,
  },
};

test('executes and self-verifies through serialized contracts', async () => {
  const serializedRequest = encodeCortexArticleRequest(request);
  const serializedResult =
    await runCortexArticleStructureSkill(serializedRequest);
  expect(serializedResult).toContain('cortex-article-structure-findings-v1');
});

test('rejects malformed input before execution', async () => {
  await expect(runCortexArticleStructureSkill('{}')).rejects.toThrow(
    'Invalid Cortex article-structure request',
  );
});
