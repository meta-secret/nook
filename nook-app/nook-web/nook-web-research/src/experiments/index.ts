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
    slug: 'vault',
    title: 'Nexus Vault',
    description:
      'Create an in-memory threshold vault, define its policy, onboard participant public keys, and seal the genesis roster.',
  },
]

export const subcategories: ExperimentSubcategory[] = [
  {
    categorySlug: 'vault',
    slug: 'v1',
    title: 'V1 · Selected directions',
    description:
      'The strongest visual directions, now grounded in the Nexus name → N/K → public-key roster → atomic genesis flow.',
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
      'Evidence Room, Kintsugi Recovery, Access Choreography, and the new wallet-inspired Nexus Card Stack.',
  },
  {
    categorySlug: 'vault',
    slug: 'v4',
    title: 'V4 · Reference studies',
    description:
      "External interaction and visual references translated into Nook's Nexus genesis model.",
  },
]

const vault = categories[0]
const v1 = subcategories[0]
const v2 = subcategories[1]
const v3 = subcategories[2]
const v4 = subcategories[3]

export const experiments: Experiment[] = [
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
      'A keyboard-driven owner console for Nexus policy, public-key import, and atomic genesis.',
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
      'An ultra-minimal, one-decision-at-a-time Nexus genesis object.',
    component: BlackMonolith,
  },
  {
    slug: 'evidence-room',
    category: vault,
    subcategory: v3,
    title: 'Evidence room',
    description:
      'A forensic case file where every Nexus genesis prerequisite becomes a sealed exhibit.',
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
      'Nexus genesis staged as four precise movements performed by the vault owner.',
    component: AccessChoreography,
  },
  {
    slug: 'nexus-card-stack',
    category: vault,
    subcategory: v3,
    title: 'Nexus card stack',
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
