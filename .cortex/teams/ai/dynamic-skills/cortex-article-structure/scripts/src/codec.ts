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
  static encodeCortexArticleRequest(
    request: AuditCortexArticleStructureRequest,
  ): string {
    const serialized = JSON.stringify(request);
    CortexArticleTransport.assertSerializedByteLimit({
      label: SerializedCortexArticleContract.Request,
      maximumBytes: CORTEX_ARTICLE_REQUEST_BYTE_LIMIT,
      serialized,
    });
    return serialized;
  }

  static decodeCortexArticleRequest(
    serialized: string,
  ): AuditCortexArticleStructureRequest {
    if (
      UTF8_ENCODER.encode(serialized).byteLength >
      CORTEX_ARTICLE_REQUEST_BYTE_LIMIT
    ) {
      throw new CortexArticleRequestDecodeError({
        kind: CortexArticleRequestFailureKind.RequestBytes,
        path: '',
      });
    }
    let transport: unknown;
    try {
      transport = JSON.parse(serialized);
    } catch {
      throw new CortexArticleRequestDecodeError({
        kind: CortexArticleRequestFailureKind.InvalidRequest,
        path: '',
      });
    }
    const envelope = CORTEX_ARTICLE_REQUEST_ENVELOPE_SCHEMA.safeParse(
      transport,
      { reportInput: true },
    );
    if (!envelope.success) {
      throw new CortexArticleSchemaFailure({
        error: envelope.error,
        kind: CortexArticleRequestFailureKind.InvalidRequest,
        path: '',
      }).error();
    }
    const documents = new CortexArticleDocumentSequence();
    for (const [index, candidate] of envelope.data.documents.entries()) {
      documents.append(
        CortexArticleTransport.decodeDocument({
          path: `documents[${index}]`,
          transport: candidate,
        }),
      );
    }
    const request: AuditCortexArticleStructureRequest = {
      kind: envelope.data.kind,
      documents: documents.values(),
    };
    new CortexArticleRequestCapacity(request).assertWithinBounds();
    return request;
  }

  static encodeCortexArticleResult(
    result: CortexArticleStructureResult,
  ): string {
    const serialized = JSON.stringify(result);
    CortexArticleTransport.assertSerializedByteLimit({
      label: SerializedCortexArticleContract.Result,
      maximumBytes: CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
      serialized,
    });
    return serialized;
  }

  static decodeCortexArticleResult(
    serialized: string,
  ): CortexArticleStructureResult {
    CortexArticleTransport.assertSerializedByteLimit({
      label: SerializedCortexArticleContract.Result,
      maximumBytes: CORTEX_ARTICLE_RESULT_BYTE_LIMIT,
      serialized,
    });
    const transport: unknown = JSON.parse(serialized);
    const envelope = CORTEX_ARTICLE_RESULT_ENVELOPE_SCHEMA.safeParse(transport);
    if (!envelope.success)
      throw new Error('Invalid Cortex article-structure result.');
    return {
      kind: envelope.data.kind,
      findings: envelope.data.findings.map(
        CortexArticleTransport.decodeFinding,
      ),
    };
  }

  private static decodeDocument(
    request: DecodeDocumentRequest,
  ): CortexArticleDocument {
    const envelope = CORTEX_ARTICLE_DOCUMENT_ENVELOPE_SCHEMA.safeParse(
      request.transport,
      { reportInput: true },
    );
    if (!envelope.success) {
      throw new CortexArticleSchemaFailure({
        error: envelope.error,
        kind: CortexArticleRequestFailureKind.InvalidDocument,
        path: request.path,
      }).error();
    }
    const blocks = new CortexArticleBlockSequence(request.path);
    for (const [index, candidate] of envelope.data.blocks.entries()) {
      blocks.append(
        CortexArticleTransport.decodeBlock({
          path: `${request.path}.blocks[${index}]`,
          transport: candidate,
        }),
      );
    }
    return {
      relativePath: envelope.data.relativePath,
      blocks: blocks.values(),
    };
  }

  private static decodeBlock(
    request: DecodeBlockRequest,
  ): CortexArticleSemanticBlock {
    // The legacy contract admits source line before the variant or exact keys.
    const line = CORTEX_ARTICLE_BLOCK_LINE_SCHEMA.safeParse(request.transport);
    if (!line.success) {
      const path = line.error.issues.some((issue) => issue.path.length > 0)
        ? `${request.path}.line`
        : request.path;
      throw new CortexArticleRequestDecodeError({
        kind: CortexArticleRequestFailureKind.InvalidBlock,
        path,
      });
    }
    if (line.data.kind === CortexArticleSemanticKind.Heading) {
      const heading = CORTEX_ARTICLE_HEADING_SCHEMA.safeParse(
        request.transport,
        { reportInput: true },
      );
      if (!heading.success) {
        throw new CortexArticleSchemaFailure({
          error: heading.error,
          kind: CortexArticleRequestFailureKind.InvalidHeading,
          path: request.path,
        }).error();
      }
      return heading.data;
    }
    if (!CORTEX_ARTICLE_SIMPLE_KIND_SCHEMA.safeParse(line.data.kind).success) {
      throw new CortexArticleRequestDecodeError({
        kind: CortexArticleRequestFailureKind.InvalidBlockKind,
        path: `${request.path}.kind`,
      });
    }
    const block = CORTEX_ARTICLE_SIMPLE_BLOCK_SCHEMA.safeParse(
      request.transport,
      { reportInput: true },
    );
    if (!block.success) {
      throw new CortexArticleSchemaFailure({
        error: block.error,
        kind: CortexArticleRequestFailureKind.InvalidBlock,
        path: request.path,
      }).error();
    }
    return block.data;
  }

  private static decodeFinding(transport: unknown): CortexArticleFinding {
    const finding = CORTEX_ARTICLE_FINDING_SCHEMA.safeParse(transport);
    if (!finding.success) throw new Error('Invalid Cortex article finding.');
    new CortexArticleFindingAdmission(finding.data).assertCanonical();
    return finding.data;
  }

  private static assertSerializedByteLimit(
    request: AssertSerializedByteLimitRequest,
  ): void {
    if (
      UTF8_ENCODER.encode(request.serialized).byteLength > request.maximumBytes
    ) {
      throw new Error(
        `Cortex article ${request.label} exceeds its byte bound.`,
      );
    }
  }
}

class CortexArticleDocumentSequence {
  private readonly documents: CortexArticleDocument[] = [];
  private readonly paths = new Set<string>();

  append(document: CortexArticleDocument): void {
    if (this.paths.has(document.relativePath)) {
      throw new CortexArticleRequestDecodeError({
        kind: CortexArticleRequestFailureKind.DuplicateDocument,
        path: `documents[${this.documents.length}].relativePath`,
      });
    }
    this.paths.add(document.relativePath);
    this.documents.push(document);
  }

  values(): readonly CortexArticleDocument[] {
    return this.documents;
  }
}

class CortexArticleBlockSequence {
  private readonly blocks: CortexArticleSemanticBlock[] = [];
  private previousLine = 0;

  constructor(private readonly documentPath: string) {}

  append(block: CortexArticleSemanticBlock): void {
    if (block.line <= this.previousLine) {
      throw new CortexArticleRequestDecodeError({
        kind: CortexArticleRequestFailureKind.NonmonotonicLine,
        path: `${this.documentPath}.blocks[${this.blocks.length}].line`,
      });
    }
    this.previousLine = block.line;
    this.blocks.push(block);
  }

  values(): readonly CortexArticleSemanticBlock[] {
    return this.blocks;
  }
}

type DecodeDocumentRequest = {
  readonly path: string;
  readonly transport: unknown;
};
type DecodeBlockRequest = {
  readonly path: string;
  readonly transport: unknown;
};
type AssertSerializedByteLimitRequest = {
  readonly label: SerializedCortexArticleContract;
  readonly maximumBytes: number;
  readonly serialized: string;
};
enum SerializedCortexArticleContract {
  Request = 'request',
  Result = 'result',
}
const UTF8_ENCODER = new TextEncoder();
