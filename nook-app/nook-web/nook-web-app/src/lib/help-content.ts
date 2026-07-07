/** User-facing product help — keep in sync with .cortex/design-docs/unified-vault.md */

export type HelpSection = {
  id: string
  bulletCount: number
  diagram?: (t: (key: string) => string) => string
}

/** Mermaid source for the local-first vault model (rendered in Help). */
export function helpArchitectureDiagram(t: (key: string) => string): string {
  return `flowchart TB
  subgraph device["${t('help.diagram.device')}"]
    V[${t('help.diagram.local_projection')}]
    E[${t('help.diagram.event_store')}]
    K[${t('help.diagram.device_keys')}]
  end
  subgraph sync["${t('help.diagram.sync')}"]
    G[${t('help.diagram.nook_log')}]
    D[${t('help.diagram.provider_events')}]
  end
  E <-->|${t('help.diagram.set_union')}| G
  E <-->|${t('help.diagram.set_union')}| D
  E --> V
  K --> V`
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'local-first',
    bulletCount: 4,
    diagram: helpArchitectureDiagram,
  },
  {
    id: 'unlock',
    bulletCount: 4,
  },
  {
    id: 'sync',
    bulletCount: 4,
  },
  {
    id: 'conflicts',
    bulletCount: 4,
  },
  {
    id: 'onboard',
    bulletCount: 4,
  },
  {
    id: 'join',
    bulletCount: 3,
  },
  {
    id: 'technical',
    bulletCount: 4,
  },
]
