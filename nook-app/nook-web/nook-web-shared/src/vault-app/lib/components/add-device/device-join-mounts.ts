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
