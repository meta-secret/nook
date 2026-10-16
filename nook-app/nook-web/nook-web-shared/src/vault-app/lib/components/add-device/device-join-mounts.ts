import { provider_carries_device_join } from "$app-wasm";
import type { StorageProvider } from "$lib/auth/providers";
import {
  provider_supports_replication,
  type ReplicationType,
} from "$lib/vault/architecture-model";

type DeviceJoinMountRequest = {
  /** Remote provider rows that carry the identity's control log. */
  readonly mounts: readonly StorageProvider[];
  /** How the open vault replicates; the joining device must follow it. */
  readonly replication: ReplicationType;
};

/** The identity's cloud mounts another device can join through. Core decides
 * which providers carry a join; a local folder keeps a copy but cannot. */
export class DeviceJoinMounts {
  constructor(private readonly request: DeviceJoinMountRequest) {}

  get compatible(): StorageProvider[] {
    const { mounts, replication } = this.request;
    return mounts.filter(
      (provider) =>
        provider_carries_device_join(provider) &&
        provider_supports_replication(provider, replication),
    );
  }
}

/** Whether another device can join this identity yet. */
export enum DeviceJoinAvailability {
  /** The sync providers are not loaded yet. */
  Unknown = "unknown",
  /** No provider can carry a join: a cloud sync provider comes first. */
  NeedsCloud = "needs-cloud",
  Ready = "ready",
}

type DeviceJoinReadinessRequest = {
  /** The identity's configured sync providers. Adding a device records
   * them as mounts, so they decide before any mount is recorded. */
  readonly providers: readonly StorageProvider[];
  readonly providersLoaded: boolean;
  readonly replication: ReplicationType;
};

export class DeviceJoinReadiness {
  constructor(private readonly request: DeviceJoinReadinessRequest) {}

  get availability(): DeviceJoinAvailability {
    const { providers, providersLoaded, replication } = this.request;
    if (!providersLoaded) return DeviceJoinAvailability.Unknown;
    const mountRequest: DeviceJoinMountRequest = {
      mounts: providers,
      replication,
    };
    return new DeviceJoinMounts(mountRequest).compatible.length > 0
      ? DeviceJoinAvailability.Ready
      : DeviceJoinAvailability.NeedsCloud;
  }
}
