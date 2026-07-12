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
import KeyLater from './nook-auth/key-later/Experiment.svelte'
import LandingHandoff from './nook-auth/landing-handoff/Experiment.svelte'
import OneQuestion from './nook-auth/one-question/Experiment.svelte'
import WhatsThere from './nook-auth/whats-there/Experiment.svelte'
import KeyLaterSentinelCardStack from './vault-auth-workflow/key-later-sentinel-card-stack/Experiment.svelte'
import LandingSentinelCardStack from './vault-auth-workflow/landing-sentinel-card-stack/Experiment.svelte'

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
      'Presence-first Open Nook entry concepts. Empty vs unlock, Simple vs Sentinel, deferred passkey.',
  },
  {
    slug: 'vault-auth-workflow',
    title: 'Vault Auth Workflow',
    description:
      'End-to-end auth → Sentinel setup. Key later and Landing both use: name vault → Simple or Sentinel → card stack (default) or vault terminal.',
  },
  {
    slug: 'vault',
    title: 'Sentinel Vault',
    description:
      'Standalone threshold vault genesis directions — policy, participant keys, and seal.',
  },
]

export const subcategories: ExperimentSubcategory[] = [
  {
    categorySlug: 'nook-auth',
    slug: 'v1',
    title: 'V1 · Shortlist',
    description:
      'Four kept directions. Toggle Empty / Vault exists in each sketch.',
  },
  {
    categorySlug: 'vault-auth-workflow',
    slug: 'v1',
    title: 'V1 · Auth → Sentinel',
    description:
      'Click Build Sentinel vault to enter the adopted full UI. Card stack is the default destination; terminal is the alternate.',
  },
  {
    categorySlug: 'vault',
    slug: 'v1',
    title: 'V1 · Selected directions',
    description:
      'The strongest visual directions for Sentinel genesis.',
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
const workflow = categories[1]
const vault = categories[2]
const authV1 = subcategories[0]
const workflowV1 = subcategories[1]
const v1 = subcategories[2]
const v2 = subcategories[3]
const v3 = subcategories[4]
const v4 = subcategories[5]

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
    slug: 'key-later',
    category: auth,
    subcategory: authV1,
    title: 'Key later',
    description:
      'Step timeline that keeps passkey as the last understanding, not the lobby.',
    component: KeyLater,
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
    slug: 'key-later-sentinel-card-stack',
    category: workflow,
    subcategory: workflowV1,
    title: 'Key later → Sentinel workflow · preferred',
    description:
      'Key later auth. Name vault → choose Simple or Sentinel → Simple create, or Sentinel interface (card stack / terminal).',
    component: KeyLaterSentinelCardStack,
  },
  {
    slug: 'landing-sentinel-card-stack',
    category: workflow,
    subcategory: workflowV1,
    title: 'Landing → Sentinel workflow',
    description:
      'Landing handoff auth. Same steps as Key later: name vault → Simple or Sentinel → card stack / terminal.',
    component: LandingSentinelCardStack,
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
