import { CortexDocumentMapAudit } from './audit.ts';

import { CortexDocumentMapTransport } from './codec.ts';

import {
  CortexDocumentMapContractKind,
  type AuditCortexDocumentMapRequest,
  type CortexDocumentMapResult,
} from './domain.ts';

import {
  type VerifyCortexDocumentMapResultRequest,
  CortexDocumentMapVerifier,
} from './verification.ts';

export class CortexDocumentMapApplication {
  private constructor(
    private readonly request: AuditCortexDocumentMapRequest,
  ) {}

  static from(
    request: AuditCortexDocumentMapRequest,
  ): CortexDocumentMapApplication {
    return new CortexDocumentMapApplication(request);
  }

  public execute(): CortexDocumentMapResult {
    const request = this.request;
    const admitted = CortexDocumentMapTransport.from(
      CortexDocumentMapTransport.encodeCortexDocumentMapRequest(request),
    ).execute();
    const result: CortexDocumentMapResult = {
      kind: CortexDocumentMapContractKind.Result,
      findings: CortexDocumentMapAudit.from(admitted).execute(),
    };
    return CortexDocumentMapApplication.acceptCortexDocumentMapResult({
      auditRequest: admitted,
      result,
    });
  }

  static acceptCortexDocumentMapResult(
    request: AcceptCortexDocumentMapResultRequest,
  ): CortexDocumentMapResult {
    const verificationRequest: VerifyCortexDocumentMapResultRequest = {
      auditRequest: request.auditRequest,
      result: request.result,
    };
    CortexDocumentMapVerifier.from(verificationRequest).execute();
    return CortexDocumentMapTransport.decodeCortexDocumentMapResult(
      CortexDocumentMapTransport.encodeCortexDocumentMapResult(request.result),
    );
  }
}

export type AcceptCortexDocumentMapResultRequest = {
  readonly auditRequest: AuditCortexDocumentMapRequest;
  readonly result: CortexDocumentMapResult;
};
