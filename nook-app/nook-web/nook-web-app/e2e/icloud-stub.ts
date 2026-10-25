import type { Page } from '@playwright/test'
import type { ICloudShareRole, ICloudSharedTarget } from '$app-wasm'
import { requireRecord } from './helpers/guards'

const DEFAULT_FILE_NAME = 'nook-events'

/** The CloudKit share every e2e iCloud provider syncs through. */
export const E2E_ICLOUD_SHARE = {
  zoneName: 'nook-e2e-shared-zone',
  ownerRecordName: '_e2e-owner-record',
  rootRecordName: 'nook-e2e-shared-root',
  shortGuid: 'e2e-share-guid',
  shareRecordName: 'nook-e2e-share',
} as const

/** The `icloud-share-v1:{…}` storage id a provider saved with `role`. */
export function e2eICloudShareTarget(role: ICloudShareRole): string {
  const target: ICloudSharedTarget = {
    role,
    zoneName: E2E_ICLOUD_SHARE.zoneName,
    ownerRecordName: E2E_ICLOUD_SHARE.ownerRecordName,
    rootRecordName: E2E_ICLOUD_SHARE.rootRecordName,
    shortGuid: E2E_ICLOUD_SHARE.shortGuid,
  }
  return `icloud-share-v1:${JSON.stringify(target)}`
}

/** One participant of the e2e CloudKit share, as CloudKit JS reports it. */
export enum E2eCloudKitParticipantType {
  Owner = 'OWNER',
  PrivateUser = 'PRIVATE_USER',
}

export enum E2eCloudKitPermission {
  ReadWrite = 'READ_WRITE',
  ReadOnly = 'READ_ONLY',
}

export enum E2eCloudKitAcceptance {
  Accepted = 'ACCEPTED',
  Invited = 'INVITED',
  Pending = 'PENDING',
}

export type E2eICloudShareParticipant = {
  readonly email: string
  readonly type: E2eCloudKitParticipantType
  readonly permission: E2eCloudKitPermission
  readonly acceptanceStatus: E2eCloudKitAcceptance
}

/**
 * Stub CloudKit JS for the e2e share: the owner reaches the share's zone
 * through its private database, a participant through its shared database.
 * `fetchRecords` returns the root record naming its share and the share
 * record listing `participants`. The database the app used is reported on
 * `<html data-e2e-cloudkit-share-database>`; `shareWithUI` calls are counted
 * on `<html data-e2e-cloudkit-share-ui>`.
 */
export async function installCloudKitShareStub(
  page: Page,
  participants: readonly E2eICloudShareParticipant[],
) {
  await page.addInitScript(
    ({ share, shareParticipants }) => {
      const database = (name: string) => ({
        fetchRecords: async (
          records: readonly { recordName: string }[],
          options: { zoneID: { zoneName: string } },
        ) => {
          document.documentElement.setAttribute(
            'data-e2e-cloudkit-share-database',
            name,
          )
          if (options.zoneID.zoneName !== share.zoneName) {
            throw { serverErrorCode: 'ZONE_NOT_FOUND' }
          }
          const [requested = { recordName: '' }] = records
          if (requested.recordName === share.rootRecordName) {
            return {
              records: [
                {
                  recordName: share.rootRecordName,
                  recordType: 'NookVaultRoot',
                  share: { recordName: share.shareRecordName },
                },
              ],
            }
          }
          if (requested.recordName === share.shareRecordName) {
            return {
              records: [
                {
                  recordName: share.shareRecordName,
                  recordType: 'cloudkit.share',
                  participants: shareParticipants.map((participant, index) => ({
                    participantId: `e2e-participant-${index}`,
                    type: participant.type,
                    permission: participant.permission,
                    acceptanceStatus: participant.acceptanceStatus,
                    userIdentity: {
                      lookupInfo: { emailAddress: participant.email },
                    },
                  })),
                },
              ],
            }
          }
          return { records: [] }
        },
        shareWithUI: async () => {
          const html = document.documentElement
          const count = Number(html.getAttribute('data-e2e-cloudkit-share-ui'))
          html.setAttribute('data-e2e-cloudkit-share-ui', String(count + 1))
        },
      })
      const container = {
        setUpAuth: async () => ({ userRecordName: share.ownerRecordName }),
        whenUserSignsIn: () => new Promise<never>(() => {}),
        fetchCurrentUserIdentity: async () => ({
          userRecordName: share.ownerRecordName,
        }),
        privateCloudDatabase: database('private'),
        sharedCloudDatabase: database('shared'),
      }
      Object.defineProperty(window, 'CloudKit', {
        configurable: true,
        value: {
          configure: () => {},
          getDefaultContainer: () => container,
        },
      })
    },
    { share: E2E_ICLOUD_SHARE, shareParticipants: participants },
  )
}

/** The zone a CloudKit Web Services request addresses (`zoneID.zoneName`). */
function requestZone(body: Record<string, unknown>): string {
  const zone =
    typeof body.zoneID === 'object' && Object(body.zoneID) === body.zoneID
      ? requireRecord(body.zoneID, 'CloudKit zone')
      : {}
  return typeof zone.zoneName === 'string' ? zone.zoneName : ''
}

/** In-memory CloudKit shared-zone stub (CloudKit Web Services REST). Event
 * records live in the share's zone: the owner reaches it through
 * `/private/`, a participant through `/shared/`, and both see the same
 * records. A request without a zone is rejected — no provider uses the
 * default zone. */
export function createLocalE2eICloudVaultStub(
  initialYaml = '',
  fileName = DEFAULT_FILE_NAME,
) {
  let vaultYaml = initialYaml
  let recordChangeTag = 'e2e-stub-change-tag'
  const eventRecords = new Map<
    string,
    {
      eventId: string
      location: string
      content: string
      recordChangeTag: string
      zone: string
    }
  >()

  function eventRecordName(eventId: string) {
    return `nook-event-${eventId.replace(/^sha256u:/, '')}`
  }

  /** The stub answers CloudKit's single location filter (EQUALS or
   * BEGINS_WITH), as the event store queries it. */
  function matchesFilter(location: string, query: Record<string, unknown>) {
    const filters: unknown[] = Array.isArray(query.filterBy)
      ? query.filterBy
      : []
    const filter: unknown = filters[0]
    if (typeof filter !== 'object' || Object(filter) !== filter) return true
    const condition = requireRecord(filter, 'CloudKit filter')
    const fieldValue =
      typeof condition.fieldValue === 'object' &&
      Object(condition.fieldValue) === condition.fieldValue
        ? requireRecord(condition.fieldValue, 'CloudKit filter value')
        : {}
    const wanted = typeof fieldValue.value === 'string' ? fieldValue.value : ''
    return condition.comparator === 'BEGINS_WITH'
      ? location.startsWith(wanted)
      : location === wanted
  }

  function eventRecord(recordName: string) {
    const event = eventRecords.get(recordName)
    if (!event) return
    return {
      recordName,
      recordType: 'NookLogEvent',
      recordChangeTag: event.recordChangeTag,
      fields: {
        location: { value: event.location },
        event_id: { value: event.eventId },
        content: { value: event.content },
      },
    }
  }

  return {
    getVaultYaml: () => vaultYaml,
    setVaultYaml: (yaml: string) => {
      vaultYaml = yaml
    },
    getEventFileCount: () => eventRecords.size,
    getEventFileContents: () =>
      [...eventRecords.values()].map((event) => event.content),
    clearEventFiles: () => {
      eventRecords.clear()
    },
    getFileName: () => fileName,
    async install(
      page: Page,
      opts?: { vaultYaml?: string; fileName?: string },
    ) {
      if (typeof opts?.vaultYaml === 'string') {
        vaultYaml = opts.vaultYaml
      }
      if (opts?.fileName) {
        fileName = opts.fileName
      }

      await page.route('https://api.apple-cloudkit.com/**', async (route) => {
        const request = route.request()
        const [url = ''] = [request.url().split('?')[0]]
        const method = request.method()

        if (url.endsWith('/users/current') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              nameComponents: { givenName: 'E2E', familyName: 'User' },
            }),
          })
          return
        }

        const recordsPath =
          /\/database\/1\/[^/]+\/[^/]+\/(private|shared)\/records\//.test(url)
        const requestBody: unknown =
          method === 'POST' ? request.postDataJSON() : {}
        if (
          recordsPath &&
          !requestZone(requireRecord(requestBody, 'CloudKit request'))
        ) {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              serverErrorCode: 'BAD_REQUEST',
              reason: 'e2e CloudKit stub requires the share zone',
            }),
          })
          return
        }

        if (url.endsWith('/records/lookup') && method === 'POST') {
          const body = requireRecord(requestBody, 'CloudKit lookup request')
          const zone = requestZone(body)
          const recordsValue = body.records
          const firstRecord: unknown = Array.isArray(recordsValue)
            ? recordsValue[0]
            : {}
          const firstRecordValue: unknown =
            typeof firstRecord === 'object' &&
            Object(firstRecord) === firstRecord
              ? Object.getOwnPropertyDescriptor(firstRecord, 'recordName')
                  ?.value
              : {}
          const requested =
            typeof firstRecordValue === 'string' ? firstRecordValue : fileName
          const event = eventRecord(requested)
          const records =
            event && eventRecords.get(requested)?.zone === zone
              ? [event]
              : requested === fileName && vaultYaml.trim().length > 0
                ? [
                    {
                      recordName: fileName,
                      recordType: 'NookVault',
                      recordChangeTag,
                      fields: {
                        content: { value: vaultYaml },
                      },
                    },
                  ]
                : []
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ records }),
          })
          return
        }

        if (url.endsWith('/records/query') && method === 'POST') {
          const body = requireRecord(requestBody, 'CloudKit query request')
          const zone = requestZone(body)
          const query =
            typeof body.query === 'object' && Object(body.query) === body.query
              ? requireRecord(body.query, 'CloudKit query')
              : {}
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              records: Array.from(eventRecords.entries())
                .filter(
                  ([, event]) =>
                    event.zone === zone && matchesFilter(event.location, query),
                )
                .map(([name]) => eventRecord(name))
                .filter(Boolean),
            }),
          })
          return
        }

        if (url.endsWith('/records/modify') && method === 'POST') {
          const body = requireRecord(requestBody, 'CloudKit modify request')
          const zone = requestZone(body)
          const operations: unknown = body.operations
          const operation: unknown = Array.isArray(operations)
            ? operations[0]
            : {}
          const operationType: unknown =
            typeof operation === 'object' && Object(operation) === operation
              ? requireRecord(operation, 'CloudKit operation').operationType
              : ''
          if (operationType === 'forceDelete' && Array.isArray(operations)) {
            for (const deletion of operations) {
              const deleted = requireRecord(deletion, 'CloudKit deletion')
              const target =
                typeof deleted.record === 'object' &&
                Object(deleted.record) === deleted.record
                  ? requireRecord(deleted.record, 'CloudKit deleted record')
                  : {}
              if (typeof target.recordName === 'string')
                eventRecords.delete(target.recordName)
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ records: [] }),
            })
            return
          }
          const operationRecord: unknown =
            typeof operation === 'object' && Object(operation) === operation
              ? Object.getOwnPropertyDescriptor(operation, 'record')?.value
              : {}
          const record =
            typeof operationRecord === 'object' &&
            Object(operationRecord) === operationRecord
              ? requireRecord(operationRecord, 'CloudKit record')
              : {}
          const recordType = record.recordType
          const fields =
            typeof record.fields === 'object' &&
            Object(record.fields) === record.fields
              ? requireRecord(record.fields, 'CloudKit fields')
              : {}
          const contentField =
            typeof fields.content === 'object' &&
            Object(fields.content) === fields.content
              ? requireRecord(fields.content, 'CloudKit content field')
              : {}
          const content =
            typeof contentField.value === 'string' ? contentField.value : ''
          if (recordType === 'NookLogEvent') {
            const locationField =
              typeof fields.location === 'object' &&
              Object(fields.location) === fields.location
                ? requireRecord(fields.location, 'CloudKit location field')
                : {}
            const location =
              typeof locationField.value === 'string' ? locationField.value : ''
            const eventIdField =
              typeof fields.event_id === 'object' &&
              Object(fields.event_id) === fields.event_id
                ? requireRecord(fields.event_id, 'CloudKit event id field')
                : {}
            const eventId =
              typeof eventIdField.value === 'string' ? eventIdField.value : ''
            const name =
              typeof record.recordName === 'string'
                ? record.recordName
                : eventRecordName(eventId)
            eventRecords.set(name, {
              eventId,
              location,
              content,
              recordChangeTag: `e2e-event-change-tag-${Date.now()}`,
              zone,
            })
          } else if (content) {
            vaultYaml = content
          }
          recordChangeTag = `e2e-stub-change-tag-${Date.now()}`
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              records: [
                {
                  recordName: ((...[v = fileName]) => v)(record?.recordName),
                  recordType: ((...[v = 'NookVault']) => v)(record?.recordType),
                  recordChangeTag,
                },
              ],
            }),
          })
          return
        }

        await route.fulfill({ status: 404, body: '{}' })
      })
    },
  }
}
