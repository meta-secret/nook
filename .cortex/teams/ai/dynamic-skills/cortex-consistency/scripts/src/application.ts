import { CortexConsistencyContract } from './audit.ts';

import {
  CortexConsistencyContractKind,
  type CompileCortexContractsRequest,
  type CortexConsistencyResult,
} from './domain.ts';

import { CORTEX_CONTRACT_REGISTRY } from './registry.ts';

export class CortexConsistencyApplication {
  private constructor(
    private readonly request: CompileCortexContractsRequest,
  ) {}

  static from(
    request: CompileCortexContractsRequest,
  ): CortexConsistencyApplication {
    return new CortexConsistencyApplication(request);
  }

  public execute(): CortexConsistencyResult {
    const request = this.request;
    return {
      kind: CortexConsistencyContractKind.Result,
      findings: CortexConsistencyContract.from({
        registry: CORTEX_CONTRACT_REGISTRY,
        documents: request.documents,
      }).execute(),
    };
  }
}
