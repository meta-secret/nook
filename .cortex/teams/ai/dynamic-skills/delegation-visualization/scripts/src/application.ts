import {
  DelegationVisualizationContractKind,
  type DelegationVisualizationResult,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

import { DelegationVisualization } from './renderer.ts';

import { DelegationVisualizationVerifier } from './result-codec.ts';

export class DelegationVisualizationApplication {
  private constructor(
    private readonly request: RenderDelegationVisualizationRequest,
  ) {}

  static executeDelegationVisualizationApplication(
    request: RenderDelegationVisualizationRequest,
  ): DelegationVisualizationResult {
    return new DelegationVisualizationApplication(request).execute();
  }

  private execute(): DelegationVisualizationResult {
    const request = this.request;
    const candidate: DelegationVisualizationResult = {
      kind: DelegationVisualizationContractKind.Result,
      document: DelegationVisualization.renderDelegationVisualization(request),
    };
    return DelegationVisualizationVerifier.verifyDelegationVisualizationResult({
      request,
      result: candidate,
    });
  }
}
