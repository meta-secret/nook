import type { NookSecretRecord } from "$lib/nook";

export type DecryptedSecrets = Record<string, NookSecretRecord>;
export type SecretLoader = (id: string) => Promise<NookSecretRecord>;

type SecretExposureToggle = {
  readonly records: DecryptedSecrets;
  readonly id: string;
  readonly load: SecretLoader;
};

export async function toggleSecretExposure({
  records,
  id,
  load,
}: SecretExposureToggle): Promise<DecryptedSecrets> {
  const current = records[id];
  if (current) {
    current.free();
    const next = { ...records };
    delete next[id];
    return next;
  }
  return { ...records, [id]: await load(id) };
}

type DecryptedSecretOperation<T> = {
  readonly records: DecryptedSecrets;
  readonly id: string;
  readonly load: SecretLoader;
  readonly action: (record: NookSecretRecord) => Promise<T> | T;
};

export async function withDecryptedSecret<T>({
  records,
  id,
  load,
  action,
}: DecryptedSecretOperation<T>): Promise<T> {
  const cached = records[id];
  if (cached) return action(cached);

  const record = await load(id);
  try {
    return await action(record);
  } finally {
    record.free();
  }
}

export function freeDecryptedSecrets(records: DecryptedSecrets): void {
  for (const record of Object.values(records)) record.free();
}
