import type { NookSecretRecord } from "$lib/nook";

export type DecryptedSecrets = Record<string, NookSecretRecord>;
export type SecretLoader = (id: string) => Promise<NookSecretRecord>;

type SecretExposureToggle = {
  readonly id: string;
  readonly load: SecretLoader;
};
type DecryptedSecretOperation<T> = SecretExposureToggle & {
  readonly action: (record: NookSecretRecord) => Promise<T> | T;
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
  private active(): Extract<
    SecretExposureState,
    { kind: SecretExposureKind.Active }
  > {
    if (this.state.kind !== SecretExposureKind.Active)
      throw new Error("Secret exposure was released");
    return this.state;
  }
  async toggle({ id, load }: SecretExposureToggle): Promise<DecryptedSecrets> {
    const active = this.active();
    const current = active.records[id];
    if (current) {
      delete active.records[id];
      current.free();
    } else {
      const loaded = await load(id);
      if (this.state !== active) {
        loaded.free();
        throw new Error("Secret exposure was released");
      }
      const concurrent = active.records[id];
      if (concurrent) loaded.free();
      else active.records[id] = loaded;
    }
    return { ...active.records };
  }
  async withRecord<T>({
    id,
    load,
    action,
  }: DecryptedSecretOperation<T>): Promise<T> {
    const active = this.active();
    const cached = active.records[id];
    if (cached) return action(cached);
    const record = await load(id);
    try {
      if (this.state !== active)
        throw new Error("Secret exposure was released");
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
