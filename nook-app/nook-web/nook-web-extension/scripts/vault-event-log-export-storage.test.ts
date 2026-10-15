import { afterEach, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { Effect, Match } from 'effect'
import { ok } from 'neverthrow'
import { ExtensionVaultEventLogExport } from '../src/background/service-worker/vault-event-log-export'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
  ExtensionSessionDocumentStateKind,
  type ExtensionSessionTransport,
  type ExtensionSessionTransportDelivery,
  type DecodedExtensionSessionTransportDelivery,
  type ExtensionSessionTransportResult,
} from '../src/background/service-worker/session-document'
import type { ExtensionPairingItems } from '../src/background/pairing-grants'
import { ExtensionPairingStorage } from '../src/background/service-worker/pairing-identity-storage'
import { backgroundVaultRuntime } from '../src/background/vault-runtime'
import type {
  ExtensionVaultEventLogRequestMessage,
  ExtensionVaultEventLogResponse,
  ExtensionGrantAuthority,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { ExtensionSessionResponse } from '../src/offscreen/session'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'

type UnkeyedPairingStorageCalls = [][]
type VaultEventLogExportDependencies = ConstructorParameters<
  typeof ExtensionVaultEventLogExport
>[0]
type AuthorityDocumentDelivery<Response, DecodeFailure> =
  | ExtensionSessionTransportDelivery
  | DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>
type AuthorityDocumentResult<Response, DecodeFailure> =
  | ExtensionSessionTransportResult
  | ExtensionSessionTransportResult<Response, DecodeFailure>

type DecodedAuthorityDeliveryPattern = {
  readonly decodeResponse: typeof Match.defined
}
type RawAuthorityDeliveryPattern = {
  readonly message: typeof Match.any
}

enum AuthorityDocumentDeliveryKind {
  Raw = 'raw',
  Decoded = 'decoded',
}
type NamedAuthorityDocumentDelivery<Response, DecodeFailure> =
  | { readonly kind: AuthorityDocumentDeliveryKind.Raw }
  | {
      readonly kind: AuthorityDocumentDeliveryKind.Decoded
      readonly delivery: DecodedExtensionSessionTransportDelivery<
        Response,
        DecodeFailure
      >
    }

enum VaultEventLogExportObservation {
  Closed = 'closed',
  Responded = 'responded',
}
type VaultEventLogExportObservations = VaultEventLogExportObservation[]

/** Supplies a typed authority reply through the existing transport contract. */
class AuthoritySessionDocument implements ExtensionSessionTransport {
  constructor(private readonly authority: ExtensionGrantAuthority) {}

  sendMessage(
    delivery: ExtensionSessionTransportDelivery,
  ): Promise<ExtensionSessionTransportResult>
  sendMessage<Response, DecodeFailure>(
    delivery: DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  sendMessage<Response = ExtensionSessionResponse, DecodeFailure = never>(
    delivery: AuthorityDocumentDelivery<Response, DecodeFailure>,
  ): Promise<AuthorityDocumentResult<Response, DecodeFailure>> {
    const response: ExtensionSessionResponse = this.authority
    const named = this.nameDelivery(delivery)
    switch (named.kind) {
      case AuthorityDocumentDeliveryKind.Decoded:
        return Effect.runPromise(
          Effect.succeed(named.delivery.decodeResponse(response)),
        )
      case AuthorityDocumentDeliveryKind.Raw:
        return Effect.runPromise(
          Effect.succeed(
            ok<ExtensionSessionResponse, ExtensionSessionTransportFailure>(
              response,
            ),
          ),
        )
    }
  }
  private nameDelivery<Response, DecodeFailure>(
    delivery: AuthorityDocumentDelivery<Response, DecodeFailure>,
  ): NamedAuthorityDocumentDelivery<Response, DecodeFailure> {
    const decodedDelivery: DecodedAuthorityDeliveryPattern = {
      decodeResponse: Match.defined,
    }
    const rawDelivery: RawAuthorityDeliveryPattern = { message: Match.any }
    return Match.value(delivery).pipe(
      Match.when(decodedDelivery, (decoded) => {
        const named: NamedAuthorityDocumentDelivery<Response, DecodeFailure> = {
          kind: AuthorityDocumentDeliveryKind.Decoded,
          delivery: decoded,
        }
        return named
      }),
      Match.when(rawDelivery, () => {
        const named: NamedAuthorityDocumentDelivery<Response, DecodeFailure> = {
          kind: AuthorityDocumentDeliveryKind.Raw,
        }
        return named
      }),
      Match.exhaustive,
    )
  }
}

/** Observes the exact storage call before an unavailable protected session. */
class VaultEventLogExportStorageFixture {
  readonly storage = new ExtensionPairingStorage()
  readonly load = mock(this.storage.getPairingStorage.bind(this.storage))
  readonly failure = new ExtensionSessionTransportFailure(
    ExtensionSessionTransportFailureKind.Closed,
  )
  readonly observations: VaultEventLogExportObservations = []
  readonly open = mock<VaultEventLogExportDependencies['openSessionDocument']>(
    () =>
      Effect.runPromise(
        Effect.succeed(this.failure.toResult<ExtensionSessionTransport>()),
      ),
  )
  readonly close = mock(() =>
    Effect.runPromise(
      Effect.sync(() => {
        this.observations.push(VaultEventLogExportObservation.Closed)
        const closed: ExtensionSessionTransportResult<ExtensionSessionDocumentStateKind.Closed> =
          ok(ExtensionSessionDocumentStateKind.Closed)
        return closed
      }),
    ),
  )
  readonly request: ExtensionVaultEventLogRequestMessage = {
    type: 'ExportVaultEventLog',
    payload: { vault_store_id: 'store_abcdefghijk' },
  }

  constructor() {
    const stored: ExtensionPairingItems = {}
    spyOn(
      backgroundVaultRuntime,
      'loadExtensionPairingItems',
    ).mockImplementation(() => Effect.runPromise(Effect.succeed(stored)))
  }

  operation(): ExtensionVaultEventLogExport {
    const dependencies: VaultEventLogExportDependencies = {
      loadPairingStorage: this.load,
      openSessionDocument: this.open,
      closeSessionDocument: this.close,
    }
    return new ExtensionVaultEventLogExport(dependencies)
  }
}

interface UnchangedAuthorityScenario {
  readonly authority: ExtensionGrantAuthority
  readonly expected: ExtensionVaultEventLogResponse
}
type UnchangedAuthorityScenarios = UnchangedAuthorityScenario[]

class VaultEventLogExportAuthorityFixture extends VaultEventLogExportStorageFixture {
  static readonly unchanged: UnchangedAuthorityScenarios = [
    {
      authority: { kind: 'NoMatchingAuthority' },
      expected: { kind: 'NotPaired' },
    },
    {
      authority: { kind: 'InvalidStoredAuthority' },
      expected: { kind: 'Rejected', reason: 'InvalidStoredAuthority' },
    },
  ]

  constructor(authority: ExtensionGrantAuthority) {
    super()
    const document = new AuthoritySessionDocument(authority)
    this.open.mockImplementation(() =>
      Effect.runPromise(Effect.succeed(ok(document))),
    )
  }
}

beforeAll(() => companionWasmReady)

afterEach(() => mock.restore())

test('does not pass the Effect cancellation signal as an optional pairing storage key', () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = new VaultEventLogExportStorageFixture()
      const outcome = yield* fixture.operation().run(fixture.request)
      const expectedCalls: UnkeyedPairingStorageCalls = [[]]
      const expectedOutcome: ExtensionVaultEventLogResponse = {
        kind: 'Rejected',
        reason: 'Unavailable',
      }
      expect(fixture.load.mock.calls).toEqual(expectedCalls)
      expect(outcome).toEqual(expectedOutcome)
      expect(fixture.close).not.toHaveBeenCalled()
    }),
  ))

test('closes the stale protected session before returning missing active grant rejection', () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const authority: ExtensionGrantAuthority = {
        kind: 'MissingActiveAuthority',
      }
      const fixture = new VaultEventLogExportAuthorityFixture(authority)
      const outcome = yield* fixture.operation().run(fixture.request)
      fixture.observations.push(VaultEventLogExportObservation.Responded)
      const expectedOrder: VaultEventLogExportObservations = [
        VaultEventLogExportObservation.Closed,
        VaultEventLogExportObservation.Responded,
      ]
      const expected: ExtensionVaultEventLogResponse = {
        kind: 'Rejected',
        reason: 'MissingActiveAuthority',
      }
      expect(fixture.observations).toEqual(expectedOrder)
      expect(fixture.close).toHaveBeenCalledTimes(1)
      expect(outcome).toEqual(expected)
    }),
  ))

test.each(VaultEventLogExportAuthorityFixture.unchanged)(
  'retains the protected session for $authority.kind',
  (scenario: UnchangedAuthorityScenario) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = new VaultEventLogExportAuthorityFixture(
          scenario.authority,
        )
        const outcome = yield* fixture.operation().run(fixture.request)
        expect(fixture.close).not.toHaveBeenCalled()
        expect(outcome).toEqual(scenario.expected)
      }),
    ),
)
