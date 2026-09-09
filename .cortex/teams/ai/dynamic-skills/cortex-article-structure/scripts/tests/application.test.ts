import { expect, test } from 'bun:test';

import {
  type AcceptCortexArticleStructureResultRequest,
  CortexArticleApplication,
} from '../src/application.ts';

import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_PATH_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleFinding,
  type CortexArticleStructureResult,
} from '../src/domain.ts';

export class CortexArticleStructureApplicationScenario {
  private constructor(
    private readonly request: readonly CortexArticleFinding[],
  ) {}

  static resultWith(
    findings: readonly CortexArticleFinding[],
  ): CortexArticleStructureResult {
    return new CortexArticleStructureApplicationScenario(findings).execute();
  }

  private execute(): CortexArticleStructureResult {
    const findings = this.request;
    return { kind: CortexArticleContractKind.Result, findings };
  }

  static expectApplicationRejection(
    result: CortexArticleStructureResult,
  ): void {
    const acceptanceRequest: AcceptCortexArticleStructureResultRequest = {
      auditRequest: AUDIT_REQUEST,
      result,
    };
    expect(() =>
      CortexArticleApplication.acceptCortexArticleStructureResult(
        acceptanceRequest,
      ),
    ).toThrow('semantic verification failed');
  }
}

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
};

test('validates, audits, verifies, and bounds the accepted application result', () => {
  const result =
    CortexArticleApplication.executeCortexArticleStructureApplication(
      AUDIT_REQUEST,
    );
  expect(result.findings).toHaveLength(2);
  expect(result.findings.map((finding) => finding.code)).toEqual([
    CortexArticleFindingCode.EmptyArticle,
    CortexArticleFindingCode.EmptyArticle,
  ]);
});

test('returns a bounded table finding for the longest accepted Cortex path', () => {
  const prefix = '.cortex/';
  const suffix = '.md';
  const relativePath = `${prefix}${'x'.repeat(
    CORTEX_ARTICLE_PATH_LIMIT - prefix.length - suffix.length,
  )}${suffix}`;
  const previousUnboundedMessage = `Rendered Markdown table in ${relativePath} is prohibited; use an enclosed structured list.`;
  const request: AuditCortexArticleStructureRequest = {
    kind: CortexArticleContractKind.Request,
    documents: [
      {
        relativePath,
        blocks: [{ kind: CortexArticleSemanticKind.Table, line: 1 }],
      },
    ],
  };

  const result =
    CortexArticleApplication.executeCortexArticleStructureApplication(request);

  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.code).toBe(CortexArticleFindingCode.MarkdownTable);
  expect(result.findings[0]?.file).toBe(relativePath);
  expect(previousUnboundedMessage.length).toBeGreaterThan(
    CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  );
  expect(result.findings[0]?.message.length).toBeLessThanOrEqual(
    CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  );
});

test('production acceptance rejects reordered, duplicated, and mutated results', () => {
  const result =
    CortexArticleApplication.executeCortexArticleStructureApplication(
      AUDIT_REQUEST,
    );
  const first = result.findings.at(0);
  const second = result.findings.at(1);
  if (!first || !second) throw new Error('Expected two application findings.');

  CortexArticleStructureApplicationScenario.expectApplicationRejection(
    CortexArticleStructureApplicationScenario.resultWith([second, first]),
  );
  CortexArticleStructureApplicationScenario.expectApplicationRejection(
    CortexArticleStructureApplicationScenario.resultWith([
      first,
      second,
      second,
    ]),
  );
  CortexArticleStructureApplicationScenario.expectApplicationRejection(
    CortexArticleStructureApplicationScenario.resultWith([
      { ...first, line: first.line + 1 },
      second,
    ]),
  );
});
