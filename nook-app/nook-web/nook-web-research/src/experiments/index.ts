import type { Component } from 'svelte'
import AccessChoreography from './vault/access-choreography/Experiment.svelte'
import BlackMonolith from './vault/black-monolith/Experiment.svelte'
import CipherLedger from './vault/cipher-ledger/Experiment.svelte'
import CredentialAirlock from './vault/credential-airlock/Experiment.svelte'
import DistributedVaultPairing from './vault/distributed-vault-pairing/Experiment.svelte'
import EvidenceRoom from './vault/evidence-room/Experiment.svelte'
import KintsugiRecovery from './vault/kintsugi-recovery/Experiment.svelte'
import NexusCardStack from './vault/nexus-card-stack/Experiment.svelte'
import SealedCapsule from './vault/sealed-capsule/Experiment.svelte'
import SecureHardware from './vault/secure-hardware/Experiment.svelte'
import VaultTerminal from './vault/vault-terminal/Experiment.svelte'
import EmptyStudio from './nook-auth/empty-studio/Experiment.svelte'
import KeyLater from './nook-auth/key-later/Experiment.svelte'
import LandingHandoff from './nook-auth/landing-handoff/Experiment.svelte'
import LocalBoard from './nook-auth/local-board/Experiment.svelte'
import OneQuestion from './nook-auth/one-question/Experiment.svelte'
import SealedPresence from './nook-auth/sealed-presence/Experiment.svelte'
import SentinelConsole from './nook-auth/sentinel-console/Experiment.svelte'
import SentinelDeck from './nook-auth/sentinel-deck/Experiment.svelte'
import TwoFoundations from './nook-auth/two-foundations/Experiment.svelte'
import WhatsThere from './nook-auth/whats-there/Experiment.svelte'

export interface ExperimentProps {
  navigate: (path: string) => void
}

export interface Experiment {
  slug: string
  category: ExperimentCategory
  subcategory: ExperimentSubcategory
  title: string
  description: string
  component: Component<ExperimentProps>
}

export interface ExperimentCategory {
  slug: string
  title: string
  description: string
}

export interface ExperimentSubcategory {
  categorySlug: string
  slug: 'v1' | 'v2' | 'v3' | 'v4'
  title: string
  description: string
}

export const categories: ExperimentCategory[] = [
  {
    slug: 'nook-auth',
    title: 'Nook Auth',
    description:
      'Fresh Open Nook entry: show what exists, unlock existing vaults, choose Simple vs Sentinel on empty state, and defer passkey until it has a reason.',
  },
  {
    slug: 'vault',
    title: 'Sentinel Vault',
    description:
      'Create an in-memory threshold vault, define its policy, onboard participant public keys, and seal the genesis roster.',
  },
]

export const subcategories: ExperimentSubcategory[] = [
  {
    categorySlug: 'nook-auth',
    slug: 'v1',
    title: 'V1 · Presence-first concepts',
    description:
      'Ten directions for the post-landing Open Nook moment. Toggle Empty / Vault exists in each sketch.',
  },
  {
    categorySlug: 'vault',
    slug: 'v1',
    title: 'V1 · Selected directions',
    description:
      'The strongest visual directions, now grounded in the Sentinel name → N/K → public-key roster → atomic genesis flow.',
  },
  {
    categorySlug: 'vault',
    slug: 'v2',
    title: 'V2 · Selected directions',
    description:
      'The precision of Credential Airlock and the restraint of Black Monolith.',
  },
  {
    categorySlug: 'vault',
    slug: 'v3',
    title: 'V3 · Selected directions',
    description:
      'Evidence Room, Kintsugi Recovery, Access Choreography, and the wallet-inspired card stack.',
  },
  {
    categorySlug: 'vault',
    slug: 'v4',
    title: 'V4 · Reference studies',
    description:
      "External interaction and visual references translated into Nook's Sentinel genesis model.",
  },
]

const auth = categories[0]
const vault = categories[1]
const authV1 = subcategories[0]
const v1 = subcategories[1]
const v2 = subcategories[2]
const v3 = subcategories[3]
const v4 = subcategories[4]

export const experiments: Experiment[] = [
  {
    slug: 'whats-there',
    category: auth,
    subcategory: authV1,
    title: "What's there?",
    description:
      'Literal presence inventory: empty chooser vs unlock an existing sealed vault.',
    component: WhatsThere,
  },
  {
    slug: 'landing-handoff',
    category: auth,
    subcategory: authV1,
    title: 'Landing handoff',
    description:
      'Continues the nokey.sh voice into Open Nook without a passkey wall.',
    component: LandingHandoff,
  },
  {
    slug: 'two-foundations',
    category: auth,
    subcategory: authV1,
    title: 'Two foundations',
    description:
      'Dark foundation picker: Simple vs Sentinel before any device ceremony.',
    component: TwoFoundations,
  },
  {
    slug: 'sealed-presence',
    category: auth,
    subcategory: authV1,
    title: 'Sealed presence',
    description:
      'Existing vault as a sealed capsule; empty state as a dashed chamber.',
    component: SealedPresence,
  },
  {
    slug: 'empty-studio',
    category: auth,
    subcategory: authV1,
    title: 'Empty studio',
    description:
      'Warm studio metaphor: draft Simple or Sentinel on a clean bench.',
    component: EmptyStudio,
  },
  {
    slug: 'key-later',
    category: auth,
    subcategory: authV1,
    title: 'Key later',
    description:
      'Step timeline that keeps passkey as the last understanding, not the lobby.',
    component: KeyLater,
  },
  {
    slug: 'sentinel-console',
    category: auth,
    subcategory: authV1,
    title: 'Sentinel console entry',
    description:
      'Presence menu that hands off into the vault-terminal Sentinel UI.',
    component: SentinelConsole,
  },
  {
    slug: 'sentinel-deck',
    category: auth,
    subcategory: authV1,
    title: 'Sentinel deck entry',
    description:
      'Presence menu that hands off into the card-stack Sentinel builder.',
    component: SentinelDeck,
  },
  {
    slug: 'one-question',
    category: auth,
    subcategory: authV1,
    title: 'One question',
    description:
      'Ultra-minimal single question: unlock, or build Simple / Sentinel.',
    component: OneQuestion,
  },
  {
    slug: 'local-board',
    category: auth,
    subcategory: authV1,
    title: 'Local board',
    description:
      'Ops-style local status board that recommends create or unlock.',
    component: LocalBoard,
  },
  {
    slug: 'cipher-ledger',
    category: vault,
    subcategory: v1,
    title: 'Cipher ledger',
    description:
      'An editorial genesis folio for naming the draft, inscribing N/K, and registering participant keys.',
    component: CipherLedger,
  },
  {
    slug: 'vault-terminal',
    category: vault,
    subcategory: v1,
    title: 'Vault terminal',
    description:
      'A keyboard-driven owner console for Sentinel policy, public-key import, and atomic genesis.',
    component: VaultTerminal,
  },
  {
    slug: 'secure-hardware',
    category: vault,
    subcategory: v1,
    title: 'Secure hardware module',
    description:
      'A tactile threshold appliance with key slots, policy controls, and a physical genesis interlock.',
    component: SecureHardware,
  },
  {
    slug: 'sealed-capsule',
    category: vault,
    subcategory: v1,
    title: 'Sealed capsule · landing favorite',
    description:
      'The preferred landing-page direction: one quiet, protected data capsule.',
    component: SealedCapsule,
  },
  {
    slug: 'credential-airlock',
    category: vault,
    subcategory: v2,
    title: 'Credential airlock',
    description:
      'Four explicit chambers for name, N/K policy, manual key intake, and atomic genesis.',
    component: CredentialAirlock,
  },
  {
    slug: 'black-monolith',
    category: vault,
    subcategory: v2,
    title: 'Black monolith',
    description:
      'An ultra-minimal, one-decision-at-a-time Sentinel genesis object.',
    component: BlackMonolith,
  },
  {
    slug: 'evidence-room',
    category: vault,
    subcategory: v3,
    title: 'Evidence room',
    description:
      'A forensic case file where every Sentinel genesis prerequisite becomes a sealed exhibit.',
    component: EvidenceRoom,
  },
  {
    slug: 'kintsugi-recovery',
    category: vault,
    subcategory: v3,
    title: 'Kintsugi recovery',
    description:
      'Independent participant public keys become the visible boundaries of one threshold vault.',
    component: KintsugiRecovery,
  },
  {
    slug: 'access-choreography',
    category: vault,
    subcategory: v3,
    title: 'Access choreography',
    description:
      'Sentinel genesis staged as four precise movements performed by the vault owner.',
    component: AccessChoreography,
  },
  {
    slug: 'nexus-card-stack',
    category: vault,
    subcategory: v3,
    title: 'Sentinel card stack',
    description:
      'A dark wallet-inspired control surface where participant keys become a selectable cryptographic card stack.',
    component: NexusCardStack,
  },
  {
    slug: 'distributed-vault-pairing',
    category: vault,
    subcategory: v4,
    title: 'Distributed vault pairing',
    description:
      'A restrained dark operations console for K-of-N policy and participant public-key onboarding.',
    component: DistributedVaultPairing,
  },
]
