import { auditCortexDocumentMap } from './audit.ts';
import {
  decodeCortexDocumentMapRequest,
  decodeCortexDocumentMapResult,
  encodeCortexDocumentMapRequest,
  encodeCortexDocumentMapResult,
} from './codec.ts';
import {
  CortexDocumentMapContractKind,
  type AuditCortexDocumentMapRequest,
  type CortexDocumentMapResult,
} from './domain.ts';
import {
  verifyCortexDocumentMapResult,
  type VerifyCortexDocumentMapResultRequest,
} from './verification.ts';

export type AcceptCortexDocumentMapResultRequest = {
  readonly auditRequest: AuditCortexDocumentMapRequest;
  readonly result: CortexDocumentMapResult;
};

export function executeCortexDocumentMapApplication(
  request: AuditCortexDocumentMapRequest,
): CortexDocumentMapResult {
  const admitted = decodeCortexDocumentMapRequest(
    encodeCortexDocumentMapRequest(request),
  );
  const result: CortexDocumentMapResult = {
    kind: CortexDocumentMapContractKind.Result,
    findings: auditCortexDocumentMap(admitted),
  };
  return acceptCortexDocumentMapResult({ auditRequest: admitted, result });
}

export function acceptCortexDocumentMapResult(
  request: AcceptCortexDocumentMapResultRequest,
): CortexDocumentMapResult {
  const verificationRequest: VerifyCortexDocumentMapResultRequest = {
    auditRequest: request.auditRequest,
    result: request.result,
  };
  verifyCortexDocumentMapResult(verificationRequest);
  return decodeCortexDocumentMapResult(
    encodeCortexDocumentMapResult(request.result),
  );
}
