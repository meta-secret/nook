import { Data, Effect } from 'effect'
import {
  AuthenticationWorkflowSnapshotResponseKind,
  type AuthenticationSavedLoginCapability,
  type AuthenticationWorkflowSnapshot,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  AuthenticationWorkflowClassification,
  type ClassifiedAuthenticationWorkflowObservation,
} from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import {
  passwordFieldDiscovery,
  passwordFormInteraction,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  AuthenticationWorkflowSnapshotMessageType,
  MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS,
  type AuthenticationWorkflowSnapshotMessage,
} from '../../lib/auth-workflow-messages'
import { recoveryCopyObservation } from '../../lib/backup-code-candidates'
import { pageQrCapture } from '../../lib/page-qr-capture'
import {
  RuntimeMessageDeliveryKind,
  authenticationRuntimeTransport,
  type AuthenticationWorkflowSnapshotRuntimeResponse,
} from './runtime-message-adapter'

export enum SidePanelPageWorkflowKind {
  /** Rust selected one of the document's forms as the workflow. */
  Selected = 'selected',
  /** No authentication form, or none that Rust selected. */
  None = 'none',
  /** A preparation or transport step could not complete. */
  Unavailable = 'unavailable',
}

/** The workflow Rust selected among the top document's forms. */
export type SidePanelSelectedPageWorkflow = {
  readonly kind: SidePanelPageWorkflowKind.Selected
  readonly snapshot: AuthenticationWorkflowSnapshot
  readonly savedLoginCapability: AuthenticationSavedLoginCapability
  readonly workflow: PasswordFormObservation
}

export type SidePanelPageWorkflow =
  | SidePanelSelectedPageWorkflow
  | { readonly kind: SidePanelPageWorkflowKind.None }
  | { readonly kind: SidePanelPageWorkflowKind.Unavailable }

export interface SidePanelPageWorkflowSource {
  pageWorkflow(): Promise<SidePanelPageWorkflow>
}

/** A preparation or transport step of the discovery could not complete. */
class SidePanelPageWorkflowFailure extends Data.TaggedError(
  'SidePanelPageWorkflowFailure',
) {}

type ClassifiedWorkflows =
  readonly ClassifiedAuthenticationWorkflowObservation[]

type SidePanelWorkflowSelectionRequest = {
  readonly classified: ClassifiedWorkflows
  readonly response: AuthenticationWorkflowSnapshotRuntimeResponse
}

type SidePanelSelectedObservationRequest = {
  readonly classified: ClassifiedWorkflows
  readonly snapshot: AuthenticationWorkflowSnapshot
  readonly capability: AuthenticationSavedLoginCapability
}

type SidePanelWorkflowAttempt<Value> = {
  readonly try: () => Promise<Value>
  readonly catch: () => SidePanelPageWorkflowFailure
}

/**
 * Observes the top document's authentication forms and asks Rust which one
 * is the workflow, with its kind, action and saved-login capability. Every
 * side-panel page request (the page need, Fill and Fill code) reads this one
 * classification; none of them decides a workflow in TypeScript.
 *
 * The page hints are the ones RevalidatedAuthenticationAction derives right
 * before a reveal and again before a write (the prepared authenticator setup
 * observation and the document backup-code hint), so the workflow Rust
 * selects here is the one those revalidations re-derive. Pilot's scan instead
 * folds recovery copy into enrollment hints to choose its widget, which the
 * side panel does not need.
 */
export class SidePanelPageWorkflowDiscovery implements SidePanelPageWorkflowSource {
  private readonly none: SidePanelPageWorkflow = {
    kind: SidePanelPageWorkflowKind.None,
  }
  private readonly unavailable: SidePanelPageWorkflow = {
    kind: SidePanelPageWorkflowKind.Unavailable,
  }
  private readonly generatorContext: SidePanelPageWorkflowGeneratorContext = {
    self: this,
  }

  pageWorkflow(): Promise<SidePanelPageWorkflow> {
    return Effect.runPromise(
      this.discover().pipe(
        Effect.catchTag('SidePanelPageWorkflowFailure', () =>
          Effect.succeed(this.unavailable),
        ),
      ),
    )
  }

  private attempt<Value>(
    run: () => Promise<Value>,
  ): Effect.Effect<Value, SidePanelPageWorkflowFailure> {
    const attempt: SidePanelWorkflowAttempt<Value> = {
      try: run,
      catch: () => new SidePanelPageWorkflowFailure(),
    }
    return Effect.tryPromise(attempt)
  }

  private discover = Effect.fn(this.generatorContext, function* () {
    yield* this.attempt(() =>
      passwordFieldDiscovery.prepareCompanionClassification(document),
    )
    const setup = yield* this.attempt(() =>
      pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation(),
    )
    const backupCodesHint =
      recoveryCopyObservation.pageHasDocumentBackupCodeHint()
    const policies: Parameters<
      typeof passwordFormInteraction.prepareCompanionWorkflowPolicies
    >[0] = { authenticatorSetupHint: setup.observation, backupCodesHint }
    yield* this.attempt(() =>
      passwordFormInteraction.prepareCompanionWorkflowPolicies(policies),
    )
    const classification: ConstructorParameters<
      typeof AuthenticationWorkflowClassification
    >[0] = {
      workflowForms: passwordFormInteraction
        .summarizeAuthenticationWorkflowForms()
        .slice(0, MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS),
      authenticatorSetupHint: setup.observation,
      backupCodesHint,
    }
    const classified = new AuthenticationWorkflowClassification(classification)
      .observations
    switch (classified.length) {
      case 0:
        return this.none
      default:
        break
    }
    const message: AuthenticationWorkflowSnapshotMessage = {
      type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
      payload: {
        origin: location.origin,
        observations: classified.map((candidate) => candidate.facts),
      },
    }
    const delivery = yield* this.attempt(() =>
      authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage(
        message,
      ),
    )
    switch (delivery.kind) {
      case RuntimeMessageDeliveryKind.Unavailable:
        return this.unavailable
      case RuntimeMessageDeliveryKind.Delivered:
        break
    }
    const selection: SidePanelWorkflowSelectionRequest = {
      classified,
      response: delivery.response,
    }
    return this.selected(selection)
  })

  private selected({
    classified,
    response,
  }: SidePanelWorkflowSelectionRequest): SidePanelPageWorkflow {
    const { verdict, selectedFacts, savedLoginCapability } = response
    switch (true) {
      case verdict.kind ===
        AuthenticationWorkflowSnapshotResponseKind.Matched &&
        'snapshot' in verdict &&
        selectedFacts.state === 'selected': {
        const observation: SidePanelSelectedObservationRequest = {
          classified,
          snapshot: verdict.snapshot,
          capability: savedLoginCapability,
        }
        return this.observation(observation)
      }
      case true:
      default:
        return this.none
    }
  }

  private observation({
    classified,
    snapshot,
    capability,
  }: SidePanelSelectedObservationRequest): SidePanelPageWorkflow {
    const selected = classified[snapshot.observationIndex]
    switch (true) {
      case !!selected:
        return {
          kind: SidePanelPageWorkflowKind.Selected,
          snapshot,
          savedLoginCapability: capability,
          workflow: selected.observation,
        }
      case true:
      default:
        return this.none
    }
  }
}

type SidePanelPageWorkflowGeneratorContext = {
  readonly self: SidePanelPageWorkflowDiscovery
}
