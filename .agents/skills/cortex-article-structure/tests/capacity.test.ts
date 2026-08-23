import { expect, setDefaultTimeout, test } from 'bun:test';
import {
  decodeCortexArticleRequest,
  decodeCortexArticleResult,
  encodeCortexArticleRequest,
} from '../src/codec.ts';
import {
  CortexArticleBlockKind,
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CORTEX_ARTICLE_FINDING_LIMIT,
} from '../src/domain.ts';
import type {
  AuditCortexArticleStructureRequest,
  CortexArticleBlock,
  CortexArticleFinding,
} from '../src/domain.ts';
import { runCortexArticleStructureSkill } from '../src/runner.ts';

setDefaultTimeout(30_000);

type CapacityRequest = {
  readonly blockCount: number;
  readonly ledgerEntryCount: number;
};

function requestAtCapacity(
  request: CapacityRequest,
): AuditCortexArticleStructureRequest {
  const block: CortexArticleBlock = {
    line: 1,
    type: CortexArticleBlockKind.Paragraph,
  };
  return {
    kind: CortexArticleContractKind.Request,
    documents:
      request.blockCount === 0
        ? []
        : [
            {
              relativePath: '.cortex/example.md',
              blocks: new Array<CortexArticleBlock>(request.blockCount).fill(
                block,
              ),
            },
          ],
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content:
        request.ledgerEntryCount === 0
          ? false
          : new Array<string>(request.ledgerEntryCount)
              .fill('invalid-entry')
              .join('\n'),
    },
  };
}

test('accepts the exact aggregate finding capacity and rejects plus one', () => {
  const exactCapacityRequest: CapacityRequest = {
    blockCount: 20_000,
    ledgerEntryCount: CORTEX_ARTICLE_FINDING_LIMIT - 20_000,
  };
  const exactRequest = requestAtCapacity(exactCapacityRequest);
  expect(() =>
    decodeCortexArticleRequest(encodeCortexArticleRequest(exactRequest)),
  ).not.toThrow();

  const overflowCapacityRequest: CapacityRequest = {
    blockCount: 20_000,
    ledgerEntryCount: CORTEX_ARTICLE_FINDING_LIMIT - 20_000 + 1,
  };
  const overflowRequest = requestAtCapacity(overflowCapacityRequest);
  expect(() =>
    decodeCortexArticleRequest(encodeCortexArticleRequest(overflowRequest)),
  ).toThrow('finding capacity exceeds its bound');
});

test('aligns the exact result finding limit and plus one', () => {
  const finding: CortexArticleFinding = {
    code: CortexArticleFindingCode.InvalidMigrationLedger,
    file: '.cortex/article-structure-migration.txt',
    line: 1,
    message: 'Article-structure exemption is not a Cortex Markdown file.',
  };
  const exactResult = {
    kind: CortexArticleContractKind.Result,
    findings: new Array<CortexArticleFinding>(
      CORTEX_ARTICLE_FINDING_LIMIT,
    ).fill(finding),
  };
  expect(() =>
    decodeCortexArticleResult(JSON.stringify(exactResult)),
  ).not.toThrow();
  const overflowResult = {
    ...exactResult,
    findings: [...exactResult.findings, finding],
  };
  expect(() =>
    decodeCortexArticleResult(JSON.stringify(overflowResult)),
  ).toThrow('Invalid Cortex article-structure result');
});

test('every exact-capacity decoded request executes and self-verifies', async () => {
  const capacityRequest: CapacityRequest = {
    blockCount: 0,
    ledgerEntryCount: CORTEX_ARTICLE_FINDING_LIMIT,
  };
  const exactRequest = requestAtCapacity(capacityRequest);
  const serializedResult = await runCortexArticleStructureSkill(
    encodeCortexArticleRequest(exactRequest),
  );
  expect(decodeCortexArticleResult(serializedResult).findings).toHaveLength(
    CORTEX_ARTICLE_FINDING_LIMIT,
  );
});
