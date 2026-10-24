import { Effect } from 'effect'
import { err, ok, type Result } from 'neverthrow'
import {
  PersonalFieldGroup,
  personal_fill_record_filter,
  type NookPersonalFillRequest,
  type NookPersonalFillResponse,
  type NookSecretListItem,
  type NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import type { SessionOperationFailure } from '../lib/session-operation-queue'
import type { ExtensionSessionRequest } from './session-request-adapter'
import { extensionVaultGrant } from './session-vault-grant'
import { openPasskeyVault } from './session-vault-operations'

type PersonalRecordsMessage = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.ListPersonalRecords }
>
type PersonalFillMessage = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.RevealPersonalFill }
>
type PersonalVaultMessage = PersonalRecordsMessage | PersonalFillMessage

/** The record list fields this operation reads; never a secret value. */
export type PersonalSecretListItem = Pick<
  NookSecretListItem,
  'id' | 'displayTitle' | 'summary' | 'free'
>

export type PersonalSecretPage = {
  take_items(): PersonalSecretListItem[]
  free(): void
}

/** The vault manager capabilities the personal session requests use. */
/** The listing query: search text, secret-type filter, offset and page size. */
export type PersonalSecretPageQuery = Parameters<
  NookVaultManager['query_secret_page_js']
>

export type PersonalFillVaultManager = Pick<
  NookVaultManager,
  'open_extension_passkey_vault_js' | 'reveal_personal_data_for_fill'
> & {
  readonly query_secret_page_js: (
    ...query: PersonalSecretPageQuery
  ) => PersonalSecretPage
}

export type PersonalSessionOperationRequest<Message> = {
  readonly message: Message
  readonly getManager: () => Promise<PersonalFillVaultManager>
}

/** List metadata Rust projected for one personal record; never a field value. */
export type PersonalRecordSummary = {
  readonly secretId: string
  readonly title: string
  readonly summary: string
}

export type PersonalRecordListResponse = {
  readonly ok: true
  readonly records: readonly PersonalRecordSummary[]
}

type PersonalFillRevealResult = Result<
  PersonalFillValuesResponse,
  SessionOperationFailure
>

export type PersonalFillValuesResponse = {
  readonly ok: true
  readonly values: NookPersonalFillResponse['values']
}

/** Opens the grant's vault for one personal-data session request. */
class PersonalVaultAdmission {
  constructor(
    private readonly request: PersonalSessionOperationRequest<PersonalVaultMessage>,
  ) {}

  open() {
    const getManager = this.request.getManager
    const payload = this.request.message.payload
    return Effect.gen(function* () {
      const activeManager = yield* Effect.tryPromise(getManager)
      const admissionRequest: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant: extensionVaultGrant(payload),
      }
      const admission = yield* Effect.tryPromise(() =>
        openPasskeyVault(admissionRequest),
      )
      return admission.map(() => activeManager)
    })
  }
}

/**
 * Lists the list metadata of one record group from the grant's vault. Rust
 * maps the group to its record filter and computes title and summary.
 */
export class PersonalRecordsListOperation {
  /** Upper bound on listed records; the picker shows no more than this. */
  static readonly PAGE_LIMIT = 200

  constructor(
    private readonly request: PersonalSessionOperationRequest<PersonalRecordsMessage>,
  ) {}

  private summaries(
    manager: PersonalFillVaultManager,
  ): PersonalRecordListResponse {
    const page = manager.query_secret_page_js(
      '',
      personal_fill_record_filter(
        PersonalFieldGroup[this.request.message.payload.group],
      ),
      0,
      PersonalRecordsListOperation.PAGE_LIMIT,
    )
    const items: PersonalSecretListItem[] = []
    try {
      items.push(...page.take_items())
      return {
        ok: true,
        records: items.map((item) => ({
          secretId: item.id,
          title: item.displayTitle,
          summary: item.summary,
        })),
      }
    } finally {
      items.forEach((item) => item.free())
      page.free()
    }
  }

  run(): Promise<Result<PersonalRecordListResponse, SessionOperationFailure>> {
    const admission = new PersonalVaultAdmission(this.request)
    const summaries = this.summaries.bind(this)
    return Effect.runPromise(
      admission.open().pipe(Effect.map((opened) => opened.map(summaries))),
    )
  }
}

/**
 * Reveals the planned kinds of one explicitly selected record. Rust rejects a
 * kind outside the group, a record of another group, or an unknown record.
 */
export class PersonalFillRevealOperation {
  constructor(
    private readonly request: PersonalSessionOperationRequest<PersonalFillMessage>,
  ) {}

  private reveal(manager: PersonalFillVaultManager) {
    const payload = this.request.message.payload
    const request: NookPersonalFillRequest = {
      secretId: payload.secretId,
      group: payload.group,
      kinds: [...payload.kinds],
    }
    return Effect.tryPromise(() =>
      manager.reveal_personal_data_for_fill(request),
    ).pipe(
      Effect.map((response) => {
        const values: PersonalFillValuesResponse = {
          ok: true,
          values: response.values,
        }
        return values
      }),
    )
  }

  run(): Promise<Result<PersonalFillValuesResponse, SessionOperationFailure>> {
    const admission = new PersonalVaultAdmission(this.request)
    const reveal = this.reveal.bind(this)
    return Effect.runPromise(
      admission.open().pipe(
        Effect.flatMap((opened) =>
          opened.match(
            (manager) =>
              reveal(manager).pipe(
                Effect.map((values): PersonalFillRevealResult => ok(values)),
              ),
            (failure) => Effect.succeed<PersonalFillRevealResult>(err(failure)),
          ),
        ),
      ),
    )
  }
}
