import type { StorageProvider, LocalFolderConfig } from '$lib/auth-providers'
import type { VaultState } from '$lib/vault.svelte'
import { readLocalVaultBlob } from '$lib/vault-sync'

const DB_NAME = 'nook_file_sync'
const STORE_NAME = 'directory_handles'
const EVENT_LOG_PARTS = ['nook-log', 'v1', 'events'] as const
const EVENT_DIGEST_PATTERN = '[A-Za-z0-9_-]{43}'
const EVENT_FILE_NAME_PATTERN = new RegExp(`^(${EVENT_DIGEST_PATTERN})\\.yaml$`)
const EVENT_ID_PATTERN = new RegExp(`^sha256u:(${EVENT_DIGEST_PATTERN})$`)

type PermissionStateValue = 'granted' | 'denied' | 'prompt'

type PermissionDescriptor = {
  mode?: 'read' | 'readwrite'
}

type LocalFileHandle = {
  kind?: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{
    write(data: string): Promise<void>
    close(): Promise<void>
  }>
}

type LocalDirectoryHandle = {
  kind?: 'directory'
  name: string
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<LocalDirectoryHandle>
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<LocalFileHandle>
  entries?(): AsyncIterable<[string, LocalDirectoryHandle | LocalFileHandle]>
  values?(): AsyncIterable<LocalDirectoryHandle | LocalFileHandle>
  queryPermission?(
    descriptor?: PermissionDescriptor,
  ): Promise<PermissionStateValue>
  requestPermission?(
    descriptor?: PermissionDescriptor,
  ): Promise<PermissionStateValue>
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }) => Promise<LocalDirectoryHandle>
}

export type EventLogStorageRecord = {
  eventId: string
  path?: string
  yaml: string
}

const memoryHandles = new Map<string, LocalDirectoryHandle>()

function randomHandleId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) {
    return `folder_${cryptoApi.randomUUID()}`
  }
  return `folder_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IDB open failed'))
  })
}

async function withHandleStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openHandleDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const request = run(tx.objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(request.error ?? new Error('IDB request failed'))
      tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'))
    })
  } finally {
    db.close()
  }
}

async function storeDirectoryHandle(
  handleId: string,
  handle: LocalDirectoryHandle,
): Promise<void> {
  memoryHandles.set(handleId, handle)
  try {
    await withHandleStore('readwrite', (store) =>
      store.put({ id: handleId, handle }),
    )
  } catch {
    // Playwright test doubles are not structured-cloneable; keep them in memory.
  }
}

async function loadDirectoryHandle(
  handleId: string,
): Promise<LocalDirectoryHandle | null> {
  const memory = memoryHandles.get(handleId)
  if (memory) return memory
  try {
    const row = await withHandleStore<
      { handle?: LocalDirectoryHandle } | undefined
    >('readonly', (store) => store.get(handleId))
    return row?.handle ?? null
  } catch {
    return null
  }
}

export async function removeLocalFolderHandle(
  provider: StorageProvider,
): Promise<void> {
  const handleId = provider.localFolder?.handleId
  if (!handleId) return
  memoryHandles.delete(handleId)
  try {
    await withHandleStore('readwrite', (store) => store.delete(handleId))
  } catch {
    // Best effort cleanup; the provider row is the authoritative connection.
  }
}

export function isLocalFolderBackupSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
  )
}

async function ensureWritePermission(handle: LocalDirectoryHandle) {
  const descriptor = { mode: 'readwrite' as const }
  const current = await handle.queryPermission?.(descriptor)
  if (current === undefined || current === 'granted') return
  const requested = await handle.requestPermission?.(descriptor)
  if (requested !== 'granted') {
    throw new Error('Folder permission was not granted.')
  }
}

export async function chooseLocalFolderBackupDirectory(): Promise<LocalFolderConfig> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) {
    throw new Error('Local folder backup is not supported in this browser.')
  }
  const handle = await picker({
    id: 'nook-local-backup',
    mode: 'readwrite',
  })
  await ensureWritePermission(handle)
  const handleId = randomHandleId()
  await storeDirectoryHandle(handleId, handle)
  return {
    directoryName: handle.name,
    handleId,
  }
}

async function providerDirectoryHandle(
  provider: StorageProvider,
): Promise<LocalDirectoryHandle> {
  const handleId = provider.localFolder?.handleId
  if (!handleId) {
    throw new Error('Choose a local backup folder before syncing.')
  }
  const handle = await loadDirectoryHandle(handleId)
  if (!handle) {
    throw new Error('Reconnect this local backup folder before syncing.')
  }
  await ensureWritePermission(handle)
  return handle
}

async function childDirectory(
  parent: LocalDirectoryHandle,
  name: string,
  create: boolean,
): Promise<LocalDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name, { create })
  } catch {
    if (create) throw new Error(`Could not open backup folder: ${name}`)
    return null
  }
}

async function eventDirectory(
  root: LocalDirectoryHandle,
  create: boolean,
): Promise<LocalDirectoryHandle | null> {
  let current: LocalDirectoryHandle | null = root
  for (const part of EVENT_LOG_PARTS) {
    if (!current) return null
    current = await childDirectory(current, part, create)
  }
  return current
}

function eventIdFromFileName(name: string): string | null {
  const digest = name.match(EVENT_FILE_NAME_PATTERN)?.[1]
  return digest ? `sha256u:${digest}` : null
}

function eventFileName(record: EventLogStorageRecord): string {
  const digest = record.eventId.match(EVENT_ID_PATTERN)?.[1]
  if (!digest) {
    throw new Error(`Invalid event id: ${record.eventId}`)
  }
  return `${digest}.yaml`
}

async function eventFileEntries(
  dir: LocalDirectoryHandle,
): Promise<Array<[string, LocalFileHandle]>> {
  const entries: Array<[string, LocalFileHandle]> = []
  if (dir.entries) {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && eventIdFromFileName(name)) {
        entries.push([name, handle as LocalFileHandle])
      }
    }
    return entries
  }
  if (dir.values) {
    for await (const handle of dir.values()) {
      if (handle.kind === 'file' && eventIdFromFileName(handle.name)) {
        entries.push([handle.name, handle as LocalFileHandle])
      }
    }
  }
  return entries
}

export async function readLocalFolderEventRecords(
  provider: StorageProvider,
): Promise<EventLogStorageRecord[]> {
  const root = await providerDirectoryHandle(provider)
  const dir = await eventDirectory(root, false)
  if (!dir) return []
  const records: EventLogStorageRecord[] = []
  for (const [name, fileHandle] of await eventFileEntries(dir)) {
    const eventId = eventIdFromFileName(name)
    if (!eventId) continue
    const file = await fileHandle.getFile()
    records.push({
      eventId,
      path: `nook-log/v1/events/${name}`,
      yaml: await file.text(),
    })
  }
  return records.sort((left, right) =>
    left.eventId.localeCompare(right.eventId),
  )
}

export async function writeLocalFolderEventRecords(
  provider: StorageProvider,
  records: EventLogStorageRecord[],
): Promise<void> {
  const root = await providerDirectoryHandle(provider)
  const dir = await eventDirectory(root, true)
  if (!dir) return
  for (const record of records) {
    const name = eventFileName(record)
    const existing = await dir
      .getFileHandle(name, { create: false })
      .catch(() => null)
    if (existing) {
      const current = await (await existing.getFile()).text()
      if (current !== record.yaml) {
        throw new Error(
          `Backup event ${record.eventId} already exists with different content.`,
        )
      }
      continue
    }
    const file = await dir.getFileHandle(name, { create: true })
    const writable = await file.createWritable()
    await writable.write(record.yaml)
    await writable.close()
  }
}

export async function syncLocalFolderProvider(
  state: VaultState,
  provider: StorageProvider,
): Promise<void> {
  const remoteRecords = await readLocalFolderEventRecords(provider)
  const merged = (await state.enqueueStorage(() =>
    state.manager!.syncExternalEventLogRecords(remoteRecords),
  )) as EventLogStorageRecord[]
  await writeLocalFolderEventRecords(provider, merged)
  const localYaml = await readLocalVaultBlob().catch(() => '')
  if (localYaml.trim()) {
    await state.updateProviderSyncMetadata(provider.id, localYaml, null)
  }
}
