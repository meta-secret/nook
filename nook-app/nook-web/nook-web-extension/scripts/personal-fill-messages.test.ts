import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
} from '../src/lib/browser-runtime-message'
import {
  PersonalFillMessageType,
  PersonalFillMessages,
  PersonalFillOpenResponseKind,
  PersonalFillRevealResponseKind,
  PersonalPickerFrameMessageType,
  PersonalPickerInitializationCodec,
  type PersonalFillRevealMessage,
} from '../src/lib/personal-fill-messages'
import {
  RuntimeMessageRouteKind,
  SchemaRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoutingRequest,
  type RuntimeMessageSchema,
} from '../src/background/service-worker/schema-runtime-message-route'

/** Runs one codec and reports whether it admitted the value. */
class PersonalCodecFixture {
  static admitted<Decoded, Failure>(decoded: Effect.Effect<Decoded, Failure>) {
    return Effect.runSync(
      decoded.pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      ),
    )
  }

  static delivery(
    value: Parameters<typeof BrowserRuntimeMessage.from>[0],
    responses: string[],
  ): BackgroundRuntimeMessageRoutingRequest {
    const admission = BrowserRuntimeMessage.from(value)
    switch (admission.kind) {
      case BrowserRuntimeMessageAdmissionKind.Rejected:
        throw new Error('fixture message was not a runtime message')
      case BrowserRuntimeMessageAdmissionKind.Accepted:
        return {
          message: admission.message,
          sender: {},
          sendResponse: (response: string) => responses.push(response),
        }
    }
  }
}

const reveal = {
  type: PersonalFillMessageType.Reveal,
  payload: {
    origin: 'https://shop.example',
    requestId: 'request-1',
    kinds: ['GivenName', 'Email'],
  },
}

describe('personal-fill runtime message codecs', () => {
  test('admits each strict request shape', () => {
    expect(
      PersonalCodecFixture.admitted(
        PersonalFillMessages.decodeOpen({
          type: PersonalFillMessageType.Open,
          payload: { origin: 'https://shop.example', group: 'Person' },
        }),
      ),
    ).toBe(true)
    expect(
      PersonalCodecFixture.admitted(
        PersonalFillMessages.decodeQuery({
          type: PersonalFillMessageType.Query,
          payload: {
            requestId: 'request-1',
            parentOrigin: 'https://shop.example',
          },
        }),
      ),
    ).toBe(true)
    expect(
      PersonalCodecFixture.admitted(
        PersonalFillMessages.decodeSelect({
          type: PersonalFillMessageType.Select,
          payload: {
            requestId: 'request-1',
            vaultStoreId: 'vault',
            secretId: 'secret',
          },
        }),
      ),
    ).toBe(true)
    expect(
      PersonalCodecFixture.admitted(
        PersonalFillMessages.decodeCancel({
          type: PersonalFillMessageType.Cancel,
          payload: { requestId: 'request-1' },
        }),
      ),
    ).toBe(true)
    expect(
      PersonalCodecFixture.admitted(PersonalFillMessages.decodeReveal(reveal)),
    ).toBe(true)
  })

  test('rejects extra fields, missing identities and unbounded kinds', () => {
    for (const rejected of [
      { ...reveal, payload: { ...reveal.payload, value: 'leak' } },
      { ...reveal, payload: { ...reveal.payload, requestId: '' } },
      { ...reveal, payload: { ...reveal.payload, kinds: [] } },
      {
        ...reveal,
        payload: {
          ...reveal.payload,
          kinds: Array.from(
            { length: PersonalFillMessages.MAX_KINDS + 1 },
            () => 'Email',
          ),
        },
      },
      { ...reveal, type: PersonalFillMessageType.Open },
    ]) {
      expect(
        PersonalCodecFixture.admitted(
          PersonalFillMessages.decodeReveal(rejected),
        ),
      ).toBe(false)
    }
  })

  test('decodes the closed open and reveal replies', () => {
    expect(
      Effect.runSync(
        PersonalFillMessages.decodeOpenResponse({
          kind: PersonalFillOpenResponseKind.Ready,
          requestId: 'request-1',
          expiresAt: 42,
        }),
      ),
    ).toEqual({
      kind: PersonalFillOpenResponseKind.Ready,
      requestId: 'request-1',
      expiresAt: 42,
    })
    expect(
      PersonalCodecFixture.admitted(
        PersonalFillMessages.decodeOpenResponse({ kind: 'ready' }),
      ),
    ).toBe(false)
    const revealed = Effect.runSync(
      PersonalFillMessages.decodeRevealResponse({
        kind: PersonalFillRevealResponseKind.Revealed,
        values: [{ kind: 'GivenName', value: 'Ada' }],
      }),
    )
    expect(revealed).toEqual({
      kind: PersonalFillRevealResponseKind.Revealed,
      values: [{ kind: 'GivenName', value: 'Ada' }],
    })
  })

  test('the page notices and the frame initialization decode strictly', () => {
    const selected = {
      type: PersonalFillMessageType.Selected,
      payload: { origin: 'https://shop.example', requestId: 'request-1' },
    }
    expect(PersonalFillMessages.decodeSelected(selected)._tag).toBe('Success')
    expect(PersonalFillMessages.decodeCanceled(selected)._tag).toBe('Failure')
    expect(
      PersonalFillMessages.decodeSelected({
        ...selected,
        payload: { ...selected.payload, secretId: 'secret' },
      })._tag,
    ).toBe('Failure')
    expect(
      PersonalPickerInitializationCodec.decode({
        type: PersonalPickerFrameMessageType.Initialize,
        requestId: 'request-1',
        origin: 'https://shop.example',
      })._tag,
    ).toBe('Success')
  })
})

describe('personal-fill worker routing', () => {
  test('a personal route handles only its own message type', () => {
    const responses: string[] = []
    const schema: RuntimeMessageSchema<PersonalFillRevealMessage> = {
      decode: PersonalFillMessages.decodeReveal,
    }
    const route = SchemaRuntimeMessageRoute.matching(schema)
      .respondWith(async () => 'revealed')
      .onRejected(() => 'failed')
    expect(
      route.route(PersonalCodecFixture.delivery(reveal, responses)).kind,
    ).toBe(RuntimeMessageRouteKind.Handled)
    const open = {
      type: PersonalFillMessageType.Open,
      payload: { origin: 'https://shop.example', group: 'Person' },
    }
    expect(
      route.route(PersonalCodecFixture.delivery(open, responses)).kind,
    ).toBe(RuntimeMessageRouteKind.Unhandled)
  })
})
