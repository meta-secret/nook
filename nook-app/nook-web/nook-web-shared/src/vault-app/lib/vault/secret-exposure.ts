import type { NookSecretRecord } from "$lib/nook";

export type DecryptedSecrets = Record<string, NookSecretRecord>;
export type SecretLoader = (id: string) => Promise<NookSecretRecord>;

export async function toggleSecretExposure({
  records,
  id,
  load,
}: {
  readonly records: DecryptedSecrets;
  readonly id: string;
  readonly load: SecretLoader;
}): Promise<DecryptedSecrets> {
  const current = records[id];
  if (current) {
    current.free();
    const next = { ...records };
    delete next[id];
    return next;
  }
  return { ...records, [id]: await load(id) };
}

export async function withDecryptedSecret<T>({
  records,
  id,
  load,
  action,
}: {
  readonly records: DecryptedSecrets;
  readonly id: string;
  readonly load: SecretLoader;
  readonly action: (record: NookSecretRecord) => Promise<T> | T;
}): Promise<T> {
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
