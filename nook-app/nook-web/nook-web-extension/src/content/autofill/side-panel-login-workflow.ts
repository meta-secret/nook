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

export enum SidePanelLoginWorkflowKind {
  Found = 'found',
  Absent = 'absent',
  Unavailable = 'unavailable',
}

/** The top document's login form, as Rust classified it when Fill arrived. */
export type SidePanelLoginWorkflow =
  | {
      readonly kind: SidePanelLoginWorkflowKind.Found
      readonly workflow: PasswordFormObservation
    }
  | { readonly kind: SidePanelLoginWorkflowKind.Absent }
  | { readonly kind: SidePanelLoginWorkflowKind.Unavailable }

export interface SidePanelLoginWorkflowSource {
  loginWorkflow(): Promise<SidePanelLoginWorkflow>
}

/** A preparation or transport step of the discovery could not complete. */
class SidePanelLoginWorkflowFailure extends Data.TaggedError(
  'SidePanelLoginWorkflowFailure',
) {}

type ClassifiedWorkflows =
  readonly ClassifiedAuthenticationWorkflowObservation[]

type SidePanelWorkflowSelectionRequest = {
  readonly classified: ClassifiedWorkflows
  readonly response: AuthenticationWorkflowSnapshotRuntimeResponse
}

type SidePanelFillableSelectionRequest = {
  readonly classified: ClassifiedWorkflows
  readonly snapshot: AuthenticationWorkflowSnapshot
  readonly capability: AuthenticationSavedLoginCapability
}

type SidePanelWorkflowAttempt<Value> = {
  readonly try: () => Promise<Value>
  readonly catch: () => SidePanelLoginWorkflowFailure
}

/**
 * Observes the document's authentication forms and asks Rust which one is
 * the workflow and whether a saved login may fill it. Only Rust's
 * fill-saved-login decision (a Login workflow, including a username-only
 * step) makes a form fillable.
 *
 * The page hints are the ones RevalidatedAuthenticationAction derives right
 * before the reveal and again before the write (the prepared authenticator
 * setup observation and the document backup-code hint), so the workflow Rust
 * selects here is the one those revalidations re-derive. Pilot's scan instead
 * folds recovery copy into enrollment hints to choose its widget, which a
 * login fill does not need.
 */
export class SidePanelLoginWorkflowDiscovery implements SidePanelLoginWorkflowSource {
  private readonly absent: SidePanelLoginWorkflow = {
    kind: SidePanelLoginWorkflowKind.Absent,
  }
  private readonly unavailable: SidePanelLoginWorkflow = {
    kind: SidePanelLoginWorkflowKind.Unavailable,
  }
  private readonly generatorContext: SidePanelLoginWorkflowGeneratorContext = {
    self: this,
  }

  loginWorkflow(): Promise<SidePanelLoginWorkflow> {
    return Effect.runPromise(
      this.discover().pipe(
        Effect.catchTag('SidePanelLoginWorkflowFailure', () =>
          Effect.succeed(this.unavailable),
        ),
      ),
    )
  }

  private attempt<Value>(
    run: () => Promise<Value>,
  ): Effect.Effect<Value, SidePanelLoginWorkflowFailure> {
    const attempt: SidePanelWorkflowAttempt<Value> = {
      try: run,
      catch: () => new SidePanelLoginWorkflowFailure(),
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
        return this.absent
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
  }: SidePanelWorkflowSelectionRequest): SidePanelLoginWorkflow {
    const { verdict, selectedFacts, savedLoginCapability } = response
    switch (true) {
      case verdict.kind ===
        AuthenticationWorkflowSnapshotResponseKind.Matched &&
        'snapshot' in verdict &&
        selectedFacts.state === 'selected': {
        const fillable: SidePanelFillableSelectionRequest = {
          classified,
          snapshot: verdict.snapshot,
          capability: savedLoginCapability,
        }
        return this.fillable(fillable)
      }
      case true:
      default:
        return this.absent
    }
  }

  private fillable({
    classified,
    snapshot,
    capability,
  }: SidePanelFillableSelectionRequest): SidePanelLoginWorkflow {
    switch (capability) {
      case 'unavailable':
        return this.absent
      case 'fill-saved-login':
        break
    }
    const selected = classified[snapshot.observationIndex]
    switch (true) {
      case !!selected:
        return {
          kind: SidePanelLoginWorkflowKind.Found,
          workflow: selected.observation,
        }
      case true:
      default:
        return this.absent
    }
  }
}

type SidePanelLoginWorkflowGeneratorContext = {
  readonly self: SidePanelLoginWorkflowDiscovery
}
