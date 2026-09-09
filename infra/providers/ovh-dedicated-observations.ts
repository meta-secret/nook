import {
  OvhServerState,
  type DedicatedServerDefinition,
  type OvhRecoveryMarker,
  type OvhServer,
} from "./ovh-dedicated-contracts";

export enum RecoveryMarkerCompatibilityKind {
  Matching = "matching",
  DifferentInventory = "different-inventory",
}
export interface MatchingRecoveryMarker {
  kind: RecoveryMarkerCompatibilityKind.Matching;
  marker: OvhRecoveryMarkerObservation;
}
export interface DifferentRecoveryInventory {
  kind: RecoveryMarkerCompatibilityKind.DifferentInventory;
}
export type RecoveryMarkerCompatibility =
  MatchingRecoveryMarker | DifferentRecoveryInventory;
export interface RecoveryMarkerExpectation {
  definition: DedicatedServerDefinition;
  hostname: string;
}

export class OvhRecoveryMarkerObservation {
  private constructor(private readonly marker: Readonly<OvhRecoveryMarker>) {}
  static fromRecord(marker: OvhRecoveryMarker): OvhRecoveryMarkerObservation {
    return new OvhRecoveryMarkerObservation({ ...marker });
  }
  compatibility(
    expected: RecoveryMarkerExpectation,
  ): RecoveryMarkerCompatibility {
    if (
      this.marker.version === 1 &&
      this.marker.hostname === expected.hostname &&
      this.marker.serviceName === expected.definition.serviceName &&
      this.marker.operatingSystem === expected.definition.operatingSystem
    ) {
      return { kind: RecoveryMarkerCompatibilityKind.Matching, marker: this };
    }
    return { kind: RecoveryMarkerCompatibilityKind.DifferentInventory };
  }
  // JSON.stringify is an external persistence boundary; preserve the flat marker schema.
  toJSON(): OvhRecoveryMarker {
    return { ...this.marker };
  }
}

export enum ServerAdmissionKind {
  Ready = "ready",
  Incompatible = "incompatible",
}
export interface ReadyDeclaredServer {
  kind: ServerAdmissionKind.Ready;
  server: OvhServerObservation;
}
export interface IncompatibleDeclaredServer {
  kind: ServerAdmissionKind.Incompatible;
}
export type ServerAdmission = ReadyDeclaredServer | IncompatibleDeclaredServer;
export class OvhServerAdmissionError extends Error {
  readonly kind = ServerAdmissionKind.Incompatible;
  constructor() {
    super(
      "OVH server does not match the declared identity and ready-state contract",
    );
  }
}
export class OvhServerObservation {
  private constructor(private readonly server: Readonly<OvhServer>) {}
  static fromRecord(server: OvhServer): OvhServerObservation {
    return new OvhServerObservation({ ...server });
  }
  admission(expected: DedicatedServerDefinition): ServerAdmission {
    if (
      this.server.name !== expected.serviceName ||
      this.server.ip !== expected.publicAddress ||
      this.server.commercialRange !== expected.expectedCommercialRange ||
      this.server.datacenter !== expected.expectedDatacenter ||
      this.server.state !== OvhServerState.Ready
    ) {
      return { kind: ServerAdmissionKind.Incompatible };
    }
    return { kind: ServerAdmissionKind.Ready, server: this };
  }
  // The separate reinstall-intent owner combines this observed OS with operator intent.
  get os(): string {
    return this.server.os;
  }
  toJSON(): OvhServer {
    return { ...this.server };
  }
}
