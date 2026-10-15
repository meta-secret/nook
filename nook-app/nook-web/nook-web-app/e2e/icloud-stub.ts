import type { Page } from '@playwright/test'
import { requireRecord } from './helpers/guards'

const DEFAULT_FILE_NAME = 'nook-events'

/** In-memory CloudKit private-database stub (CloudKit Web Services REST). */
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
    }
  >()

  function eventRecordName(eventId: string) {
    return `nook-event-${eventId.replace(/^sha256u:/, '')}`
  }

  /** The stub answers CloudKit's single location filter (EQUALS or
   * BEGINS_WITH), as the event store queries it. */
  function matchesFilter(location: string, query: Record<string, unknown>) {
    const filters = Array.isArray(query.filterBy) ? query.filterBy : []
    const [filter] = filters
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

        if (url.endsWith('/records/lookup') && method === 'POST') {
          const body = requireRecord(
            request.postDataJSON(),
            'CloudKit lookup request',
          )
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
          const records = event
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
          const body = requireRecord(
            request.postDataJSON(),
            'CloudKit query request',
          )
          const query =
            typeof body.query === 'object' && Object(body.query) === body.query
              ? requireRecord(body.query, 'CloudKit query')
              : {}
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              records: Array.from(eventRecords.entries())
                .filter(([, event]) => matchesFilter(event.location, query))
                .map(([name]) => eventRecord(name))
                .filter(Boolean),
            }),
          })
          return
        }

        if (url.endsWith('/records/modify') && method === 'POST') {
          const body = requireRecord(
            request.postDataJSON(),
            'CloudKit modify request',
          )
          const operations = body.operations
          const operation: unknown = Array.isArray(operations)
            ? operations[0]
            : {}
          const operationType =
            typeof operation === 'object' && Object(operation) === operation
              ? Object.getOwnPropertyDescriptor(operation, 'operationType')
                  ?.value
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
