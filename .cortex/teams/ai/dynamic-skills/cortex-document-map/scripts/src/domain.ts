import type { CortexStructureFinding } from './cortex-document-structure.ts';

export enum CortexDocumentMapContractKind {
  Request = 'cortex-document-map-audit-v1',
  Result = 'cortex-document-map-findings-v1',
}

export const CORTEX_DOCUMENT_MAP_DOCUMENT_LIMIT = 10_000;
export const CORTEX_DOCUMENT_MAP_EXCLUDED_PATH_LIMIT = 10_000;
export const CORTEX_DOCUMENT_MAP_FINDING_LIMIT = 50_000;
export const CORTEX_DOCUMENT_MAP_FINDING_MESSAGE_LIMIT = 4_096;
export const CORTEX_DOCUMENT_MAP_FINDING_LINE_LIMIT = 10_000_000;
export const CORTEX_DOCUMENT_MAP_PATH_LIMIT = 4_096;
export const CORTEX_DOCUMENT_MAP_CONTENT_LIMIT = 1_048_576;
export const CORTEX_DOCUMENT_MAP_REQUEST_BYTE_LIMIT = 4 * 1_024 * 1_024;
export const CORTEX_DOCUMENT_MAP_RESULT_BYTE_LIMIT = 1_024 * 1_024;

export type CortexDocumentMapDocument = {
  readonly relativePath: string;
  readonly content: string;
};

export type AuditCortexDocumentMapRequest = {
  readonly kind: CortexDocumentMapContractKind.Request;
  readonly documents: readonly CortexDocumentMapDocument[];
  readonly excludedDocumentPaths: readonly string[];
};

export type CortexDocumentMapResult = {
  readonly kind: CortexDocumentMapContractKind.Result;
  readonly findings: readonly CortexStructureFinding[];
};
