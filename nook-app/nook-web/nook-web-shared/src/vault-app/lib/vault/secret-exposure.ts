import { err, ok, type Result } from "neverthrow";
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import type { NookSecretRecord } from "$lib/nook";

export type DecryptedSecrets = Record<string, NookSecretRecord>;
export type SecretLoader = (
  id: string,
) => Promise<Result<NookSecretRecord, VaultStorageFailure>>;

type SecretExposureToggle = {
  readonly id: string;
  readonly load: SecretLoader;
};
type DecryptedSecretOperation<T> = SecretExposureToggle & {
  readonly action: (
    record: NookSecretRecord,
  ) => Promise<Result<T, VaultStorageFailure>> | Result<T, VaultStorageFailure>;
};
enum SecretExposureKind {
  Active = "active",
  Released = "released",
}
type SecretExposureState =
  | { kind: SecretExposureKind.Active; records: DecryptedSecrets }
  | { kind: SecretExposureKind.Released };

/** Terminal release has no record access, loading, or cleanup methods. */
export type ReleasedSecretExposure = {
  readonly kind: SecretExposureKind.Released;
};

/** One presentation lifetime. Async loads are admitted only into its live generation. */
export class SecretExposure {
  private state: SecretExposureState;
  constructor(records: DecryptedSecrets) {
    this.state = { kind: SecretExposureKind.Active, records: { ...records } };
  }
  private active(): Result<
    Extract<SecretExposureState, { kind: SecretExposureKind.Active }>,
    VaultStorageFailure
  > {
    return this.state.kind === SecretExposureKind.Active
      ? ok(this.state)
      : err(new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged));
  }
  async toggle({
    id,
    load,
  }: SecretExposureToggle): Promise<
    Result<DecryptedSecrets, VaultStorageFailure>
  > {
    const admitted = this.active();
    if (admitted.isErr()) return err(admitted.error);
    const active = admitted.value;
    const current = active.records[id];
    if (current) {
      delete active.records[id];
      current.free();
    } else {
      const result = await load(id);
      if (result.isErr()) return err(result.error);
      const loaded = result.value;
      if (this.state !== active) {
        loaded.free();
        return err(
          new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
        );
      }
      const concurrent = active.records[id];
      if (concurrent) loaded.free();
      else active.records[id] = loaded;
    }
    return ok({ ...active.records });
  }
  async withRecord<T>({
    id,
    load,
    action,
  }: DecryptedSecretOperation<T>): Promise<Result<T, VaultStorageFailure>> {
    const admitted = this.active();
    if (admitted.isErr()) return err(admitted.error);
    const active = admitted.value;
    const cached = active.records[id];
    if (cached) return action(cached);
    const result = await load(id);
    if (result.isErr()) return err(result.error);
    const record = result.value;
    try {
      if (this.state !== active)
        return err(
          new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
        );
      return await action(record);
    } finally {
      record.free();
    }
  }
  free(): ReleasedSecretExposure {
    const prior = this.state;
    this.state = { kind: SecretExposureKind.Released };
    if (prior.kind === SecretExposureKind.Active) {
      const records = Object.values(prior.records);
      for (const id of Object.keys(prior.records)) delete prior.records[id];
      for (const record of records) record.free();
    }
    return { kind: SecretExposureKind.Released };
  }
}
