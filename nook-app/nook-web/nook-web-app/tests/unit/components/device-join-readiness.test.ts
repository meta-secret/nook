import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, { ReplicationType } from '$app-wasm'
import {
  providerPersistenceDefaults,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
} from '$lib/auth/providers'
import {
  DeviceJoinAvailability,
  DeviceJoinReadiness,
} from '$lib/components/add-device/device-join-mounts'

beforeAll(async () => {
  await initNookWasm()
})

function githubProvider(): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'github-1',
    type: 'github',
    label: 'GitHub',
    githubRepo: storedGithubRepository('nook-vault'),
    githubPat: storedGithubPat('github_pat_test'),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-10-16T00:00:00.000Z',
  }
}

type ReadinessCase = {
  readonly providers: readonly StorageProvider[]
  readonly providersLoaded: boolean
}

function availability({
  providers,
  providersLoaded,
}: ReadinessCase): DeviceJoinAvailability {
  const request: ConstructorParameters<typeof DeviceJoinReadiness>[0] = {
    providers,
    providersLoaded,
    replication: ReplicationType.Personal,
  }
  return new DeviceJoinReadiness(request).availability
}

describe('device join readiness', () => {
  test('stays unknown until the sync providers load, so nothing locks early', () => {
    const loading: ReadinessCase = { providers: [], providersLoaded: false }
    expect(availability(loading)).toBe(DeviceJoinAvailability.Unknown)
  })

  test('needs a cloud sync provider before a device can join', () => {
    const none: ReadinessCase = { providers: [], providersLoaded: true }
    expect(availability(none)).toBe(DeviceJoinAvailability.NeedsCloud)
  })

  test('is ready once a cloud provider can carry the join', () => {
    const cloud: ReadinessCase = {
      providers: [githubProvider()],
      providersLoaded: true,
    }
    expect(availability(cloud)).toBe(DeviceJoinAvailability.Ready)
  })
})
