import { auditCortexArticleStructure } from './audit.ts';
import {
  decodeCortexArticleRequest,
  decodeCortexArticleResult,
  encodeCortexArticleRequest,
  encodeCortexArticleResult,
} from './codec.ts';
import {
  CortexArticleContractKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleStructureResult,
} from './domain.ts';
import {
  verifyCortexArticleStructureResult,
  type VerifyCortexArticleStructureResultRequest,
} from './verification.ts';

export type AcceptCortexArticleStructureResultRequest = {
  readonly auditRequest: AuditCortexArticleStructureRequest;
  readonly result: CortexArticleStructureResult;
};

export function executeCortexArticleStructureApplication(
  request: AuditCortexArticleStructureRequest,
): CortexArticleStructureResult {
  const serializedRequest = encodeCortexArticleRequest(request);
  const validatedRequest = decodeCortexArticleRequest(serializedRequest);
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings: auditCortexArticleStructure(validatedRequest),
  };
  const acceptanceRequest: AcceptCortexArticleStructureResultRequest = {
    auditRequest: validatedRequest,
    result,
  };
  return acceptCortexArticleStructureResult(acceptanceRequest);
}

export function acceptCortexArticleStructureResult(
  request: AcceptCortexArticleStructureResultRequest,
): CortexArticleStructureResult {
  const verificationRequest: VerifyCortexArticleStructureResultRequest = {
    auditRequest: request.auditRequest,
    result: request.result,
  };
  verifyCortexArticleStructureResult(verificationRequest);
  const serializedResult = encodeCortexArticleResult(request.result);
  return decodeCortexArticleResult(serializedResult);
}
