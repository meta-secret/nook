import type { Page } from '@playwright/test'

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
    if (!event) return undefined
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
      if (opts?.vaultYaml !== undefined) {
        vaultYaml = opts.vaultYaml
      }
      if (opts?.fileName) {
        fileName = opts.fileName
      }

      await page.route('https://api.apple-cloudkit.com/**', async (route) => {
        const request = route.request()
        const url = request.url().split('?')[0]!
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
          const body = request.postDataJSON() as {
            records?: Array<{ recordName?: string }>
          }
          const requested = body.records?.[0]?.recordName ?? fileName
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
          const body = request.postDataJSON() as {
            operations?: Array<{
              record?: {
                recordType?: string
                recordName?: string
                fields?: {
                  content?: { value?: string }
                  event_id?: { value?: string }
                }
              }
            }>
          }
          const record = body.operations?.[0]?.record
          const content = record?.fields?.content?.value ?? ''
          if (record?.recordType === 'NookVaultEvent') {
            const eventId = record.fields?.event_id?.value ?? ''
            const name = record.recordName ?? eventRecordName(eventId)
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
                  recordName: record?.recordName ?? fileName,
                  recordType: record?.recordType ?? 'NookVault',
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
