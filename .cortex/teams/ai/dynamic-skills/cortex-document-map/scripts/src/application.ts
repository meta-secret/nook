import type { Result } from 'neverthrow';
import { CortexDocumentMapAudit } from './audit.ts';
import {
  CortexDocumentMapTransport,
  CortexDocumentMapRequestEncoding,
  CortexDocumentMapResultEncoding,
  type CortexDocumentMapRequestDecodeError,
  type CortexDocumentMapResultDecodeError,
} from './codec.ts';
import {
  CortexDocumentMapContractKind,
  type AuditCortexDocumentMapRequest,
  type CortexDocumentMapResult,
} from './domain.ts';
import { CortexDocumentMapVerifier } from './verification.ts';
export type CortexDocumentMapFailure =
  CortexDocumentMapRequestDecodeError | CortexDocumentMapResultDecodeError;
export class CortexDocumentMapApplication {
  private constructor(
    private readonly request: AuditCortexDocumentMapRequest,
  ) {}
  static from(
    request: AuditCortexDocumentMapRequest,
  ): CortexDocumentMapApplication {
    return new CortexDocumentMapApplication(request);
  }
  execute(): Result<CortexDocumentMapResult, CortexDocumentMapFailure> {
    return new CortexDocumentMapRequestEncoding(this.request)
      .execute()
      .andThen((serialized) =>
        CortexDocumentMapTransport.from(serialized).execute(),
      )
      .andThen((auditRequest) =>
        new CortexDocumentMapResultAcceptance({
          auditRequest,
          result: {
            kind: CortexDocumentMapContractKind.Result,
            findings: CortexDocumentMapAudit.from(auditRequest).execute(),
          },
        }).execute(),
      );
  }
}
export class CortexDocumentMapResultAcceptance {
  constructor(private readonly request: AcceptCortexDocumentMapResultRequest) {}
  execute(): Result<
    CortexDocumentMapResult,
    CortexDocumentMapResultDecodeError
  > {
    return CortexDocumentMapVerifier.from(this.request)
      .execute()
      .andThen(() =>
        new CortexDocumentMapResultEncoding(this.request.result).execute(),
      )
      .andThen((serialized) =>
        CortexDocumentMapTransport.from(serialized).decodeResult(),
      );
  }
}
export type AcceptCortexDocumentMapResultRequest = {
  readonly auditRequest: AuditCortexDocumentMapRequest;
  readonly result: CortexDocumentMapResult;
};
