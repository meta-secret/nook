import { vi } from 'vitest'
import type { CloudKitUserIdentity } from '$lib/auth/icloud/cloudkit-runtime'

/** Owns checked access to the optional CloudKit host installed by these tests. */
export class ICloudOAuthTestFixture {
  static resolvedSignedOutIdentity() {
    const identity: CloudKitUserIdentity = {}
    Object.defineProperty(identity, 'userRecordName', {
      value: Symbol('invalid CloudKit user record name'),
    })
    return vi.fn(async () => identity)
  }

  static cloudKit(): NonNullable<typeof window.CloudKit> {
    const cloudKit = window.CloudKit
    if (!cloudKit) throw new Error('CloudKit test global is not installed')
    return cloudKit
  }

  static firstConfigureRequest() {
    const [call] = vi.mocked(this.cloudKit().configure).mock.calls
    if (!call) throw new Error('CloudKit configure was not called')
    const [request] = call
    if (!request) throw new Error('CloudKit configure request is absent')
    return request
  }

  static useContainer(
    container: ReturnType<
      NonNullable<typeof window.CloudKit>['getDefaultContainer']
    >,
  ): void {
    vi.mocked(this.cloudKit().getDefaultContainer).mockReturnValue(container)
  }
}
