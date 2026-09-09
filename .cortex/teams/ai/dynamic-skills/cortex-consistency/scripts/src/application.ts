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

  static executeCortexConsistencyApplication(
    request: CompileCortexContractsRequest,
  ): CortexConsistencyResult {
    return new CortexConsistencyApplication(request).execute();
  }

  private execute(): CortexConsistencyResult {
    const request = this.request;
    return {
      kind: CortexConsistencyContractKind.Result,
      findings: CortexConsistencyContract.compileCortexContracts({
        registry: CORTEX_CONTRACT_REGISTRY,
        documents: request.documents,
      }),
    };
  }
}
