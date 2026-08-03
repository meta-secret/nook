/**
 * Which identity the Home act is offering to continue as.
 *
 * The enum lives in a module rather than the component script because the Vite
 * script preprocessor inlines enum member reads and then drops the enum
 * object, which leaves template references to it undefined at runtime.
 */
import {
  hereDevices,
  type KeyGraph,
  NodeKind,
  type NodeRef,
  type Passkey,
  Reach,
} from '../_shared/key-graph'

export enum LeadKind {
  /** @public No identity at all, so nothing to continue as. */
  None = 'none',
  /** @public Held somewhere this browser cannot reach right now. */
  Away = 'away',
  /** @public Present here, so Continue can act on it. */
  Ready = 'ready',
}

export type Lead =
  | { kind: LeadKind.None }
  | { kind: LeadKind.Away; passkey: Passkey }
  | { kind: LeadKind.Ready; passkey: Passkey }

export function usableHere(graph: KeyGraph, passkey: Passkey): boolean {
  return (
    passkey.reach === Reach.Here &&
    hereDevices(graph).some((device) => device.passkeyIds.includes(passkey.id))
  )
}

/** The picked identity when one is picked, otherwise the first that works. */
export function leadFor(graph: KeyGraph, selected: NodeRef): Lead {
  for (const passkey of graph.passkeys) {
    if (selected.kind === NodeKind.Passkey && selected.id === passkey.id) {
      return usableHere(graph, passkey)
        ? { kind: LeadKind.Ready, passkey }
        : { kind: LeadKind.Away, passkey }
    }
  }
  for (const passkey of graph.passkeys) {
    if (usableHere(graph, passkey)) return { kind: LeadKind.Ready, passkey }
  }
  return { kind: LeadKind.None }
}

export function leadId(lead: Lead): string {
  return lead.kind === LeadKind.None ? '' : lead.passkey.id
}
