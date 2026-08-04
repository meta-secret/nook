import type { Component } from 'svelte'
import AccessChoreography from './vault/access-choreography/Experiment.svelte'
import CipherLedger from './vault/cipher-ledger/Experiment.svelte'
import CredentialAirlock from './vault/credential-airlock/Experiment.svelte'
import DistributedVaultPairing from './vault/distributed-vault-pairing/Experiment.svelte'
import EvidenceRoom from './vault/evidence-room/Experiment.svelte'
import SentinelCardStack from './vault/sentinel-card-stack/Experiment.svelte'
import SealedCapsule from './vault/sealed-capsule/Experiment.svelte'
import VaultTerminal from './vault/vault-terminal/Experiment.svelte'
import KeyLater from './nook-auth/key-later/Experiment.svelte'
import LandingHandoff from './nook-auth/landing-handoff/Experiment.svelte'
import OneQuestion from './nook-auth/one-question/Experiment.svelte'
import WhatsThere from './nook-auth/whats-there/Experiment.svelte'
import KeyLaterSentinelCardStack from './vault-auth-workflow/key-later-sentinel-card-stack/Experiment.svelte'
import LandingSentinelCardStack from './vault-auth-workflow/landing-sentinel-card-stack/Experiment.svelte'
import IdentityChainStrength from './identity-management/identity-chain-strength/Experiment.svelte'
import IdentitySpectrum from './identity-management/identity-spectrum/Experiment.svelte'
import AccessTerminal from './keys-management/access-terminal/Experiment.svelte'
import ChainStrength from './keys-management/chain-strength/Experiment.svelte'
import IdentityConsole from './keys-management/identity-console/Experiment.svelte'
import KeyIndex from './keys-management/key-index/Experiment.svelte'
import MissionControl from './keys-management/mission-control/Experiment.svelte'
import FrozenAccessTerminal from './inspiration/access-terminal/Experiment.svelte'
import FrozenChainIdentities from './inspiration/chain-identities/Experiment.svelte'
import FrozenChainStrength from './inspiration/chain-strength/Experiment.svelte'
import HandoffStory from './inspiration/handoff-story/Experiment.svelte'

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

enum ExperimentVersion {
  V1 = 'v1',
  V2 = 'v2',
  V3 = 'v3',
  V4 = 'v4',
}

export interface ExperimentSubcategory {
  categorySlug: string
  slug: ExperimentVersion
  title: string
  description: string
}

export const categories: ExperimentCategory[] = [
  {
    slug: 'identity-management',
    title: 'Identity Management',
    description:
      'Independent identity device key management paired with visual vault-identity relationship topology.',
  },
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
  {
    slug: 'keys-management',
    title: 'Keys Management',
    description:
      'Which of my passkeys opens this vault, and can I use it from this browser? Every sketch draws the same graph of passkeys, device keys, and vaults, shows the identifiers you would compare against a password manager, and supports three passkeys / one passkey / new browser.',
  },
  {
    slug: 'inspiration',
    title: 'Inspiration',
    description:
      'Sketches kept unchanged for their interaction or visual idea, not as candidates. They may read older fixtures.',
  },
]

export const subcategories: ExperimentSubcategory[] = [
  {
    categorySlug: 'identity-management',
    slug: ExperimentVersion.V1,
    title: 'V1 · Identity Concepts',
    description:
      'Sketches separating device key breakdown from vault entitlement and quorum relationships.',
  },
  {
    categorySlug: 'nook-auth',
    slug: ExperimentVersion.V1,
    title: 'V1 · Shortlist',
    description:
      'Four kept directions. Toggle Empty / Vault exists in each sketch.',
  },
  {
    categorySlug: 'vault-auth-workflow',
    slug: ExperimentVersion.V1,
    title: 'V1 · Auth → Sentinel',
    description:
      'Click Build Sentinel vault to enter the adopted full UI. Card stack is the default destination; terminal is the alternate.',
  },
  {
    categorySlug: 'vault',
    slug: ExperimentVersion.V1,
    title: 'V1 · Selected directions',
    description: 'The strongest visual directions for Sentinel genesis.',
  },
  {
    categorySlug: 'vault',
    slug: ExperimentVersion.V2,
    title: 'V2 · Selected directions',
    description:
      'The precision of Credential Airlock and the restraint of Black Monolith.',
  },
  {
    categorySlug: 'vault',
    slug: ExperimentVersion.V3,
    title: 'V3 · Selected directions',
    description:
      'Evidence Room, Kintsugi Recovery, Access Choreography, and the wallet-inspired card stack.',
  },
  {
    categorySlug: 'vault',
    slug: ExperimentVersion.V4,
    title: 'V4 · Reference studies',
    description:
      "External interaction and visual references translated into Nook's Sentinel genesis model.",
  },
  {
    categorySlug: 'keys-management',
    slug: ExperimentVersion.V1,
    title: 'V1 · Show possession',
    description:
      'Containment and inventory: what holds what, and what you own in total.',
  },
  {
    categorySlug: 'keys-management',
    slug: ExperimentVersion.V2,
    title: 'V2 · Draw the relationship',
    description:
      'Wiring diagrams. Select any node and only what it actually reaches stays lit.',
  },
  {
    categorySlug: 'keys-management',
    slug: ExperimentVersion.V3,
    title: 'V3 · Inspect the evidence',
    description:
      'Operator density: consoles and artifacts that put identifiers side by side.',
  },
  {
    categorySlug: 'keys-management',
    slug: ExperimentVersion.V4,
    title: 'V4 · Identity first',
    description:
      "Internet Identity's architecture applied to Nook: one passkey is one identity, and access is a list of them.",
  },
  {
    categorySlug: 'inspiration',
    slug: ExperimentVersion.V1,
    title: 'V1 · Kept as-is',
    description:
      'Frozen references. Do not iterate on these; borrow from them instead.',
  },
]

const identityMgmt = categories.find((c) => c.slug === 'identity-management')!
const auth = categories.find((c) => c.slug === 'nook-auth')!
const workflow = categories.find((c) => c.slug === 'vault-auth-workflow')!
const vault = categories.find((c) => c.slug === 'vault')!
const keys = categories.find((c) => c.slug === 'keys-management')!
const inspiration = categories.find((c) => c.slug === 'inspiration')!

const identityMgmtV1 = subcategories.find(
  (s) => s.categorySlug === 'identity-management' && s.slug === ExperimentVersion.V1,
)!
const authV1 = subcategories.find(
  (s) => s.categorySlug === 'nook-auth' && s.slug === ExperimentVersion.V1,
)!
const workflowV1 = subcategories.find(
  (s) => s.categorySlug === 'vault-auth-workflow' && s.slug === ExperimentVersion.V1,
)!
const v1 = subcategories.find(
  (s) => s.categorySlug === 'vault' && s.slug === ExperimentVersion.V1,
)!
const v2 = subcategories.find(
  (s) => s.categorySlug === 'vault' && s.slug === ExperimentVersion.V2,
)!
const v3 = subcategories.find(
  (s) => s.categorySlug === 'vault' && s.slug === ExperimentVersion.V3,
)!
const v4 = subcategories.find(
  (s) => s.categorySlug === 'vault' && s.slug === ExperimentVersion.V4,
)!
const keysV1 = subcategories.find(
  (s) => s.categorySlug === 'keys-management' && s.slug === ExperimentVersion.V1,
)!
const keysV2 = subcategories.find(
  (s) => s.categorySlug === 'keys-management' && s.slug === ExperimentVersion.V2,
)!
const keysV3 = subcategories.find(
  (s) => s.categorySlug === 'keys-management' && s.slug === ExperimentVersion.V3,
)!
const keysV4 = subcategories.find(
  (s) => s.categorySlug === 'keys-management' && s.slug === ExperimentVersion.V4,
)!
const inspirationV1 = subcategories.find(
  (s) => s.categorySlug === 'inspiration' && s.slug === ExperimentVersion.V1,
)!

export const experiments: Experiment[] = [
  {
    slug: 'identity-chain-strength',
    category: identityMgmt,
    subcategory: identityMgmtV1,
    title: 'Identity chain strength',
    description:
      'Adapted from chain-strength: Part 1 lists independent identities with devices & keys; Part 2 visually separates vault-identity quorum relationships.',
    component: IdentityChainStrength,
  },
  {
    slug: 'identity-spectrum',
    category: identityMgmt,
    subcategory: identityMgmtV1,
    title: 'Identity spectrum',
    description:
      'Swiss grid & typography: independent identity device key rosters above, visually separate vault entitlement ledger below.',
    component: IdentitySpectrum,
  },
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
    slug: 'evidence-room',
    category: vault,
    subcategory: v3,
    title: 'Evidence room',
    description:
      'A forensic case file where every Sentinel genesis prerequisite becomes a sealed exhibit.',
    component: EvidenceRoom,
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
    slug: 'sentinel-card-stack',
    category: vault,
    subcategory: v3,
    title: 'Sentinel card stack',
    description:
      'A dark wallet-inspired control surface where participant keys become a selectable cryptographic card stack.',
    component: SentinelCardStack,
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
  {
    slug: 'key-index',
    category: keys,
    subcategory: keysV1,
    title: 'Key index',
    description:
      'Your device stands at the head of a permanent index; selecting anything answers in plain identifier chips.',
    component: KeyIndex,
  },
  {
    slug: 'mission-control',
    category: keys,
    subcategory: keysV3,
    title: 'Mission control',
    description:
      'A status board: one line per vault, counting passkeys, how many work from here, and enrolled devices.',
    component: MissionControl,
  },
  {
    slug: 'chain-strength',
    category: keys,
    subcategory: keysV3,
    title: 'Chain strength',
    description:
      'Identities are rounded tags, vaults are boxes. Each vault leads its row and its ways in fan out to the right.',
    component: ChainStrength,
  },
  {
    slug: 'access-terminal',
    category: keys,
    subcategory: keysV3,
    title: 'Access terminal',
    description:
      'Keyboard-first console. Query an identifier, or print the whole thing as vault-centric ASCII.',
    component: AccessTerminal,
  },
  {
    slug: 'identity-console',
    category: keys,
    subcategory: keysV4,
    title: 'Identity console',
    description:
      'Three acts on a rail: continue as an identity, read every passkey by its manager, see which one opens what.',
    component: IdentityConsole,
  },
  {
    slug: 'frozen-chain-strength',
    category: inspiration,
    subcategory: inspirationV1,
    title: 'Chain strength · kept',
    description:
      'The strand rope before the identity band, with passkeys and vaults listed on the device panel itself.',
    component: FrozenChainStrength,
  },
  {
    slug: 'frozen-chain-identities',
    category: inspiration,
    subcategory: inspirationV1,
    title: 'Chain strength · identity band',
    description:
      'Identity cards over the strand rope, passkeys still on the right of each vault.',
    component: FrozenChainIdentities,
  },
  {
    slug: 'frozen-access-terminal',
    category: inspiration,
    subcategory: inspirationV1,
    title: 'Access terminal · kept',
    description:
      'Query the graph by identifier and print it as ASCII. Frozen before iteration.',
    component: FrozenAccessTerminal,
  },
  {
    slug: 'handoff-story',
    category: inspiration,
    subcategory: inspirationV1,
    title: 'Handoff story',
    description:
      'Kept for its act rail: a fixed index that keeps the whole set visible while you read one part.',
    component: HandoffStory,
  },
]
