import { expect, setDefaultTimeout, test } from 'bun:test';
import { auditCortexArticleStructure } from '../src/audit.ts';
import {
  decodeCortexArticleRequest,
  decodeCortexArticleResult,
  encodeCortexArticleRequest,
  encodeCortexArticleResult,
} from '../src/codec.ts';
import {
  CortexArticleBlockKind,
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleFindingMessage,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
} from '../src/domain.ts';
import type {
  AuditCortexArticleStructureRequest,
  CortexArticleBlock,
  CortexArticleFinding,
  CortexArticleStructureResult,
} from '../src/domain.ts';

setDefaultTimeout(30_000);

type CapacityRequest = {
  readonly blockCount: number;
  readonly ledgerEntryCount: number;
  readonly ledgerPrefix?: string;
};

function requestAtCapacity(
  request: CapacityRequest,
): AuditCortexArticleStructureRequest {
  const block: CortexArticleBlock = {
    line: 1,
    type: CortexArticleBlockKind.Paragraph,
  };
  const ledgerPrefix = request.ledgerPrefix ?? 'invalid-entry';
  return {
    kind: CortexArticleContractKind.Request,
    documents:
      request.blockCount === 0
        ? []
        : [
            {
              relativePath: '.cortex/escaped-"😀".md',
              blocks: new Array<CortexArticleBlock>(request.blockCount).fill(
                block,
              ),
            },
          ],
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration-"😀".txt',
      content:
        request.ledgerEntryCount === 0
          ? false
          : new Array<string>(request.ledgerEntryCount)
              .fill(ledgerPrefix)
              .join('\n'),
    },
  };
}

function requestAtSerializedBytes(
  maximumBytes: number,
): AuditCortexArticleStructureRequest {
  const prefix = '# escaped " quote \\ and 😀';
  const baseCapacity: CapacityRequest = {
    blockCount: 0,
    ledgerEntryCount: 1,
    ledgerPrefix: prefix,
  };
  const baseRequest = requestAtCapacity(baseCapacity);
  const baseBytes = Buffer.byteLength(JSON.stringify(baseRequest), 'utf8');
  const boundedCapacity: CapacityRequest = {
    blockCount: 0,
    ledgerEntryCount: 1,
    ledgerPrefix: prefix + 'x'.repeat(maximumBytes - baseBytes),
  };
  return requestAtCapacity(boundedCapacity);
}

function resultAtSerializedLimit(): CortexArticleStructureResult {
  const finding: CortexArticleFinding = {
    code: CortexArticleFindingCode.InvalidMigrationLedger,
    file: '.cortex/article-structure-migration-"😀".txt',
    line: Number.MAX_SAFE_INTEGER,
    message: CortexArticleFindingMessage.UncatalogedMigrationEntry,
  };
  const emptyResult: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings: [],
  };
  const emptyBytes = Buffer.byteLength(JSON.stringify(emptyResult), 'utf8');
  const findingBytes = Buffer.byteLength(JSON.stringify(finding), 'utf8');
  const count = Math.floor(
    (CORTEX_ARTICLE_RESULT_BYTE_LIMIT - emptyBytes + 1) / (findingBytes + 1),
  );
  const findings = new Array<CortexArticleFinding>(count).fill(finding);
  const draft: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings,
  };
  const draftBytes = Buffer.byteLength(JSON.stringify(draft), 'utf8');
  const remaining = CORTEX_ARTICLE_RESULT_BYTE_LIMIT - draftBytes;
  const lastFinding = findings.at(-1);
  if (!lastFinding || remaining < 0) {
    throw new Error('Cortex article result boundary fixture is invalid.');
  }
  const adjustedFinding: CortexArticleFinding = {
    ...lastFinding,
    message: lastFinding.message + 'x'.repeat(remaining),
  };
  return {
    kind: CortexArticleContractKind.Result,
    findings: [...findings.slice(0, -1), adjustedFinding],
  };
}

function requestIsAccepted(
  request: AuditCortexArticleStructureRequest,
): boolean {
  try {
    decodeCortexArticleRequest(JSON.stringify(request));
    return true;
  } catch {
    return false;
  }
}

function maximumAcceptedMixedCount(): number {
  let accepted = 0;
  let rejected = 10_000;
  while (accepted + 1 < rejected) {
    const candidate = Math.floor((accepted + rejected) / 2);
    const capacityRequest: CapacityRequest = {
      blockCount: candidate,
      ledgerEntryCount: candidate,
    };
    const request = requestAtCapacity(capacityRequest);
    if (requestIsAccepted(request)) accepted = candidate;
    else rejected = candidate;
  }
  return accepted;
}

test('enforces exact UTF-8 request bytes including escaping and multibyte text', () => {
  const exactRequest = requestAtSerializedBytes(
    CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  );
  const exactSerialized = JSON.stringify(exactRequest);
  expect(Buffer.byteLength(exactSerialized, 'utf8')).toBe(
    CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  );
  expect(encodeCortexArticleRequest(exactRequest)).toBe(exactSerialized);
  expect(() => decodeCortexArticleRequest(exactSerialized)).not.toThrow();

  const overflowRequest = requestAtSerializedBytes(
    CORTEX_ARTICLE_REQUEST_BYTE_LIMIT + 1,
  );
  const overflowSerialized = JSON.stringify(overflowRequest);
  expect(Buffer.byteLength(overflowSerialized, 'utf8')).toBe(
    CORTEX_ARTICLE_REQUEST_BYTE_LIMIT + 1,
  );
  expect(() => encodeCortexArticleRequest(overflowRequest)).toThrow(
    'request exceeds its byte bound',
  );
  expect(() => decodeCortexArticleRequest(overflowSerialized)).toThrow(
    'request exceeds its byte bound',
  );
});

test('enforces exact UTF-8 result bytes at encode and decode boundaries', () => {
  const exactResult = resultAtSerializedLimit();
  const exactSerialized = JSON.stringify(exactResult);
  expect(Buffer.byteLength(exactSerialized, 'utf8')).toBe(
    CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  );
  expect(encodeCortexArticleResult(exactResult)).toBe(exactSerialized);
  expect(() => decodeCortexArticleResult(exactSerialized)).not.toThrow();

  const lastFinding = exactResult.findings.at(-1);
  if (!lastFinding) throw new Error('Cortex article result fixture is empty.');
  const overflowFinding: CortexArticleFinding = {
    ...lastFinding,
    message: `${lastFinding.message}x`,
  };
  const overflowResult: CortexArticleStructureResult = {
    ...exactResult,
    findings: [...exactResult.findings.slice(0, -1), overflowFinding],
  };
  expect(() => encodeCortexArticleResult(overflowResult)).toThrow(
    'result exceeds its byte bound',
  );
  expect(() =>
    decodeCortexArticleResult(JSON.stringify(overflowResult)),
  ).toThrow('result exceeds its byte bound');
});

test('budgets mixed block and ledger findings before execution', () => {
  const exactCount = maximumAcceptedMixedCount();
  const exactCapacity: CapacityRequest = {
    blockCount: exactCount,
    ledgerEntryCount: exactCount,
  };
  const exactRequest = requestAtCapacity(exactCapacity);
  expect(exactCount).toBeGreaterThan(0);
  expect(() =>
    decodeCortexArticleRequest(JSON.stringify(exactRequest)),
  ).not.toThrow();

  const overflowCapacity: CapacityRequest = {
    blockCount: exactCount,
    ledgerEntryCount: exactCount + 1,
  };
  const overflowRequest = requestAtCapacity(overflowCapacity);
  expect(() =>
    decodeCortexArticleRequest(JSON.stringify(overflowRequest)),
  ).toThrow('request result budget exceeds its bound');
});

test('every accepted high-capacity request completes below result bytes', () => {
  const capacityRequest: CapacityRequest = {
    blockCount: 0,
    ledgerEntryCount: 4_000,
  };
  const request = requestAtCapacity(capacityRequest);
  const serializedRequest = encodeCortexArticleRequest(request);
  const decodedRequest = decodeCortexArticleRequest(serializedRequest);
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings: auditCortexArticleStructure(decodedRequest),
  };
  const serializedResult = encodeCortexArticleResult(result);
  expect(Buffer.byteLength(serializedResult, 'utf8')).toBeLessThanOrEqual(
    CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  );
  expect(decodeCortexArticleResult(serializedResult).findings).toHaveLength(
    4_000,
  );
});
