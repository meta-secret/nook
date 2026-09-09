import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  cloudKitRuntime,
  type CloudKitUserIdentity,
} from '$lib/auth/icloud/cloudkit-runtime'
import { CloudKitIdentityKind } from '$lib/auth/icloud/auth-state'

class CloudKitTransportFixture {
  readonly identity: CloudKitUserIdentity = { userRecordName: 'test-user' }
  async setUpAuth(): Promise<CloudKitUserIdentity | undefined> {
    return this.identity
  }
  async fetchCurrentUserIdentity(): Promise<CloudKitUserIdentity | undefined> {
    return this.identity
  }
  async whenUserSignsIn() {
    return this.identity
  }
  install(): void {
    vi.stubGlobal('CloudKit', {
      configure: vi.fn(),
      getDefaultContainer: () => this,
    })
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('CloudKit transport identity adapter', () => {
  test('normalizes both transport methods with their owning receivers', async () => {
    const transport = new CloudKitTransportFixture()
    transport.install()
    const admitted = cloudKitRuntime.getDefaultCloudKitContainer()
    expect(admitted.isOk()).toBe(true)
    if (admitted.isErr()) return
    const container = admitted.value
    const expected = {
      kind: CloudKitIdentityKind.SignedIn,
      identity: transport.identity,
    }
    expect(
      await container.setUpAuth({ grabAuthToken: true, persist: false }),
    ).toEqual(expected)
    expect(await container.fetchCurrentUserIdentity()).toEqual(expected)
  })

  test('normalizes empty identity responses to signed out', async () => {
    const transport = new CloudKitTransportFixture()
    transport.install()
    vi.spyOn(transport, 'setUpAuth').mockResolvedValue(undefined)
    vi.spyOn(transport, 'fetchCurrentUserIdentity').mockResolvedValue(undefined)
    const admitted = cloudKitRuntime.getDefaultCloudKitContainer()
    expect(admitted.isOk()).toBe(true)
    if (admitted.isErr()) return
    const container = admitted.value
    expect(
      await container.setUpAuth({ grabAuthToken: true, persist: false }),
    ).toEqual({ kind: CloudKitIdentityKind.SignedOut })
    expect(await container.fetchCurrentUserIdentity()).toEqual({
      kind: CloudKitIdentityKind.SignedOut,
    })
  })
})
