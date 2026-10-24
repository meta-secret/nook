import { describe, expect, test } from 'bun:test'
import {
  NookSecretTypeFilter,
  type NookPersonalFillRequest,
  type NookPersonalFillResponse,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import {
  PersonalFillRevealOperation,
  PersonalRecordsListOperation,
  type PersonalFillVaultManager,
  type PersonalSecretListItem,
  type PersonalSecretPage,
} from '../src/offscreen/session-personal-fill-operations'

type PersonalRecordsRequest = ConstructorParameters<
  typeof PersonalRecordsListOperation
>[0]
type PersonalFillRequest = ConstructorParameters<
  typeof PersonalFillRevealOperation
>[0]
type PersonalGroupName = PersonalRecordsRequest['message']['payload']['group']
type SecretPageQuery = Parameters<
  PersonalFillVaultManager['query_secret_page_js']
>

enum VaultAdmission {
  Open = 'open',
  Refused = 'refused',
}

/** A stubbed unlocked vault manager holding personal records of each group. */
class PersonalVaultManagerFixture {
  readonly queries: SecretPageQuery[] = []
  readonly reveals: NookPersonalFillRequest[] = []
  readonly opened: string[] = []
  freedItems = 0
  freedPages = 0

  constructor(private readonly admission: VaultAdmission) {}

  private item(id: string): PersonalSecretListItem {
    return {
      id,
      displayTitle: `Title ${id}`,
      summary: `Summary ${id}`,
      free: () => {
        this.freedItems += 1
      },
    }
  }

  readonly manager: PersonalFillVaultManager = {
    open_extension_passkey_vault_js: async (vaultStoreId) => {
      this.opened.push(vaultStoreId)
      switch (this.admission) {
        case VaultAdmission.Open:
          return
        case VaultAdmission.Refused:
          throw new Error('vault not granted')
      }
    },
    query_secret_page_js: (...query) => {
      this.queries.push(query)
      const page: PersonalSecretPage = {
        take_items: () => [this.item('secret-a'), this.item('secret-b')],
        free: () => {
          this.freedPages += 1
        },
      }
      return page
    },
    reveal_personal_data_for_fill: async (request) => {
      this.reveals.push(request)
      const response: NookPersonalFillResponse = {
        values: [{ kind: 'GivenName', value: 'Ada' }],
      }
      return response
    },
  }

  listRequest(group: PersonalGroupName): PersonalRecordsRequest {
    return {
      message: {
        type: ExtensionSessionMessageType.ListPersonalRecords,
        payload: {
          vaultStoreId: 'vault',
          deviceId: 'device',
          devicePublicKey: 'public',
          deviceSigningPublicKey: 'signing',
          group,
          queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
        },
      },
      getManager: async () => this.manager,
    }
  }

  revealRequest(): PersonalFillRequest {
    return {
      message: {
        type: ExtensionSessionMessageType.RevealPersonalFill,
        payload: {
          vaultStoreId: 'vault',
          deviceId: 'device',
          devicePublicKey: 'public',
          deviceSigningPublicKey: 'signing',
          secretId: 'secret-a',
          group: 'Person',
          kinds: ['GivenName', 'Email'],
          queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
        },
      },
      getManager: async () => this.manager,
    }
  }
}

describe('offscreen personal-data session requests', () => {
  test.each([
    ['Person', NookSecretTypeFilter.Person],
    ['Address', NookSecretTypeFilter.Address],
    ['Card', NookSecretTypeFilter.CreditCard],
  ] as const)(
    'lists %s records through its own secret-type filter with metadata only',
    async (group, filter) => {
      const fixture = new PersonalVaultManagerFixture(VaultAdmission.Open)
      const listed = await new PersonalRecordsListOperation(
        fixture.listRequest(group),
      ).run()

      expect(fixture.opened).toEqual(['vault'])
      expect(fixture.queries).toEqual([
        ['', filter, 0, PersonalRecordsListOperation.PAGE_LIMIT],
      ])
      expect(listed.isOk()).toBe(true)
      expect(listed._unsafeUnwrap()).toEqual({
        ok: true,
        records: [
          {
            secretId: 'secret-a',
            title: 'Title secret-a',
            summary: 'Summary secret-a',
          },
          {
            secretId: 'secret-b',
            title: 'Title secret-b',
            summary: 'Summary secret-b',
          },
        ],
      })
      expect(fixture.freedItems).toBe(2)
      expect(fixture.freedPages).toBe(1)
    },
  )

  test('lists nothing when the grant does not open its vault', async () => {
    const fixture = new PersonalVaultManagerFixture(VaultAdmission.Refused)
    const listed = await new PersonalRecordsListOperation(
      fixture.listRequest('Address'),
    ).run()

    expect(listed.isErr()).toBe(true)
    expect(fixture.queries).toEqual([])
  })

  test('reveals only the requested record, group and kinds', async () => {
    const fixture = new PersonalVaultManagerFixture(VaultAdmission.Open)
    const revealed = await new PersonalFillRevealOperation(
      fixture.revealRequest(),
    ).run()

    expect(fixture.reveals).toEqual([
      { secretId: 'secret-a', group: 'Person', kinds: ['GivenName', 'Email'] },
    ])
    expect(revealed._unsafeUnwrap()).toEqual({
      ok: true,
      values: [{ kind: 'GivenName', value: 'Ada' }],
    })
  })

  test('reveals nothing when the grant does not open its vault', async () => {
    const fixture = new PersonalVaultManagerFixture(VaultAdmission.Refused)
    const revealed = await new PersonalFillRevealOperation(
      fixture.revealRequest(),
    ).run()

    expect(revealed.isErr()).toBe(true)
    expect(fixture.reveals).toEqual([])
  })
})
