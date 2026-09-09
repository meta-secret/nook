import { CortexArticleAudit } from './audit.ts';

import { CortexArticleTransport } from './codec.ts';

import {
  CortexArticleContractKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleStructureResult,
} from './domain.ts';

import {
  type VerifyCortexArticleStructureResultRequest,
  CortexArticleResultVerifier,
} from './verification.ts';

export class CortexArticleApplication {
  private constructor(
    private readonly request: AuditCortexArticleStructureRequest,
  ) {}

  static executeCortexArticleStructureApplication(
    request: AuditCortexArticleStructureRequest,
  ): CortexArticleStructureResult {
    return new CortexArticleApplication(request).execute();
  }

  private execute(): CortexArticleStructureResult {
    const request = this.request;
    const serializedRequest =
      CortexArticleTransport.encodeCortexArticleRequest(request);
    const validatedRequest =
      CortexArticleTransport.decodeCortexArticleRequest(serializedRequest);
    const result: CortexArticleStructureResult = {
      kind: CortexArticleContractKind.Result,
      findings:
        CortexArticleAudit.auditCortexArticleStructure(validatedRequest),
    };
    const acceptanceRequest: AcceptCortexArticleStructureResultRequest = {
      auditRequest: validatedRequest,
      result,
    };
    return CortexArticleApplication.acceptCortexArticleStructureResult(
      acceptanceRequest,
    );
  }

  static acceptCortexArticleStructureResult(
    request: AcceptCortexArticleStructureResultRequest,
  ): CortexArticleStructureResult {
    const verificationRequest: VerifyCortexArticleStructureResultRequest = {
      auditRequest: request.auditRequest,
      result: request.result,
    };
    CortexArticleResultVerifier.verifyCortexArticleStructureResult(
      verificationRequest,
    );
    const serializedResult = CortexArticleTransport.encodeCortexArticleResult(
      request.result,
    );
    return CortexArticleTransport.decodeCortexArticleResult(serializedResult);
  }
}

export type AcceptCortexArticleStructureResultRequest = {
  readonly auditRequest: AuditCortexArticleStructureRequest;
  readonly result: CortexArticleStructureResult;
};
