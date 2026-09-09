import type { NookSecretRecord } from "$lib/nook";

export type DecryptedSecrets = Record<string, NookSecretRecord>;
export type SecretLoader = (id: string) => Promise<NookSecretRecord>;

type SecretExposureToggle = {
  readonly records: DecryptedSecrets;
  readonly id: string;
  readonly load: SecretLoader;
};

type DecryptedSecretOperation<T> = {
  readonly records: DecryptedSecrets;
  readonly id: string;
  readonly load: SecretLoader;
  readonly action: (record: NookSecretRecord) => Promise<T> | T;
};

/** Owns the current in-memory decrypted record handles for a presentation. */
export class SecretExposure {
  constructor(private readonly records: DecryptedSecrets) {}
  async toggle({
    id,
    load,
  }: Omit<SecretExposureToggle, "records">): Promise<DecryptedSecrets> {
    const records = this.records;
    const current = records[id];
    if (current) {
      current.free();
      const next = { ...records };
      delete next[id];
      return next;
    }
    return { ...records, [id]: await load(id) };
  }

  async withRecord<T>({
    id,
    load,
    action,
  }: Omit<DecryptedSecretOperation<T>, "records">): Promise<T> {
    const records = this.records;
    const cached = records[id];
    if (cached) return action(cached);

    const record = await load(id);
    try {
      return await action(record);
    } finally {
      record.free();
    }
  }

  free(): void {
    for (const record of Object.values(this.records)) record.free();
  }
}
