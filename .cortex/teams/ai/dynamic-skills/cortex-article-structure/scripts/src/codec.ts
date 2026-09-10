import { err, ok, type Result } from 'neverthrow';
import type { output as ZodOutput } from 'zod';
import {
  CortexArticleSemanticKind,
  CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
  CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
  type AuditCortexArticleStructureRequest,
  type CortexArticleDocument,
  type CortexArticleFinding,
  type CortexArticleSemanticBlock,
  type CortexArticleStructureResult,
} from './domain.ts';
import {
  CORTEX_ARTICLE_REQUEST_ENVELOPE_SCHEMA,
  CORTEX_ARTICLE_DOCUMENT_ENVELOPE_SCHEMA,
  CORTEX_ARTICLE_RESULT_ENVELOPE_SCHEMA,
  CORTEX_ARTICLE_BLOCK_LINE_SCHEMA,
  CORTEX_ARTICLE_HEADING_SCHEMA,
  CORTEX_ARTICLE_SIMPLE_KIND_SCHEMA,
  CORTEX_ARTICLE_SIMPLE_BLOCK_SCHEMA,
  CORTEX_ARTICLE_FINDING_SCHEMA,
} from './schema.ts';
import {
  CortexArticleRequestDecodeError,
  CortexArticleRequestFailureKind,
  CortexArticleSchemaFailure,
} from './decode-error.ts';
import {
  CortexArticleRequestCapacity,
  CortexArticleFindingAdmission,
} from './admission.ts';

export { CortexArticleRequestDecodeError } from './decode-error.ts';

export class CortexArticleTransport {
  private constructor(private readonly serialized: string) {}

  static from(serialized: string): CortexArticleTransport {
    return new CortexArticleTransport(serialized);
  }

  decodeRequest(): Result<
    AuditCortexArticleStructureRequest,
    CortexArticleRequestDecodeError
  > {
    const serialized = this.serialized;
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_ARTICLE_REQUEST_BYTE_LIMIT
    ) {
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.RequestBytes,
          path: '',
        }),
      );
    }
    let envelope: ReturnType<
      typeof CORTEX_ARTICLE_REQUEST_ENVELOPE_SCHEMA.safeParse
    >;
    try {
      envelope = CORTEX_ARTICLE_REQUEST_ENVELOPE_SCHEMA.safeParse(
        JSON.parse(serialized),
        { reportInput: true },
      );
    } catch {
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.InvalidRequest,
          path: '',
        }),
      );
    }
    if (!envelope.success) {
      return err(
        new CortexArticleSchemaFailure({
          error: envelope.error,
          kind: CortexArticleRequestFailureKind.InvalidRequest,
          path: '',
        }).error(),
      );
    }
    let documents = new CortexArticleDocumentSequence();
    for (const [index, candidate] of envelope.data.documents.entries()) {
      const document = this.decodeDocument({
        path: `documents[${index}]`,
        transport: candidate,
      });
      if (document.isErr()) return err(document.error);
      const appended = documents.append(document.value);
      if (appended.isErr()) return err(appended.error);
      documents = appended.value;
    }
    const request: AuditCortexArticleStructureRequest = {
      kind: envelope.data.kind,
      documents: documents.values(),
    };
    return new CortexArticleRequestCapacity(request).admit().map(() => request);
  }

  decodeResult(): Result<
    CortexArticleStructureResult,
    CortexArticleRequestDecodeError
  > {
    const serialized = this.serialized;
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_ARTICLE_RESULT_BYTE_LIMIT
    ) {
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.ResultBytes,
          path: '',
        }),
      );
    }
    let envelope: ReturnType<
      typeof CORTEX_ARTICLE_RESULT_ENVELOPE_SCHEMA.safeParse
    >;
    try {
      envelope = CORTEX_ARTICLE_RESULT_ENVELOPE_SCHEMA.safeParse(
        JSON.parse(serialized),
      );
    } catch {
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.InvalidResult,
          path: '',
        }),
      );
    }
    if (!envelope.success)
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.InvalidResult,
          path: '',
        }),
      );
    const findings: CortexArticleFinding[] = [];
    for (const transport of envelope.data.findings) {
      const finding = this.decodeFinding(transport);
      if (finding.isErr()) return err(finding.error);
      findings.push(finding.value);
    }
    return ok({ kind: envelope.data.kind, findings });
  }

  private decodeDocument(
    request: DecodeDocumentRequest,
  ): Result<CortexArticleDocument, CortexArticleRequestDecodeError> {
    const envelope = CORTEX_ARTICLE_DOCUMENT_ENVELOPE_SCHEMA.safeParse(
      request.transport,
      { reportInput: true },
    );
    if (!envelope.success) {
      return err(
        new CortexArticleSchemaFailure({
          error: envelope.error,
          kind: CortexArticleRequestFailureKind.InvalidDocument,
          path: request.path,
        }).error(),
      );
    }
    let blocks = new CortexArticleBlockSequence({
      documentPath: request.path,
      blocks: [],
    });
    for (const [index, candidate] of envelope.data.blocks.entries()) {
      const block = this.decodeBlock({
        path: `${request.path}.blocks[${index}]`,
        transport: candidate,
      });
      if (block.isErr()) return err(block.error);
      const appended = blocks.append(block.value);
      if (appended.isErr()) return err(appended.error);
      blocks = appended.value;
    }
    return ok({
      relativePath: envelope.data.relativePath,
      blocks: blocks.values(),
    });
  }

  private decodeBlock(
    request: DecodeBlockRequest,
  ): Result<CortexArticleSemanticBlock, CortexArticleRequestDecodeError> {
    // The legacy contract admits source line before the variant or exact keys.
    const line = CORTEX_ARTICLE_BLOCK_LINE_SCHEMA.safeParse(request.transport);
    if (!line.success) {
      const path = line.error.issues.some((issue) => issue.path.length > 0)
        ? `${request.path}.line`
        : request.path;
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.InvalidBlock,
          path,
        }),
      );
    }
    if (line.data.kind === CortexArticleSemanticKind.Heading) {
      const heading = CORTEX_ARTICLE_HEADING_SCHEMA.safeParse(
        request.transport,
        { reportInput: true },
      );
      if (!heading.success) {
        return err(
          new CortexArticleSchemaFailure({
            error: heading.error,
            kind: CortexArticleRequestFailureKind.InvalidHeading,
            path: request.path,
          }).error(),
        );
      }
      return ok(heading.data);
    }
    if (!CORTEX_ARTICLE_SIMPLE_KIND_SCHEMA.safeParse(line.data.kind).success) {
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.InvalidBlockKind,
          path: `${request.path}.kind`,
        }),
      );
    }
    const block = CORTEX_ARTICLE_SIMPLE_BLOCK_SCHEMA.safeParse(
      request.transport,
      { reportInput: true },
    );
    if (!block.success) {
      return err(
        new CortexArticleSchemaFailure({
          error: block.error,
          kind: CortexArticleRequestFailureKind.InvalidBlock,
          path: request.path,
        }).error(),
      );
    }
    return ok(block.data);
  }

  private decodeFinding(
    transport: CortexArticleFindingTransport,
  ): Result<CortexArticleFinding, CortexArticleRequestDecodeError> {
    const finding = CORTEX_ARTICLE_FINDING_SCHEMA.safeParse(transport);
    if (!finding.success)
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.InvalidFinding,
          path: '',
        }),
      );
    return new CortexArticleFindingAdmission(finding.data)
      .admit()
      .map(() => finding.data);
  }
}

class CortexArticleDocumentSequence {
  constructor(
    private readonly documents: readonly CortexArticleDocument[] = [],
  ) {}

  append(
    document: CortexArticleDocument,
  ): Result<CortexArticleDocumentSequence, CortexArticleRequestDecodeError> {
    if (
      this.documents.some(
        (existing) => existing.relativePath === document.relativePath,
      )
    ) {
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.DuplicateDocument,
          path: `documents[${this.documents.length}].relativePath`,
        }),
      );
    }
    return ok(new CortexArticleDocumentSequence([...this.documents, document]));
  }

  values(): readonly CortexArticleDocument[] {
    return this.documents;
  }
}

class CortexArticleBlockSequence {
  constructor(private readonly request: CortexArticleBlockSequenceRequest) {}

  append(
    block: CortexArticleSemanticBlock,
  ): Result<CortexArticleBlockSequence, CortexArticleRequestDecodeError> {
    const previousLine =
      this.request.blocks.length > 0
        ? this.request.blocks[this.request.blocks.length - 1]!.line
        : 0;
    if (block.line <= previousLine) {
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.NonmonotonicLine,
          path: `${this.request.documentPath}.blocks[${this.request.blocks.length}].line`,
        }),
      );
    }
    return ok(
      new CortexArticleBlockSequence({
        documentPath: this.request.documentPath,
        blocks: [...this.request.blocks, block],
      }),
    );
  }

  values(): readonly CortexArticleSemanticBlock[] {
    return this.request.blocks;
  }
}

type DecodeDocumentRequest = {
  readonly path: string;
  readonly transport: CortexArticleDocumentTransport;
};
type DecodeBlockRequest = {
  readonly path: string;
  readonly transport: CortexArticleBlockTransport;
};
type CortexArticleDocumentTransport = ZodOutput<
  typeof CORTEX_ARTICLE_REQUEST_ENVELOPE_SCHEMA
>['documents'][number];
type CortexArticleBlockTransport = ZodOutput<
  typeof CORTEX_ARTICLE_DOCUMENT_ENVELOPE_SCHEMA
>['blocks'][number];
type CortexArticleFindingTransport = ZodOutput<
  typeof CORTEX_ARTICLE_RESULT_ENVELOPE_SCHEMA
>['findings'][number];
type CortexArticleBlockSequenceRequest = {
  readonly documentPath: string;
  readonly blocks: readonly CortexArticleSemanticBlock[];
};
const UTF8_ENCODER = new TextEncoder();

export class CortexArticleRequestEncoding {
  constructor(private readonly request: AuditCortexArticleStructureRequest) {}
  execute(): Result<string, CortexArticleRequestDecodeError> {
    let serialized: string;
    try {
      serialized = JSON.stringify(this.request);
    } catch {
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.InvalidRequest,
          path: '',
        }),
      );
    }
    return UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_ARTICLE_REQUEST_BYTE_LIMIT
      ? err(
          new CortexArticleRequestDecodeError({
            kind: CortexArticleRequestFailureKind.RequestBytes,
            path: '',
          }),
        )
      : ok(serialized);
  }
}

export class CortexArticleResultEncoding {
  constructor(private readonly result: CortexArticleStructureResult) {}
  execute(): Result<string, CortexArticleRequestDecodeError> {
    let serialized: string;
    try {
      serialized = JSON.stringify(this.result);
    } catch {
      return err(
        new CortexArticleRequestDecodeError({
          kind: CortexArticleRequestFailureKind.InvalidResult,
          path: '',
        }),
      );
    }
    return UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_ARTICLE_RESULT_BYTE_LIMIT
      ? err(
          new CortexArticleRequestDecodeError({
            kind: CortexArticleRequestFailureKind.ResultBytes,
            path: '',
          }),
        )
      : ok(serialized);
  }
}
