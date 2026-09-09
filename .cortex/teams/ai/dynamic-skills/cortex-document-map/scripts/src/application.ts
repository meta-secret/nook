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

  static executeCortexDocumentMapApplication(
    request: AuditCortexDocumentMapRequest,
  ): CortexDocumentMapResult {
    return new CortexDocumentMapApplication(request).execute();
  }

  private execute(): CortexDocumentMapResult {
    const request = this.request;
    const admitted = CortexDocumentMapTransport.decodeCortexDocumentMapRequest(
      CortexDocumentMapTransport.encodeCortexDocumentMapRequest(request),
    );
    const result: CortexDocumentMapResult = {
      kind: CortexDocumentMapContractKind.Result,
      findings: CortexDocumentMapAudit.auditCortexDocumentMap(admitted),
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
    CortexDocumentMapVerifier.verifyCortexDocumentMapResult(
      verificationRequest,
    );
    return CortexDocumentMapTransport.decodeCortexDocumentMapResult(
      CortexDocumentMapTransport.encodeCortexDocumentMapResult(request.result),
    );
  }
}

export type AcceptCortexDocumentMapResultRequest = {
  readonly auditRequest: AuditCortexDocumentMapRequest;
  readonly result: CortexDocumentMapResult;
};
