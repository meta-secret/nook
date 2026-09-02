import { compileCortexContracts } from './audit.ts';
import {
  CortexConsistencyContractKind,
  type CompileCortexContractsRequest,
  type CortexConsistencyResult,
} from './domain.ts';
import { CORTEX_CONTRACT_REGISTRY } from './registry.ts';

export function executeCortexConsistencyApplication(
  request: CompileCortexContractsRequest,
): CortexConsistencyResult {
  return {
    kind: CortexConsistencyContractKind.Result,
    findings: compileCortexContracts({
      registry: CORTEX_CONTRACT_REGISTRY,
      documents: request.documents,
    }),
  };
}
