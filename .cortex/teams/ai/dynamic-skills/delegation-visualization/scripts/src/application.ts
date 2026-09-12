import type { Result } from 'neverthrow';
import {
  DelegationVisualizationContractKind,
  type DelegationVisualizationResult,
  type RenderDelegationVisualizationRequest,
} from './domain.ts';

import { DelegationVisualization } from './renderer.ts';

import {
  DelegationVisualizationVerifier,
  type DelegationVisualizationResultVerificationError,
} from './result-codec.ts';

export class DelegationVisualizationApplication {
  private constructor(
    private readonly request: RenderDelegationVisualizationRequest,
  ) {}

  static from(
    request: RenderDelegationVisualizationRequest,
  ): DelegationVisualizationApplication {
    return new DelegationVisualizationApplication(request);
  }

  public execute(): Result<
    DelegationVisualizationResult,
    DelegationVisualizationResultVerificationError
  > {
    const request = this.request;
    const candidate: DelegationVisualizationResult = {
      kind: DelegationVisualizationContractKind.Result,
      document: DelegationVisualization.from(request).execute(),
    };
    return DelegationVisualizationVerifier.from({
      request,
      result: candidate,
    }).execute();
  }
}
