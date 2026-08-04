export const identities = [
  {
    id: 'idn_7c9d',
    label: 'Nora',
    description: 'Personal identity',
    devices: [
      {
        id: 'macbook',
        label: 'MacBook',
        installations: [
          { id: 'dev_72c1', label: 'Chrome', publicKey: 'age1q8…6m4k', added: '18 Jun' },
          { id: 'dev_91ba', label: 'Extension', publicKey: 'age1m2…q7ad', added: '02 Jul' },
        ],
      },
      {
        id: 'iphone',
        label: 'iPhone',
        installations: [
          { id: 'dev_b091', label: 'Nook', publicKey: 'age1kp…8zc2', added: '22 Jun' },
        ],
      },
      {
        id: 'home',
        label: 'Home computer',
        installations: [
          { id: 'dev_339a', label: 'Chrome', publicKey: 'age1vr…2xk8', added: '03 Jul' },
        ],
      },
    ],
  },
  {
    id: 'idn_a2e6',
    label: 'Northstar studio',
    description: 'Collective identity',
    devices: [
      {
        id: 'studio',
        label: 'Studio workstation',
        installations: [
          { id: 'dev_8e52', label: 'Firefox', publicKey: 'age1zu…3tf9', added: '09 May' },
        ],
      },
      {
        id: 'studio-macbook',
        label: 'MacBook',
        installations: [
          { id: 'dev_f12c', label: 'Chrome', publicKey: 'age1hc…5nm1', added: '27 Jun' },
        ],
      },
    ],
  },
  {
    id: 'idn_f014',
    label: 'Field notes',
    description: 'Personal identity',
    devices: [
      {
        id: 'field-phone',
        label: 'iPhone',
        installations: [
          { id: 'dev_4fa8', label: 'Nook', publicKey: 'age1bd…7pk3', added: '14 Jul' },
        ],
      },
    ],
  },
] as const

export const vaults = [
  {
    id: 'vlt_home',
    label: 'Home',
    description: 'Simple vault',
    itemCount: 48,
  },
  {
    id: 'vlt_northstar',
    label: 'Northstar archive',
    description: 'Sentinel vault',
    itemCount: 126,
  },
  {
    id: 'vlt_shared',
    label: 'Shared credentials',
    description: 'Sentinel vault',
    itemCount: 18,
  },
  {
    id: 'vlt_field',
    label: 'Field notebook',
    description: 'Simple vault',
    itemCount: 9,
  },
] as const

export const accessGrants = [
  { id: 'grant_nora_home', identityId: 'idn_7c9d', vaultId: 'vlt_home', role: 'Owner' },
  {
    id: 'grant_nora_shared',
    identityId: 'idn_7c9d',
    vaultId: 'vlt_shared',
    role: 'Member',
  },
  {
    id: 'grant_northstar_archive',
    identityId: 'idn_a2e6',
    vaultId: 'vlt_northstar',
    role: 'Owner',
  },
  {
    id: 'grant_northstar_shared',
    identityId: 'idn_a2e6',
    vaultId: 'vlt_shared',
    role: 'Member',
  },
  {
    id: 'grant_field_notebook',
    identityId: 'idn_f014',
    vaultId: 'vlt_field',
    role: 'Owner',
  },
] as const

export type Identity = (typeof identities)[number]
export type Vault = (typeof vaults)[number]
export type AccessGrant = (typeof accessGrants)[number]

export function identityById(id: string): Identity {
  const identity = identities.find((candidate) => candidate.id === id)
  if (identity) return identity
  throw new Error(`Unknown identity fixture: ${id}`)
}

export function vaultById(id: string): Vault {
  const vault = vaults.find((candidate) => candidate.id === id)
  if (vault) return vault
  throw new Error(`Unknown vault fixture: ${id}`)
}

export function grantsForIdentity(identityId: string): AccessGrant[] {
  return accessGrants.filter((grant) => grant.identityId === identityId)
}

export function grantsForVault(vaultId: string): AccessGrant[] {
  return accessGrants.filter((grant) => grant.vaultId === vaultId)
}
