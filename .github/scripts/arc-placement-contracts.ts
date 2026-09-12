import { err, ok, type Result } from "neverthrow";
import {
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";
import type { ArcContainer } from "./arc-manifest-model";
export class ArcPlacementScenario {
  constructor(
    readonly primaryOne: number,
    readonly primaryTwo: number,
    readonly secondary: number,
    readonly overflow: number,
  ) {}

  tierPreferenceScore(): number {
    return (
      (this.primaryOne + this.primaryTwo) * 100 +
      this.secondary * 50 +
      this.overflow
    );
  }

  primarySkew(): number {
    return Math.abs(this.primaryOne - this.primaryTwo);
  }
}

export class ArcActivationScenario {
  constructor(
    readonly queuedRunners: number,
    readonly firstEligiblePrimaryNodes: number,
    readonly firstEligibleWeakerNodes: number,
  ) {}

  preservesPrimaryFirstEligibility(): boolean {
    return (
      this.queuedRunners > 0 &&
      this.firstEligiblePrimaryNodes === 2 &&
      this.firstEligibleWeakerNodes === 0
    );
  }
}

export class ArcContainerResourceContract {
  constructor(
    private readonly container: ArcContainer,
    private readonly label: string,
  ) {}
  assertCpuUnconstrained(): Result<void, OperationalContractFailure> {
    const { container, label } = this;
    const resources = container.resources;
    if (!resources) {
      return ok();
    }
    const { limits = {}, requests = {} } = resources;
    if (
      Object.keys(requests).includes("cpu") ||
      Object.keys(limits).includes("cpu")
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `${label} must not declare CPU requests or limits`,
      });
    }
    return ok();
  }

  assertNoEnvelope(): Result<void, OperationalContractFailure> {
    const { container, label } = this;
    if ("resources" in container) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `${label} must not declare resource requests or limits`,
      });
    }
    return ok();
  }
}
