import type {
  AnalyzeExecutableSkillSourceRequest,
  ExecutableSkillSourceAnalysis,
} from './source-policy.ts';

export const MAXIMUM_SEALED_SOURCE_BYTES = 1024 * 1024;
const MAXIMUM_SOURCE_PATH_BYTES = 4096;
export const MAXIMUM_SOURCE_ANALYSIS_STDIN_BYTES =
  MAXIMUM_SEALED_SOURCE_BYTES * 6 + MAXIMUM_SOURCE_PATH_BYTES * 6 + 8192;
export const MAXIMUM_SOURCE_ANALYSIS_STDERR_BYTES = 32 * 1024;
const MAXIMUM_MODULE_SPECIFIERS = 256;
const MAXIMUM_MODULE_SPECIFIER_BYTES = 4096;
export const MAXIMUM_SOURCE_ANALYSIS_STDOUT_BYTES =
  MAXIMUM_MODULE_SPECIFIERS * (MAXIMUM_MODULE_SPECIFIER_BYTES * 6 + 3) + 8192;
const MAXIMUM_FAILURE_MESSAGE_BYTES = 4096;

export enum SourceAnalysisTransportKind {
  Completed = 'completed',
  Failed = 'failed',
}

type SourceAnalysisRequestTransport = {
  readonly relativePath: string | false;
  readonly source: string | false;
};

type SourceAnalysisResultTransport =
  | {
      readonly kind: SourceAnalysisTransportKind.Completed;
      readonly moduleSpecifiers: readonly string[];
    }
  | {
      readonly kind: SourceAnalysisTransportKind.Failed;
      readonly message: string;
    };

type SourceAnalysisDecoderConfiguration = {
  readonly fatal: boolean;
};

export function encodeSourceAnalysisRequest(
  request: AnalyzeExecutableSkillSourceRequest,
): string {
  assertSourceAnalysisRequestBounds(request);
  const transport: SourceAnalysisRequestTransport = {
    relativePath: request.relativePath,
    source: request.source,
  };
  const serialized = JSON.stringify(transport);
  if (utf8ByteLength(serialized) > MAXIMUM_SOURCE_ANALYSIS_STDIN_BYTES) {
    throw new Error('Sealed source analysis request exceeds its byte bound.');
  }
  return serialized;
}

export function decodeSourceAnalysisRequest(
  serialized: string,
): AnalyzeExecutableSkillSourceRequest {
  let transport: SourceAnalysisRequestTransport;
  try {
    transport = JSON.parse(serialized) as SourceAnalysisRequestTransport;
  } catch {
    throw new Error('Sealed source analysis request is malformed.');
  }
  if (
    !transport ||
    typeof transport !== 'object' ||
    Object.keys(transport).length !== 2 ||
    !Object.hasOwn(transport, 'relativePath') ||
    !Object.hasOwn(transport, 'source') ||
    typeof transport.relativePath !== 'string' ||
    typeof transport.source !== 'string'
  ) {
    throw new Error('Sealed source analysis request is malformed.');
  }
  const request: AnalyzeExecutableSkillSourceRequest = {
    relativePath: transport.relativePath,
    source: transport.source,
  };
  assertSourceAnalysisRequestBounds(request);
  return request;
}

export function encodeSourceAnalysisResult(
  analysis: ExecutableSkillSourceAnalysis,
): string {
  const transport: SourceAnalysisResultTransport = {
    kind: SourceAnalysisTransportKind.Completed,
    moduleSpecifiers: analysis.moduleSpecifiers,
  };
  const serialized = JSON.stringify(transport);
  if (utf8ByteLength(serialized) > MAXIMUM_SOURCE_ANALYSIS_STDOUT_BYTES) {
    throw new Error('Sealed source analysis result exceeds its byte bound.');
  }
  return serialized;
}

export function encodeSourceAnalysisFailure(error: Error): string {
  const message = boundedFailureMessage(error.message);
  const transport: SourceAnalysisResultTransport = {
    kind: SourceAnalysisTransportKind.Failed,
    message,
  };
  return JSON.stringify(transport);
}

export function decodeSourceAnalysisResult(
  serialized: string,
): ExecutableSkillSourceAnalysis {
  if (utf8ByteLength(serialized) > MAXIMUM_SOURCE_ANALYSIS_STDOUT_BYTES) {
    throw new Error('Sealed source analysis result exceeds its byte bound.');
  }
  let transport: SourceAnalysisResultTransport;
  try {
    transport = JSON.parse(serialized) as SourceAnalysisResultTransport;
  } catch {
    throw new Error('Sealed source analysis result is malformed.');
  }
  if (
    !transport ||
    typeof transport !== 'object' ||
    Object.keys(transport).length !== 2 ||
    typeof transport.kind !== 'string'
  ) {
    throw new Error('Sealed source analysis result is malformed.');
  }
  if (transport.kind === SourceAnalysisTransportKind.Failed) {
    if (
      !Object.hasOwn(transport, 'message') ||
      typeof transport.message !== 'string' ||
      transport.message.length === 0 ||
      utf8ByteLength(transport.message) > MAXIMUM_FAILURE_MESSAGE_BYTES
    ) {
      throw new Error('Sealed source analysis failure is malformed.');
    }
    throw new Error(transport.message);
  }
  if (
    transport.kind !== SourceAnalysisTransportKind.Completed ||
    !Object.hasOwn(transport, 'moduleSpecifiers') ||
    !Array.isArray(transport.moduleSpecifiers) ||
    transport.moduleSpecifiers.length > MAXIMUM_MODULE_SPECIFIERS ||
    transport.moduleSpecifiers.some(
      (specifier) =>
        typeof specifier !== 'string' ||
        utf8ByteLength(specifier) > MAXIMUM_MODULE_SPECIFIER_BYTES,
    )
  ) {
    throw new Error('Sealed source analysis result is malformed.');
  }
  const analysis: ExecutableSkillSourceAnalysis = {
    moduleSpecifiers: Object.freeze([...transport.moduleSpecifiers]),
  };
  return Object.freeze(analysis);
}

export function assertSourceAnalysisRequestBounds(
  request: AnalyzeExecutableSkillSourceRequest,
): void {
  if (
    request.source.length > MAXIMUM_SEALED_SOURCE_BYTES ||
    utf8ByteLength(request.source) > MAXIMUM_SEALED_SOURCE_BYTES
  ) {
    throw new Error('Sealed source analysis source exceeds its byte bound.');
  }
  if (
    request.relativePath.length === 0 ||
    request.relativePath.length > MAXIMUM_SOURCE_PATH_BYTES ||
    utf8ByteLength(request.relativePath) > MAXIMUM_SOURCE_PATH_BYTES
  ) {
    throw new Error('Sealed source analysis path exceeds its bound.');
  }
}

function boundedFailureMessage(message: string): string {
  if (message.length === 0) return 'Sealed source analysis failed.';
  const encoded = new TextEncoder().encode(message);
  if (encoded.byteLength <= MAXIMUM_FAILURE_MESSAGE_BYTES) return message;
  const bounded = encoded.slice(0, MAXIMUM_FAILURE_MESSAGE_BYTES);
  const decoderOptions: SourceAnalysisDecoderConfiguration = { fatal: false };
  return new TextDecoder('utf-8', decoderOptions).decode(bounded);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
