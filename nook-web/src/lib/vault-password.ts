export type VaultPasswordEntrySummary = {
  id: string
  label: string
  created_at: string
}

export function mapWasmPasswordEntries(raw: unknown): VaultPasswordEntrySummary[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const entries: VaultPasswordEntrySummary[] = []
  for (const item of raw) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { id?: unknown }).id === 'string' &&
      typeof (item as { label?: unknown }).label === 'string'
    ) {
      entries.push({
        id: (item as { id: string }).id,
        label: (item as { label: string }).label,
        created_at:
          typeof (item as { created_at?: unknown }).created_at === 'string'
            ? (item as { created_at: string }).created_at
            : '',
      })
    }
  }
  return entries
}
