import {
  DelegationVisualizationContractKind,
  type DelegationVisualizationResult,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';
import { renderDelegationVisualization } from './renderer.ts';
import {
  decodeDelegationVisualizationResult,
  verifyDelegationVisualizationResult,
} from './result-codec.ts';

export function executeDelegationVisualizationApplication(
  request: RenderDelegationVisualizationRequest,
): DelegationVisualizationResult {
  const candidate: DelegationVisualizationResult = {
    kind: DelegationVisualizationContractKind.Result,
    yaml: renderDelegationVisualization(request),
  };
  const result = decodeDelegationVisualizationResult(JSON.stringify(candidate));
  return verifyDelegationVisualizationResult({ request, result });
}
