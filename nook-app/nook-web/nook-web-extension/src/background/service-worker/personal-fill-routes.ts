import { Effect } from 'effect'
import {
  PersonalFillCancelResponseKind,
  PersonalFillMessages,
  PersonalFillOpenResponseKind,
  PersonalFillPageResponseKind,
  PersonalFillQueryResponseKind,
  PersonalFillRevealResponseKind,
  PersonalFillSelectResponseKind,
  type PersonalFillCancelMessage,
  type PersonalFillOpenMessage,
  type PersonalFillPageResponse,
  type PersonalFillQueryMessage,
  type PersonalFillRevealMessage,
  type PersonalFillSelectMessage,
} from '../../lib/personal-fill-messages'
import { WebsiteAuthenticatorResponseStatus } from '../../lib/login-fill-messages'
import {
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationIsCurrent,
} from './account-pickers'
import { extensionPairingIdentity } from './pairing-identity'
import { PersonalFillSessionAdapter } from './personal-fill-session-adapter'
import type { StoredExtensionPairingGrant } from '../pairing-grants'
import {
  PersonalFillGrantAccessKind,
  PersonalFillPickers,
  type PersonalFillGrantAccess,
  type PersonalFillGrantAccessRequest,
  type PersonalFillPageDelivery,
  type PersonalFillPickerDependencies,
} from './personal-fill-pickers'
import {
  SchemaRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoutes,
  type RuntimeMessageSchema,
} from './schema-runtime-message-route'

type WebsiteGrantAccess = Awaited<
  ReturnType<typeof extensionPairingIdentity.availableWebsiteGrants>
>
type WebsiteGrantRefusal = Exclude<
  WebsiteGrantAccess,
  { grants: StoredExtensionPairingGrant[] }
>['response']

/** Wires the personal picker requests to the worker's browser and session capabilities. */
export class PersonalFillRoutes {
  static readonly PICKER_PAGE_PATH = 'personal-picker/index.html'

  private static grantAccess(
    access: WebsiteGrantAccess,
  ): PersonalFillGrantAccess {
    switch (true) {
      case 'grants' in access:
        return {
          kind: PersonalFillGrantAccessKind.Granted,
          grants: access.grants,
        }
      case 'response' in access:
        return PersonalFillRoutes.responseAccess(access.response)
      case true:
        return { kind: PersonalFillGrantAccessKind.Unavailable }
    }
    return { kind: PersonalFillGrantAccessKind.Unavailable }
  }

  private static responseAccess(
    response: WebsiteGrantRefusal,
  ): PersonalFillGrantAccess {
    switch (response.ok) {
      case false:
        return { kind: PersonalFillGrantAccessKind.Forbidden }
      case true:
        break
    }
    switch (response.status) {
      case WebsiteAuthenticatorResponseStatus.Locked:
        return { kind: PersonalFillGrantAccessKind.Locked }
      case WebsiteAuthenticatorResponseStatus.Unavailable:
        return { kind: PersonalFillGrantAccessKind.Unavailable }
    }
  }

  private static async websiteGrants(
    request: PersonalFillGrantAccessRequest,
  ): Promise<PersonalFillGrantAccess> {
    const grantsRequest: Parameters<
      typeof extensionPairingIdentity.availableWebsiteGrants
    >[0] = {
      origin: request.origin,
      sender: request.sender,
      forbiddenReason: 'personal-fill-forbidden-origin',
    }
    const access =
      await extensionPairingIdentity.availableWebsiteGrants(grantsRequest)
    return PersonalFillRoutes.grantAccess(access)
  }

  private static async sendToPage(
    delivery: PersonalFillPageDelivery,
  ): Promise<PersonalFillPageResponse> {
    const options: chrome.tabs.MessageSendOptions = {
      frameId: delivery.frameId,
      documentId: delivery.documentId,
    }
    const response: PersonalFillPageResponse = await chrome.tabs.sendMessage(
      delivery.tabId,
      delivery.message,
      options,
    )
    const ignored: PersonalFillPageResponse = {
      kind: PersonalFillPageResponseKind.Ignored,
    }
    return Effect.runSync(
      PersonalFillMessages.decodePageResponse(response).pipe(
        Effect.catch(() => Effect.succeed(ignored)),
      ),
    )
  }

  private static pickers(): PersonalFillPickers {
    const session = new PersonalFillSessionAdapter(
      extensionPairingIdentity.sendSessionMessage.bind(
        extensionPairingIdentity,
      ),
    )
    const dependencies: PersonalFillPickerDependencies = {
      authorizationGeneration: accountPickerAuthorizationGeneration,
      generationIsCurrent: accountPickerAuthorizationIsCurrent,
      grantAccess: PersonalFillRoutes.websiteGrants,
      passwordGrants: extensionPairingIdentity.passwordPairingGrants.bind(
        extensionPairingIdentity,
      ),
      isWebsiteSender: extensionPairingIdentity.isAuthorizedWebsiteSender.bind(
        extensionPairingIdentity,
      ),
      listRecords: session.listRecords.bind(session),
      revealValues: session.revealValues.bind(session),
      sendToPage: PersonalFillRoutes.sendToPage,
      randomNonce: extensionPairingIdentity.randomNonce.bind(
        extensionPairingIdentity,
      ),
      now: Date.now,
      runtimeId: chrome.runtime.id,
      pickerUrl: chrome.runtime.getURL(PersonalFillRoutes.PICKER_PAGE_PATH),
      extensionOrigin: new URL(chrome.runtime.getURL('/')).origin,
    }
    return new PersonalFillPickers(dependencies)
  }

  /** The worker's personal picker routes, sharing one in-memory request owner. */
  static routes(): BackgroundRuntimeMessageRoutes {
    const pickers = PersonalFillRoutes.pickers()
    const open: RuntimeMessageSchema<PersonalFillOpenMessage> = {
      decode: PersonalFillMessages.decodeOpen,
    }
    const query: RuntimeMessageSchema<PersonalFillQueryMessage> = {
      decode: PersonalFillMessages.decodeQuery,
    }
    const select: RuntimeMessageSchema<PersonalFillSelectMessage> = {
      decode: PersonalFillMessages.decodeSelect,
    }
    const cancel: RuntimeMessageSchema<PersonalFillCancelMessage> = {
      decode: PersonalFillMessages.decodeCancel,
    }
    const reveal: RuntimeMessageSchema<PersonalFillRevealMessage> = {
      decode: PersonalFillMessages.decodeReveal,
    }
    return [
      SchemaRuntimeMessageRoute.matching(open)
        .respondWith(pickers.open.bind(pickers))
        .onRejected(() => ({ kind: PersonalFillOpenResponseKind.Failed })),
      SchemaRuntimeMessageRoute.matching(query)
        .respondWith(pickers.query.bind(pickers))
        .onRejected(() => ({ kind: PersonalFillQueryResponseKind.Failed })),
      SchemaRuntimeMessageRoute.matching(select)
        .respondWith(pickers.select.bind(pickers))
        .onRejected(() => ({ kind: PersonalFillSelectResponseKind.Failed })),
      SchemaRuntimeMessageRoute.matching(cancel)
        .respondWith(pickers.cancel.bind(pickers))
        .onRejected(() => ({ kind: PersonalFillCancelResponseKind.Forbidden })),
      SchemaRuntimeMessageRoute.matching(reveal)
        .respondWith(pickers.reveal.bind(pickers))
        .onRejected(() => ({ kind: PersonalFillRevealResponseKind.Failed })),
    ]
  }
}
