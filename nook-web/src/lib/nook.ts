import type {
  NookVaultManager,
  WasmWorkspaceProject,
  NookSecretRecord,
} from './nook-wasm/nook_wasm'

export type NookProject = {
  name: string
  purpose: string
  language: string
}

export type NookSnapshot = {
  summary: string
  projects: NookProject[]
}

export type SecretRecord = {
  key: string
  value: string
}

export async function loadNookSnapshot(): Promise<NookSnapshot> {
  const wasm = await import('./nook-wasm/nook_wasm.js')
  await wasm.default()

  const rawProjects = wasm.workspaceProjects() as WasmWorkspaceProject[]
  const projects: NookProject[] = rawProjects.map((p) => ({
    name: p.name,
    purpose: p.purpose,
    language: p.language,
  }))

  return {
    summary: wasm.projectSummary(),
    projects,
  }
}

export async function getVaultManager(): Promise<NookVaultManager> {
  const wasm = await import('./nook-wasm/nook_wasm.js')
  await wasm.default()
  return new wasm.NookVaultManager()
}

export function mapWasmRecords(rawRecords: NookSecretRecord[]): SecretRecord[] {
  return rawRecords.map((r) => ({
    key: r.key,
    value: r.value,
  }))
}
