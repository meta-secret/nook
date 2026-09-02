import {
  DelegationVisualizationContractKind,
  type DelegationVisualizationResult,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';
import { renderDelegationVisualization } from './renderer.ts';

export function executeDelegationVisualizationApplication(
  request: RenderDelegationVisualizationRequest,
): DelegationVisualizationResult {
  return {
    kind: DelegationVisualizationContractKind.Result,
    tree: renderDelegationVisualization(request),
  };
}
