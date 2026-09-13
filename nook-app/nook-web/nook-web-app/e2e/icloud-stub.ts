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
    { eventId: string; content: string; recordChangeTag: string }
  >()

  function eventRecordName(eventId: string) {
    return `nook-event-${eventId.replace(/^sha256u:/, '')}`
  }

  function eventRecord(recordName: string) {
    const event = eventRecords.get(recordName)
    if (!event) return
    return {
      recordName,
      recordType: 'NookVaultEvent',
      recordChangeTag: event.recordChangeTag,
      fields: {
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
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              records: Array.from(eventRecords.keys())
                .map(eventRecord)
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
          if (recordType === 'NookVaultEvent') {
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
