type DevicesAccessNudgeVisibility = {
  readonly hasActiveLocalVault: boolean;
  readonly localVaultCount: number;
  readonly preference: DevicesAccessNudgePreference;
};

type DevicesAccessNudgeStorageRead = {
  readonly storage: Storage;
  readonly storageKey: string;
};

export enum DashboardLoadKind {
  Loading = "loading",
  Ready = "ready",
  Failed = "failed",
}

export interface DashboardSnapshotFailureRequest {
  readonly currentGeneration: () => number;
  readonly failAccessSnapshot: () => void;
  readonly failDirectorySnapshot: () => void;
}

export class DashboardSnapshotFailureTransition {
  constructor(private readonly request: DashboardSnapshotFailureRequest) {}

  apply(generation: number): DashboardLoadKind {
    if (generation !== this.request.currentGeneration()) {
      return DashboardLoadKind.Loading;
    }
    this.request.failAccessSnapshot();
    this.request.failDirectorySnapshot();
    return DashboardLoadKind.Failed;
  }
}

export enum DevicesAccessRepresentationKind {
  List = "list",
  Graph = "graph",
}

export type DashboardLoadState<ReadyView> =
  | { kind: typeof DashboardLoadKind.Loading }
  | { kind: typeof DashboardLoadKind.Ready; view: ReadyView }
  | { kind: typeof DashboardLoadKind.Failed };

export type DashboardReadyProjectionRequest<
  AccessView,
  DirectoryView,
  Identity,
> = {
  readonly accessState: { readonly kind: string; readonly view?: AccessView };
  readonly directoryState: {
    readonly kind: string;
    readonly view?: DirectoryView;
  };
  readonly selectedIdentity:
    | { readonly kind: string }
    | { readonly kind: string; readonly identity: Identity };
};

export enum DashboardReadyProjectionKind {
  Unavailable = "unavailable",
  Empty = "empty",
  Selected = "selected",
}

export type DashboardReadyProjectionState<AccessView, DirectoryView, Identity> =
  | { readonly kind: DashboardReadyProjectionKind.Unavailable }
  | {
      readonly kind: DashboardReadyProjectionKind.Empty;
      readonly accessView: AccessView;
      readonly directory: DirectoryView;
    }
  | {
      readonly kind: DashboardReadyProjectionKind.Selected;
      readonly accessView: AccessView;
      readonly directory: DirectoryView;
      readonly identity: Identity;
    };

/** Projects two independently loaded UI states only when both own ready views. */
export class DashboardReadyProjectionOwner<
  AccessView,
  DirectoryView,
  Identity,
> {
  constructor(
    private readonly request: DashboardReadyProjectionRequest<
      AccessView,
      DirectoryView,
      Identity
    >,
  ) {}

  get state(): DashboardReadyProjectionState<
    AccessView,
    DirectoryView,
    Identity
  > {
    const { accessState, directoryState, selectedIdentity } = this.request;
    if (
      accessState.kind !== DashboardLoadKind.Ready ||
      directoryState.kind !== DashboardLoadKind.Ready ||
      !("view" in accessState) ||
      !("view" in directoryState)
    ) {
      return { kind: DashboardReadyProjectionKind.Unavailable };
    }
    const ready = {
      accessView: accessState.view,
      directory: directoryState.view,
    };
    return "identity" in selectedIdentity
      ? {
          kind: DashboardReadyProjectionKind.Selected,
          ...ready,
          identity: selectedIdentity.identity,
        }
      : { kind: DashboardReadyProjectionKind.Empty, ...ready };
  }
}

export enum DashboardTextKind {
  Unknown = "unknown",
  Known = "known",
}

export enum AccessNodeDetailKind {
  Absent = "absent",
  Identifier = "identifier",
  Summary = "summary",
}

/**
 * The single supporting line under a node title: one short public identifier
 * rendered as data, a plain-language summary, or nothing yet.
 */
export type AccessNodeDetail =
  | { kind: typeof AccessNodeDetailKind.Absent }
  | { kind: typeof AccessNodeDetailKind.Identifier; value: string }
  | { kind: typeof AccessNodeDetailKind.Summary; value: string };

export class KnownDashboardText {
  readonly kind = DashboardTextKind.Known;
  constructor(readonly value: string) {}

  displayText(): string {
    return this.value;
  }

  identifierDetail(): AccessNodeDetail {
    return { kind: AccessNodeDetailKind.Identifier, value: this.value };
  }
}

export class UnknownDashboardText {
  readonly kind = DashboardTextKind.Unknown;

  displayText(unavailable: () => string): string {
    return unavailable();
  }

  identifierDetail(): AccessNodeDetail {
    return { kind: AccessNodeDetailKind.Absent };
  }
}

export type DashboardText = KnownDashboardText | UnknownDashboardText;

export enum DashboardTimestampKind {
  Unavailable = "unavailable",
  NotYetObserved = "not-yet-observed",
  Known = "known",
}

export type DashboardTimestamp =
  | { kind: typeof DashboardTimestampKind.Unavailable }
  | { kind: typeof DashboardTimestampKind.NotYetObserved }
  | { kind: typeof DashboardTimestampKind.Known; value: string };

export type DashboardView = {
  protection: DeviceAccessProtectionKind;
  identityState: DeviceAccessIdentityState;
  deviceId: DashboardText;
  credentialId: DashboardText;
  passkeyName: DashboardText;
  providerLabel: DashboardText;
  createdAt: DashboardTimestamp;
  lastUsedAt: DashboardTimestamp;
  keeper: PasskeyKeeperKind;
  vaults: VaultAccessView[];
};

export enum DevicesAccessNudgePreference {
  Visible = "visible",
  Dismissed = "dismissed",
}

export class DevicesAccessNudgePresentation {
  constructor(private readonly request: DevicesAccessNudgeVisibility) {}
  get visible(): boolean {
    const { hasActiveLocalVault, localVaultCount, preference } = this.request;

    return (
      !hasActiveLocalVault &&
      localVaultCount === 0 &&
      preference === DevicesAccessNudgePreference.Visible
    );
  }
}

export enum DevicesAccessTriggerKind {
  Header = "header",
  IdentityContext = "identity-context",
  Nudge = "nudge",
}

export enum DevicesAccessHostMountKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type DevicesAccessHostMount =
  | { kind: typeof DevicesAccessHostMountKind.Unmounted }
  | {
      kind: typeof DevicesAccessHostMountKind.Mounted;
      element: HTMLDivElement;
    };

export enum DevicesAccessNudgeStorageKind {
  Missing = "missing",
  Stored = "stored",
}

export type DevicesAccessNudgeStorageState =
  | { kind: typeof DevicesAccessNudgeStorageKind.Missing }
  | {
      kind: typeof DevicesAccessNudgeStorageKind.Stored;
      serialized: string;
    };

export class DevicesAccessNudgeStorage {
  constructor(private readonly request: DevicesAccessNudgeStorageRead) {}
  get state(): DevicesAccessNudgeStorageState {
    const { storage, storageKey } = this.request;

    const serialized = storage.getItem(storageKey);
    return typeof serialized === "string"
      ? { kind: DevicesAccessNudgeStorageKind.Stored, serialized }
      : { kind: DevicesAccessNudgeStorageKind.Missing };
  }
}

export class StoredDevicesAccessNudge {
  constructor(private readonly request: DevicesAccessNudgeStorageState) {}
  get preference(): DevicesAccessNudgePreference {
    const storageState = this.request;

    return storageState.kind === DevicesAccessNudgeStorageKind.Stored &&
      (storageState.serialized === DevicesAccessNudgePreference.Dismissed ||
        storageState.serialized === "1")
      ? DevicesAccessNudgePreference.Dismissed
      : DevicesAccessNudgePreference.Visible;
  }
}
import type {
  DeviceAccessIdentityState,
  DeviceAccessProtectionKind,
  PasskeyKeeperKind,
} from "$app-wasm";
import type { VaultAccessView } from "./devices-access/access-chain";
