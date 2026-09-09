import type { Result } from 'neverthrow';
import { CortexArticleAudit } from './audit.ts';
import {
  CortexArticleTransport,
  CortexArticleRequestEncoding,
  CortexArticleResultEncoding,
} from './codec.ts';
import type { CortexArticleRequestDecodeError } from './decode-error.ts';
import {
  CortexArticleContractKind,
  type AuditCortexArticleStructureRequest,
  type CortexArticleStructureResult,
} from './domain.ts';
import { CortexArticleResultVerifier } from './verification.ts';

export class CortexArticleApplication {
  private constructor(
    private readonly request: AuditCortexArticleStructureRequest,
  ) {}
  static from(
    request: AuditCortexArticleStructureRequest,
  ): CortexArticleApplication {
    return new CortexArticleApplication(request);
  }
  execute(): Result<
    CortexArticleStructureResult,
    CortexArticleRequestDecodeError
  > {
    return new CortexArticleRequestEncoding(this.request)
      .execute()
      .andThen((serialized) =>
        CortexArticleTransport.from(serialized).decodeRequest(),
      )
      .andThen((auditRequest) =>
        new CortexArticleResultAcceptance({
          auditRequest,
          result: {
            kind: CortexArticleContractKind.Result,
            findings: CortexArticleAudit.from(auditRequest).execute(),
          },
        }).execute(),
      );
  }
}

export class CortexArticleResultAcceptance {
  constructor(
    private readonly request: AcceptCortexArticleStructureResultRequest,
  ) {}
  execute(): Result<
    CortexArticleStructureResult,
    CortexArticleRequestDecodeError
  > {
    return CortexArticleResultVerifier.from(this.request)
      .execute()
      .andThen(() =>
        new CortexArticleResultEncoding(this.request.result).execute(),
      )
      .andThen((serialized) =>
        CortexArticleTransport.from(serialized).decodeResult(),
      );
  }
}

export type AcceptCortexArticleStructureResultRequest = {
  readonly auditRequest: AuditCortexArticleStructureRequest;
  readonly result: CortexArticleStructureResult;
};
