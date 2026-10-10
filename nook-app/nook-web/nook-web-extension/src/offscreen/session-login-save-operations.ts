import type { LoginSaveEvidenceKind } from '../lib/login-save-observation-codecs'
import { err, ok } from 'neverthrow'
import { Effect } from 'effect'
import {
  NookWebsiteLoginSaveDecision,
  type NookVaultManager,
  type NookWebsiteLoginSavePlan,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  is_nook_vault_app_url,
  classify_companion_login_save_capture,
  classify_companion_login_save_outcome,
  classify_companion_authentication_outcome_with_default_timeout,
  type WebsiteLoginSaveOffer,
  type LoginSaveCaptureBaseline,
  type LoginSaveSenderContext,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import type { ExtensionSessionRequest } from './session-request-adapter'
import {
  LOGIN_SAVE_OFFER_TTL_MS,
  PendingLoginSaveLookupState,
  pendingLoginSaveOfferStore,
  type PendingLoginSaveOffer,
  type PendingLoginSaveOfferScope,
} from './login-save-offers'
import { extensionVaultGrant } from './session-vault-grant'
import {
  openPasskeyVault,
  flushPasskeyEventToProviders,
} from './session-vault-operations'
type SessionAcknowledgement = { readonly ok: true }
type LoginSaveSessionMessage = Extract<
  ExtensionSessionRequest,
  {
    type:
      | typeof ExtensionSessionMessageType.PlanLoginSave
      | typeof ExtensionSessionMessageType.PendingLoginSave
      | typeof ExtensionSessionMessageType.CommitLoginSave
      | typeof ExtensionSessionMessageType.DismissLoginSave
  }
>
type LoginSavePlanArguments = Parameters<
  NookVaultManager['plan_website_login_save']
>
type LoginSavePlanResource = Pick<
  NookWebsiteLoginSavePlan,
  'decision' | 'secretId' | 'free'
>
export type LoginSaveSessionManager = Pick<
  NookVaultManager,
  | 'open_extension_passkey_vault_js'
  | 'commit_submitted_website_login_save'
  | 'commit_website_login_save'
  | 'load_auth_providers_snapshot'
  | 'flush_event_outbox_for_provider'
> & {
  plan_website_login_save: (
    ...request: LoginSavePlanArguments
  ) => Promise<LoginSavePlanResource>
}
type CapturedLoginSaveNormalization = {
  baseline: LoginSaveCaptureBaseline
  selection: WebsiteLoginSaveOffer['selection']
}
type LoginSaveCapturePayload = Extract<
  LoginSaveSessionMessage,
  { type: typeof ExtensionSessionMessageType.PlanLoginSave }
>['payload']
type LoginSaveCommitEvidence = Extract<
  LoginSaveSessionMessage,
  { type: typeof ExtensionSessionMessageType.CommitLoginSave }
>['payload']['evidence']
type SubmittedLoginCommitRequest = {
  activeManager: LoginSaveSessionManager
  committedOffer: PendingLoginSaveOffer
  observation: Extract<
    LoginSaveCommitEvidence,
    { kind: `${LoginSaveEvidenceKind.SubmittedLogin}` }
  >['observation']
}
type ExplicitLoginCommitRequest = {
  committedOffer: PendingLoginSaveOffer
  observation: Extract<
    LoginSaveCommitEvidence,
    { kind: `${LoginSaveEvidenceKind.ExplicitAuthentication}` }
  >['observation']
}
type LoginSaveManagerAccess = () => Promise<LoginSaveSessionManager>
type LoginSaveScopePayload = { origin: string; sender: LoginSaveSenderContext }
type LoginSavePlanResponse =
  | {
      readonly ok: true
      readonly decision: NookWebsiteLoginSaveDecision.AlreadySaved
      readonly secretId: string
    }
  | {
      readonly ok: true
      readonly decision: Exclude<
        NookWebsiteLoginSaveDecision,
        NookWebsiteLoginSaveDecision.AlreadySaved
      >
    }
type LoginSaveOfferResponse =
  | {
      readonly ok: true
      readonly decision: NookWebsiteLoginSaveDecision.Create
      readonly offerId: string
      readonly vaultStoreId: string
      readonly baseline: LoginSaveCaptureBaseline
      readonly selection: WebsiteLoginSaveOffer['selection']
    }
  | {
      readonly ok: true
      readonly decision: NookWebsiteLoginSaveDecision.Update
      readonly offerId: string
      readonly secretId: string
      readonly vaultStoreId: string
      readonly baseline: LoginSaveCaptureBaseline
      readonly selection: WebsiteLoginSaveOffer['selection']
    }
type PendingLoginSaveResponse =
  | {
      readonly ok: true
      readonly state: PendingLoginSaveLookupState.Unavailable
    }
  | {
      readonly ok: true
      readonly state: PendingLoginSaveLookupState.Available
      readonly offer: {
        readonly offerId: string
        readonly decision:
          | NookWebsiteLoginSaveDecision.Create
          | NookWebsiteLoginSaveDecision.Update
        readonly vaultStoreId: string
        readonly baseline: LoginSaveCaptureBaseline
        readonly selection: WebsiteLoginSaveOffer['selection']
      }
    }
type LoginSaveCommitResponse = {
  readonly ok: true
  readonly decision:
    NookWebsiteLoginSaveDecision.Create | NookWebsiteLoginSaveDecision.Update
}

export class LoginSaveSessionOperations {
  constructor(private readonly getManager: LoginSaveManagerAccess) {}
  // The existing offscreen queue consumes Promise<Result>; Effect owns this
  // capability invocation and failure is encoded only at that legacy edge.
  handle(message: LoginSaveSessionMessage) {
    const attempt: Parameters<
      typeof Effect.tryPromise<
        Awaited<ReturnType<LoginSaveSessionOperations['execute']>>,
        SessionOperationFailure
      >
    >[0] = {
      try: () => this.execute(message),
      catch: () =>
        new SessionOperationFailure(SessionOperationFailureKind.Failed),
    }
    return Effect.runPromise(
      Effect.tryPromise(attempt).pipe(
        Effect.catch((failure) => Effect.succeed(err(failure))),
      ),
    )
  }
  private async execute(message: LoginSaveSessionMessage) {
    const { getManager } = this
    switch (message.type) {
      case ExtensionSessionMessageType.PlanLoginSave: {
        const payload = message.payload
        try {
          // The typed URL decoder canonicalizes a bare origin with a trailing
          // slash; browser-memory sender scope uses the native origin projection.
          payload.origin = new URL(payload.origin).origin
          switch (
            is_nook_vault_app_url(
              payload.capture.submitted_url,
              __NOOK_SIMPLE_VAULT_URL__,
            )
          ) {
            case true:
              return err(
                new SessionOperationFailure(
                  SessionOperationFailureKind.InvalidRequest,
                ),
              )
            case false:
              break
          }
          const normalized = await Effect.runPromise(
            Effect.result(this.normalizeCapturedLogin(payload)),
          )
          switch (normalized._tag) {
            case 'Failure':
              return err(normalized.failure)
            case 'Success':
              break
          }
          const { baseline, selection } = normalized.success
          const grant = extensionVaultGrant(payload)
          if (
            typeof payload.origin !== 'string' ||
            typeof payload.username !== 'string' ||
            typeof payload.password !== 'string'
          ) {
            return err(
              new SessionOperationFailure(
                SessionOperationFailureKind.InvalidRequest,
              ),
            )
          }
          const activeManager = await getManager()
          const nookTypedArgs0_9: Parameters<typeof openPasskeyVault>[0] = {
            activeManager,
            grant,
          }
          const admission5 = await openPasskeyVault(nookTypedArgs0_9)
          if (admission5.isErr()) return err(admission5.error)
          pendingLoginSaveOfferStore.clearForScope(this.scope(payload))
          const plan = await activeManager.plan_website_login_save(
            payload.origin,
            payload.username,
            payload.password,
          )
          try {
            const decision = plan.decision
            if (
              decision !== NookWebsiteLoginSaveDecision.Create &&
              decision !== NookWebsiteLoginSaveDecision.Update
            ) {
              payload.password = ''
              const response: LoginSavePlanResponse =
                decision === NookWebsiteLoginSaveDecision.AlreadySaved
                  ? { ok: true, decision, secretId: plan.secretId }
                  : { ok: true, decision }
              return ok(response)
            }
            const offerId = crypto.randomUUID()
            const commonOffer = {
              offerId,
              ...this.scope(payload),
              baseline,
              selection,
              username: payload.username,
              password: payload.password,
              vaultStoreId: grant.vaultStoreId,
              expiresAt: Date.now() + LOGIN_SAVE_OFFER_TTL_MS,
              expiryTimer: setTimeout(() => {
                pendingLoginSaveOfferStore.expireById(offerId)
              }, LOGIN_SAVE_OFFER_TTL_MS),
            }
            let offer: PendingLoginSaveOffer
            if (decision === NookWebsiteLoginSaveDecision.Update) {
              const replaceSecretId = plan.secretId
              offer = {
                ...commonOffer,
                decision: NookWebsiteLoginSaveDecision.Update,
                replaceSecretId,
              }
            } else {
              offer = {
                ...commonOffer,
                decision: NookWebsiteLoginSaveDecision.Create,
              }
            }
            pendingLoginSaveOfferStore.store(offer)
            payload.password = ''
            const response: LoginSaveOfferResponse =
              offer.decision === NookWebsiteLoginSaveDecision.Update
                ? {
                    ok: true,
                    decision: offer.decision,
                    offerId,
                    secretId: offer.replaceSecretId,
                    vaultStoreId: grant.vaultStoreId,
                    baseline: offer.baseline,
                    selection: offer.selection,
                  }
                : {
                    ok: true,
                    decision: offer.decision,
                    offerId,
                    vaultStoreId: grant.vaultStoreId,
                    baseline: offer.baseline,
                    selection: offer.selection,
                  }
            return ok(response)
          } finally {
            plan.free()
          }
        } finally {
          payload.password = ''
          payload.username = ''
          payload.capturedValues.fill('')
        }
      }
      case ExtensionSessionMessageType.PendingLoginSave: {
        const payload = message.payload
        if (typeof payload.origin !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const lookup = pendingLoginSaveOfferStore.findByScope(
          this.scope(payload),
        )
        if (lookup.state === PendingLoginSaveLookupState.Unavailable) {
          const response: PendingLoginSaveResponse = {
            ok: true,
            state: PendingLoginSaveLookupState.Unavailable,
          }
          return ok(response)
        }
        const { offer } = lookup
        const response: PendingLoginSaveResponse = {
          ok: true,
          state: PendingLoginSaveLookupState.Available,
          offer: {
            offerId: offer.offerId,
            decision: offer.decision,
            vaultStoreId: offer.vaultStoreId,
            baseline: offer.baseline,
            selection: offer.selection,
          },
        }
        return ok(response)
      }
      case ExtensionSessionMessageType.CommitLoginSave: {
        const payload = message.payload
        const grant = extensionVaultGrant(payload)
        if (typeof payload.offerId !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const lookupRequest: Parameters<
          typeof pendingLoginSaveOfferStore.findById
        >[0] = { offerId: payload.offerId, scope: this.scope(payload) }
        const lookup = pendingLoginSaveOfferStore.findById(lookupRequest)
        if (
          lookup.state === PendingLoginSaveLookupState.Unavailable ||
          lookup.offer.origin !== (payload.origin as string)
        ) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const { offer } = lookup
        if (offer.vaultStoreId !== grant.vaultStoreId) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        pendingLoginSaveOfferStore.removeForCommit(offer)
        const committedOffer: Parameters<
          typeof pendingLoginSaveOfferStore.clearOffer
        >[0] = { ...offer }
        offer.username = ''
        offer.password = ''
        try {
          const activeManager = await getManager()
          const openRequest: Parameters<typeof openPasskeyVault>[0] = {
            activeManager,
            grant,
          }
          const admission = await openPasskeyVault(openRequest)
          switch (true) {
            case admission.isErr():
              return err(admission.error)
            case true:
            default:
              break
          }
          switch (payload.evidence.kind) {
            case 'SubmittedLogin': {
              const request: SubmittedLoginCommitRequest = {
                activeManager,
                committedOffer,
                observation: payload.evidence.observation,
              }
              await this.commitSubmittedLogin(request)
              break
            }
            case 'ExplicitAuthentication': {
              const request: ExplicitLoginCommitRequest = {
                committedOffer,
                observation: payload.evidence.observation,
              }
              const replaceSecretId =
                this.explicitCommitReplaceSecretId(request)
              await activeManager.commit_website_login_save(
                committedOffer.origin,
                committedOffer.username,
                committedOffer.password,
                replaceSecretId,
              )
              break
            }
          }
          const nookTypedArgs0_11: Parameters<
            typeof flushPasskeyEventToProviders
          >[0] = {
            activeManager,
            vaultStoreId: grant.vaultStoreId,
          }
          const admission7 =
            await flushPasskeyEventToProviders(nookTypedArgs0_11)
          if (admission7.isErr()) return err(admission7.error)
          const response: LoginSaveCommitResponse = {
            ok: true,
            decision: committedOffer.decision,
          }
          return ok(response)
        } finally {
          pendingLoginSaveOfferStore.clearOffer(committedOffer)
        }
      }
      case ExtensionSessionMessageType.DismissLoginSave: {
        const payload = message.payload
        if (typeof payload.offerId !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const clearRequest: Parameters<
          typeof pendingLoginSaveOfferStore.clearById
        >[0] = { offerId: payload.offerId, scope: this.scope(payload) }
        pendingLoginSaveOfferStore.clearById(clearRequest)
        const response: SessionAcknowledgement = { ok: true }
        return ok(response)
      }
    }
  }
  private normalizeCapturedLogin(
    payload: LoginSaveCapturePayload,
  ): Effect.Effect<CapturedLoginSaveNormalization, SessionOperationFailure> {
    const captured = classify_companion_login_save_capture(payload.capture)
    let baseline: LoginSaveCaptureBaseline
    let selection: WebsiteLoginSaveOffer['selection']
    switch (captured.kind) {
      case 'Ignored':
        return Effect.fail(
          new SessionOperationFailure(
            SessionOperationFailureKind.InvalidRequest,
          ),
        )
      case 'SubmittedLogin': {
        const username =
          payload.capturedValues[captured.username_field_index.value]
        const password =
          payload.capturedValues[captured.password_field_index.value]
        switch (true) {
          case typeof username === 'string' && typeof password === 'string':
            break
          case true:
          default:
            return Effect.fail(
              new SessionOperationFailure(
                SessionOperationFailureKind.InvalidRequest,
              ),
            )
        }
        payload.username = username
        payload.password = password
        baseline = captured.baseline
        selection = {
          kind: 'SubmittedLogin',
          username_field_index: captured.username_field_index,
          password_field_index: captured.password_field_index,
        }
        break
      }
      case 'ExplicitAuthentication':
        baseline = captured.baseline
        selection = { kind: 'ExplicitAuthentication' }
        break
    }
    const normalized: CapturedLoginSaveNormalization = { baseline, selection }
    return Effect.succeed(normalized)
  }
  private async commitSubmittedLogin({
    activeManager,
    committedOffer,
    observation,
  }: SubmittedLoginCommitRequest): Promise<void> {
    switch (committedOffer.baseline.source) {
      case 'SubmittedLogin':
        break
      case 'ExplicitAuthentication':
        throw new Error('login save source mismatch')
    }
    const observed = observation
    observed.observation.elapsedMs = Math.max(
      0,
      Date.now() - committedOffer.baseline.submitted_at,
    )
    observed.submission = 'Captured'
    observed.captured_workflow = committedOffer.baseline.captured_workflow
    observed.initial_auth_fields = committedOffer.baseline.initial_auth_fields
    observed.baseline_controls = [...committedOffer.baseline.controls]
    switch (classify_companion_login_save_outcome(observed).eligibility) {
      case 'Eligible':
        break
      case 'Waiting':
      case 'Rejected':
      case 'Expired':
        throw new Error('login save not eligible')
    }
    let target: Parameters<
      NookVaultManager['commit_submitted_website_login_save']
    >[0]['target'] = { kind: 'Create' }
    switch (committedOffer.decision) {
      case NookWebsiteLoginSaveDecision.Update:
        target = { kind: 'Replace', secret_id: committedOffer.replaceSecretId }
        break
      case NookWebsiteLoginSaveDecision.Create:
        break
    }
    const request: Parameters<
      NookVaultManager['commit_submitted_website_login_save']
    >[0] = {
      origin: committedOffer.origin,
      username: committedOffer.username,
      password: committedOffer.password,
      target,
      evidence: observed,
    }
    try {
      await activeManager.commit_submitted_website_login_save(request)
    } finally {
      request.username = ''
      request.password = ''
    }
  }
  private explicitCommitReplaceSecretId({
    committedOffer,
    observation,
  }: ExplicitLoginCommitRequest): string {
    switch (committedOffer.baseline.source) {
      case 'ExplicitAuthentication':
        break
      case 'SubmittedLogin':
        throw new Error('login save source mismatch')
    }
    const verdict =
      classify_companion_authentication_outcome_with_default_timeout(
        observation,
      )
    switch (verdict.allowsCredentialCommit) {
      case true:
        break
      case false:
        throw new Error('login save evidence insufficient')
    }
    let replaceSecretId = ''
    switch (committedOffer.decision) {
      case NookWebsiteLoginSaveDecision.Update:
        replaceSecretId = committedOffer.replaceSecretId
        break
      case NookWebsiteLoginSaveDecision.Create:
        break
    }
    return replaceSecretId
  }
  private scope(payload: LoginSaveScopePayload): PendingLoginSaveOfferScope {
    return {
      origin: payload.origin,
      tabId: payload.sender.tab_id,
      frameId: payload.sender.frame_id,
    }
  }
}
