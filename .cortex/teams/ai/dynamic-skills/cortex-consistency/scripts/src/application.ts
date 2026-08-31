import { compileCortexContracts } from './audit.ts';
import {
  CortexConsistencyContractKind,
  type CompileCortexContractsRequest,
  type CortexConsistencyResult,
} from './domain.ts';

export function executeCortexConsistencyApplication(
  request: CompileCortexContractsRequest,
): CortexConsistencyResult {
  return {
    kind: CortexConsistencyContractKind.Result,
    findings: compileCortexContracts(request),
  };
}
