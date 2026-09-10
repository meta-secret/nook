import { ok } from 'neverthrow';
import { CortexArticleResultEncoding } from '../src/codec.ts';
import { CortexArticleRequestEncoding } from '../src/codec.ts';
import { expect, test } from 'bun:test';

import {
  CortexArticleRequestDecodeError,
  CortexArticleTransport,
} from '../src/codec.ts';

import {
  CortexArticleContractKind,
  CortexArticleFindingCode,
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_DETAIL_TEXT_LIMIT,
  CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT,
  CORTEX_ARTICLE_PATH_LIMIT,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleSemanticBlock,
  type CortexArticleStructureResult,
} from '../src/domain.ts';

export class CortexArticleStructureCodecScenario {
  private constructor(private readonly request: string) {}

  static requestFailurePath(serializedRequest: string): string {
    return new CortexArticleStructureCodecScenario(serializedRequest).execute();
  }

  private execute(): string {
    const serializedRequest = this.request;
    const decoded =
      CortexArticleTransport.from(serializedRequest).decodeRequest();
    expect(decoded.isErr()).toBe(true);
    return decoded.match(
      () => '',
      (failure) => failure.path,
    );
  }
}

type RequestWithWrites = AuditCortexArticleStructureRequest & {
  readonly allowWrites: boolean;
};

type ResultWithExtra = CortexArticleStructureResult & {
  readonly extra: boolean;
};

const validRequest: AuditCortexArticleStructureRequest = {
  kind: CortexArticleContractKind.Request,
  documents: [
    {
      relativePath: '.cortex/example.md',
      blocks: [
        {
          depth: 2,
          kind: CortexArticleSemanticKind.Heading,
          line: 1,
          text: 'Example',
        },
        { kind: CortexArticleSemanticKind.Paragraph, line: 3 },
        { kind: CortexArticleSemanticKind.VisibleOrderedList, line: 5 },
        { kind: CortexArticleSemanticKind.Structure, line: 7 },
        { kind: CortexArticleSemanticKind.Transparent, line: 9 },
        { kind: CortexArticleSemanticKind.DensitySeparator, line: 11 },
        { kind: CortexArticleSemanticKind.Table, line: 13 },
      ],
    },
  ],
};

const validResult: CortexArticleStructureResult = {
  kind: CortexArticleContractKind.Result,
  findings: [
    {
      code: CortexArticleFindingCode.EmptyArticle,
      file: '.cortex/example.md',
      line: 1,
      message: 'Article #Example has no body content.',
    },
  ],
};

test('round-trips exact semantic requests and findings', () => {
  expect(
    new CortexArticleRequestEncoding(validRequest)
      .execute()
      .andThen((serialized) =>
        CortexArticleTransport.from(serialized).decodeRequest(),
      ),
  ).toEqual(ok(validRequest));
  expect(
    new CortexArticleResultEncoding(validResult)
      .execute()
      .andThen((serialized) =>
        CortexArticleTransport.from(serialized).decodeResult(),
      ),
  ).toEqual(ok(validResult));
});

test('accepts active diagnostics for every finding code', () => {
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings: [
      {
        code: CortexArticleFindingCode.EmptyArticle,
        file: '.cortex/example.md',
        line: 1,
        message: 'Article #Example has no body content.',
      },
      {
        code: CortexArticleFindingCode.DenseArticle,
        file: '.cortex/example.md',
        line: 3,
        message:
          'Article #Example has more than 3 consecutive prose blocks without visible structure.',
      },
      {
        code: CortexArticleFindingCode.MarkdownTable,
        file: '.cortex/example.md',
        line: 4,
        message:
          'Rendered Markdown table in .cortex/example.md is prohibited; use an enclosed structured list.',
      },
      {
        code: CortexArticleFindingCode.UnorderedProcedure,
        file: '.cortex/example.md',
        line: 5,
        message:
          'Procedure-like article #Recovery procedure must expose its action sequence as an ordered list.',
      },
    ],
  };
  expect(
    CortexArticleTransport.from(JSON.stringify(result)).decodeResult(),
  ).toEqual(ok(result));
});

test('rejects malformed envelopes and extra fields', () => {
  const requestWithWrites: RequestWithWrites = {
    ...validRequest,
    allowWrites: true,
  };
  const wrongKindRequestOutcome = new CortexArticleRequestEncoding(validRequest)
    .execute()
    .map((serialized) =>
      serialized.replace(CortexArticleContractKind.Request, 'wrong'),
    );
  expect(wrongKindRequestOutcome.isOk()).toBe(true);
  if (wrongKindRequestOutcome.isErr()) return;
  const wrongKindRequest = wrongKindRequestOutcome.value;
  const invalidRequests = [
    '{}',
    'null',
    JSON.stringify(requestWithWrites),
    wrongKindRequest,
  ];
  for (const serialized of invalidRequests) {
    expect(
      CortexArticleTransport.from(serialized).decodeRequest().isErr(),
    ).toBe(true);
  }
  expect(
    CortexArticleStructureCodecScenario.requestFailurePath(
      JSON.stringify(requestWithWrites),
    ),
  ).toBe('["<unknown-key>"]');
  const resultWithExtra: ResultWithExtra = { ...validResult, extra: true };
  const invalidResults = ['{}', 'null', JSON.stringify(resultWithExtra)];
  for (const serialized of invalidResults) {
    expect(CortexArticleTransport.from(serialized).decodeResult().isErr()).toBe(
      true,
    );
  }
});

test('accepts only canonical semantic block shapes', () => {
  const invalidBlocks = [
    { kind: 'heading', line: 1, text: 'Missing depth' },
    { kind: 'heading', depth: 0, line: 1, text: 'Invalid depth' },
    { kind: 'paragraph', line: 0 },
    { kind: 'paragraph', line: 1, extra: true },
    { kind: 'visible-ordered-list', line: 1, ordered: true },
    { kind: 'html', line: 1, comment: true },
    { kind: 'definition', line: 1 },
    { kind: 'separator', line: 1 },
  ];
  for (const semanticBlock of invalidBlocks) {
    const document = {
      ...validRequest.documents[0],
      blocks: [semanticBlock],
    };
    const request = { ...validRequest, documents: [document] };
    expect(
      CortexArticleTransport.from(JSON.stringify(request))
        .decodeRequest()
        .isErr(),
    ).toBe(true);
  }
});

test('rejects duplicate documents and nonmonotonic source lines', () => {
  const duplicateRequest = {
    ...validRequest,
    documents: [validRequest.documents[0], validRequest.documents[0]],
  };
  CortexArticleTransport.from(JSON.stringify(duplicateRequest))
    .decodeRequest()
    .match(
      (value) => {
        expect(value).toBeUndefined();
      },
      (outcome) => {
        expect(outcome).toHaveProperty(
          'message',
          'Duplicate Cortex article document path.',
        );
      },
    );
  expect(
    CortexArticleStructureCodecScenario.requestFailurePath(
      JSON.stringify(duplicateRequest),
    ),
  ).toBe('documents[1].relativePath');

  const outOfOrderDocument = {
    ...validRequest.documents[0],
    blocks: [
      { kind: CortexArticleSemanticKind.Paragraph, line: 2 },
      { kind: CortexArticleSemanticKind.Structure, line: 1 },
    ],
  };
  const outOfOrderRequest = {
    ...validRequest,
    documents: [outOfOrderDocument],
  };
  CortexArticleTransport.from(JSON.stringify(outOfOrderRequest))
    .decodeRequest()
    .match(
      (value) => {
        expect(value).toBeUndefined();
      },
      (outcome) => {
        expect(outcome).toHaveProperty(
          'message',
          'Cortex article block lines must be strictly ordered.',
        );
      },
    );
  expect(
    CortexArticleStructureCodecScenario.requestFailurePath(
      JSON.stringify(outOfOrderRequest),
    ),
  ).toBe('documents[0].blocks[1].line');
});

test('bounds heading diagnostic details', () => {
  const boundaryHeading = {
    depth: 2,
    kind: CortexArticleSemanticKind.Heading,
    line: 1,
    text: 'x'.repeat(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT),
  };
  const boundaryDocument = {
    ...validRequest.documents[0],
    blocks: [boundaryHeading],
  };
  const boundaryRequest = {
    ...validRequest,
    documents: [boundaryDocument],
  };
  expect(
    CortexArticleTransport.from(JSON.stringify(boundaryRequest))
      .decodeRequest()
      .isOk(),
  ).toBe(true);

  const overflowHeading = {
    ...boundaryHeading,
    text: 'x'.repeat(CORTEX_ARTICLE_DETAIL_TEXT_LIMIT + 1),
  };
  const overflowDocument = { ...boundaryDocument, blocks: [overflowHeading] };
  const overflowHeadingRequest = {
    ...validRequest,
    documents: [overflowDocument],
  };
  CortexArticleTransport.from(JSON.stringify(overflowHeadingRequest))
    .decodeRequest()
    .match(
      (value) => {
        expect(value).toBeUndefined();
      },
      (outcome) => {
        expect(outcome).toHaveProperty(
          'message',
          'Invalid Cortex article heading block.',
        );
      },
    );
});

test('bounds paths, source lines, codes, and finding messages', () => {
  const invalidFindings = [
    { ...validResult.findings[0], code: 'not-a-code' },
    { ...validResult.findings[0], file: '../escape.md' },
    { ...validResult.findings[0], file: 'README.md' },
    { ...validResult.findings[0], line: 0 },
    { ...validResult.findings[0], message: '' },
    { ...validResult.findings[0], message: 'Generic provider-only message.' },
    {
      ...validResult.findings[0],
      code: CortexArticleFindingCode.DenseArticle,
      message: 'Article #Example has no body content.',
    },
    {
      ...validResult.findings[0],
      message: 'x'.repeat(CORTEX_ARTICLE_FINDING_MESSAGE_LIMIT + 1),
    },
  ];
  for (const finding of invalidFindings) {
    const result = {
      kind: CortexArticleContractKind.Result,
      findings: [finding],
    };
    expect(
      CortexArticleTransport.from(JSON.stringify(result))
        .decodeResult()
        .isErr(),
    ).toBe(true);
  }
  const longPath = `.cortex/${'x'.repeat(CORTEX_ARTICLE_PATH_LIMIT)}.md`;
  const longPathDocument = {
    ...validRequest.documents[0],
    relativePath: longPath,
  };
  const longPathRequest = {
    ...validRequest,
    documents: [longPathDocument],
  };
  CortexArticleTransport.from(JSON.stringify(longPathRequest))
    .decodeRequest()
    .match(
      (value) => {
        expect(value).toBeUndefined();
      },
      (outcome) => {
        expect(outcome).toHaveProperty(
          'message',
          'Invalid Cortex article document.',
        );
      },
    );
});

test('rejects control characters in request and result paths', () => {
  const controls = ['\n', '\t', '\u001b', '\u0001', '\u007f'];
  for (const control of controls) {
    const relativePath = `.cortex/exam${control}ple.md`;
    const document = { ...validRequest.documents[0], relativePath };
    const request = { ...validRequest, documents: [document] };
    CortexArticleTransport.from(JSON.stringify(request))
      .decodeRequest()
      .match(
        (value) => {
          expect(value).toBeUndefined();
        },
        (outcome) => {
          expect(outcome).toHaveProperty(
            'message',
            'Invalid Cortex article document.',
          );
        },
      );

    const finding = { ...validResult.findings[0], file: relativePath };
    const result = {
      kind: CortexArticleContractKind.Result,
      findings: [finding],
    };
    CortexArticleTransport.from(JSON.stringify(result))
      .decodeResult()
      .match(
        (value) => {
          expect(value).toBeUndefined();
        },
        (outcome) => {
          expect(outcome).toHaveProperty(
            'message',
            'Invalid Cortex article finding.',
          );
        },
      );
  }
});

test('enforces serialized request and result byte limits', () => {
  const oversizedRequest = 'x'.repeat(CORTEX_ARTICLE_REQUEST_BYTE_LIMIT + 1);
  CortexArticleTransport.from(oversizedRequest)
    .decodeRequest()
    .match(
      (value) => {
        expect(value).toBeUndefined();
      },
      (outcome) => {
        expect(outcome).toHaveProperty(
          'message',
          'Cortex article request exceeds its byte bound.',
        );
      },
    );
  const oversizedResult = 'x'.repeat(CORTEX_ARTICLE_RESULT_BYTE_LIMIT + 1);
  CortexArticleTransport.from(oversizedResult)
    .decodeResult()
    .match(
      (value) => {
        expect(value).toBeUndefined();
      },
      (outcome) => {
        expect(outcome).toHaveProperty(
          'message',
          'Cortex article result exceeds its byte bound.',
        );
      },
    );
});

test('rejects requests whose possible findings exceed result capacity', () => {
  const blocks: CortexArticleSemanticBlock[] = [];
  for (let index = 0; index < 10_000; index += 1) {
    const headingBlock: CortexArticleSemanticBlock = {
      depth: 2,
      kind: CortexArticleSemanticKind.Heading,
      line: index + 1,
      text: `Procedure ${index}`,
    };
    blocks.push(headingBlock);
  }
  const document = {
    relativePath: '.cortex/capacity.md',
    blocks,
  };
  const request = { ...validRequest, documents: [document] };
  CortexArticleTransport.from(JSON.stringify(request))
    .decodeRequest()
    .match(
      (value) => {
        expect(value).toBeUndefined();
      },
      (outcome) => {
        expect(outcome).toHaveProperty(
          'message',
          'Cortex article request result budget exceeds its bound.',
        );
      },
    );
  expect(
    CortexArticleStructureCodecScenario.requestFailurePath(
      JSON.stringify(request),
    ),
  ).toBe('documents[0].blocks[9999]');
});

test('self-verifies an accepted request through decode, audit, and result decode', async () => {
  const { CortexArticleAudit } = await import('../src/audit.ts');
  const decodedRequestOutcome = new CortexArticleRequestEncoding(validRequest)
    .execute()
    .andThen((serialized) =>
      CortexArticleTransport.from(serialized).decodeRequest(),
    );
  expect(decodedRequestOutcome.isOk()).toBe(true);
  if (decodedRequestOutcome.isErr()) return;
  const decodedRequest = decodedRequestOutcome.value;
  const findings = CortexArticleAudit.from(decodedRequest).execute();
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings,
  };
  expect(
    new CortexArticleResultEncoding(result)
      .execute()
      .andThen((serialized) =>
        CortexArticleTransport.from(serialized).decodeResult(),
      ),
  ).toEqual(ok(result));
});
