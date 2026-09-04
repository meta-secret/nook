import {
  DelegationVisualizationContractKind,
  type DelegationVisualizationResult,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';
import { renderDelegationVisualization } from './renderer.ts';
import { verifyDelegationVisualizationResult } from './result-codec.ts';

export function executeDelegationVisualizationApplication(
  request: RenderDelegationVisualizationRequest,
): DelegationVisualizationResult {
  const candidate: DelegationVisualizationResult = {
    kind: DelegationVisualizationContractKind.Result,
    document: renderDelegationVisualization(request),
  };
  return verifyDelegationVisualizationResult({ request, result: candidate });
}
