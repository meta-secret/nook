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

  static from(
    request: AuditCortexArticleStructureRequest,
  ): CortexArticleApplication {
    return new CortexArticleApplication(request);
  }

  public execute(): CortexArticleStructureResult {
    const request = this.request;
    const serializedRequest =
      CortexArticleTransport.encodeCortexArticleRequest(request);
    const validatedRequest =
      CortexArticleTransport.decodeCortexArticleRequest(serializedRequest);
    const result: CortexArticleStructureResult = {
      kind: CortexArticleContractKind.Result,
      findings: CortexArticleAudit.from(validatedRequest).execute(),
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
    CortexArticleResultVerifier.from(verificationRequest).execute();
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
