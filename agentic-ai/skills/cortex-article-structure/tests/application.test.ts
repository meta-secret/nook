import { expect, test } from 'bun:test';
import {
  acceptCortexArticleStructureResult,
  executeCortexArticleStructureApplication,
  type AcceptCortexArticleStructureResultRequest,
} from '../src/application.ts';
import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleFinding,
  type CortexArticleStructureResult,
} from '../src/domain.ts';

const AUDIT_REQUEST: AuditCortexArticleStructureRequest = {
  kind: CortexArticleContractKind.Request,
  documents: [
    {
      relativePath: '.cortex/first.md',
      blocks: [
        {
          depth: 2,
          kind: CortexArticleSemanticKind.Heading,
          line: 1,
          text: 'First empty article',
        },
      ],
    },
    {
      relativePath: '.cortex/second.md',
      blocks: [
        {
          depth: 2,
          kind: CortexArticleSemanticKind.Heading,
          line: 3,
          text: 'Second empty article',
        },
      ],
    },
  ],
  migrationBaselineEntries: false,
  migrationLedger: {
    relativePath: '.cortex/article-structure-migration.txt',
    content: false,
  },
};

function resultWith(
  findings: readonly CortexArticleFinding[],
): CortexArticleStructureResult {
  return { kind: CortexArticleContractKind.Result, findings };
}

function expectApplicationRejection(
  result: CortexArticleStructureResult,
): void {
  const acceptanceRequest: AcceptCortexArticleStructureResultRequest = {
    auditRequest: AUDIT_REQUEST,
    result,
  };
  expect(() => acceptCortexArticleStructureResult(acceptanceRequest)).toThrow(
    'semantic verification failed',
  );
}

test('validates, audits, verifies, and bounds the accepted application result', () => {
  const result = executeCortexArticleStructureApplication(AUDIT_REQUEST);
  expect(result.findings).toHaveLength(2);
  expect(result.findings.map((finding) => finding.code)).toEqual([
    CortexArticleFindingCode.EmptyArticle,
    CortexArticleFindingCode.EmptyArticle,
  ]);
});

test('production acceptance rejects reordered, duplicated, and mutated results', () => {
  const result = executeCortexArticleStructureApplication(AUDIT_REQUEST);
  const first = result.findings.at(0);
  const second = result.findings.at(1);
  if (!first || !second) throw new Error('Expected two application findings.');

  expectApplicationRejection(resultWith([second, first]));
  expectApplicationRejection(resultWith([first, second, second]));
  expectApplicationRejection(
    resultWith([{ ...first, line: first.line + 1 }, second]),
  );
});
