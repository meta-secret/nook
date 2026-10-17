import { Effect } from 'effect'
import {
  AuthenticationWorkflowKind,
  AuthenticationWorkflowSnapshotResponseKind,
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

type ClassifiedWorkflows =
  readonly ClassifiedAuthenticationWorkflowObservation[]

type SidePanelWorkflowSelectionRequest = {
  readonly classified: ClassifiedWorkflows
  readonly response: AuthenticationWorkflowSnapshotRuntimeResponse
}

type SidePanelLoginSelectionRequest = {
  readonly classified: ClassifiedWorkflows
  readonly snapshot: AuthenticationWorkflowSnapshot
}

/**
 * Observes the document's authentication forms the way Pilot's scan does and
 * asks Rust which one is the workflow. Only a Rust Login classification,
 * including a username-only step, is a form Fill may write into.
 */
export class SidePanelLoginWorkflowDiscovery implements SidePanelLoginWorkflowSource {
  private readonly absent: SidePanelLoginWorkflow = {
    kind: SidePanelLoginWorkflowKind.Absent,
  }
  private readonly generatorContext: SidePanelLoginWorkflowGeneratorContext = {
    self: this,
  }

  loginWorkflow(): Promise<SidePanelLoginWorkflow> {
    return Effect.runPromise(this.discover())
  }

  private discover = Effect.fn(this.generatorContext, function* () {
    yield* Effect.promise(() =>
      passwordFieldDiscovery.prepareCompanionClassification(document),
    )
    const setup = yield* Effect.promise(() =>
      pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation(),
    )
    const backupCodesHint =
      recoveryCopyObservation.pageHasDocumentBackupCodeHint()
    const policies: Parameters<
      typeof passwordFormInteraction.prepareCompanionWorkflowPolicies
    >[0] = { authenticatorSetupHint: setup.observation, backupCodesHint }
    yield* Effect.promise(() =>
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
    const delivery = yield* Effect.promise(() =>
      authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage(
        message,
      ),
    )
    switch (delivery.kind) {
      case RuntimeMessageDeliveryKind.Unavailable: {
        const unavailable: SidePanelLoginWorkflow = {
          kind: SidePanelLoginWorkflowKind.Unavailable,
        }
        return unavailable
      }
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
    const { verdict, selectedFacts } = response
    switch (true) {
      case verdict.kind ===
        AuthenticationWorkflowSnapshotResponseKind.Matched &&
        'snapshot' in verdict &&
        selectedFacts.state === 'selected': {
        const login: SidePanelLoginSelectionRequest = {
          classified,
          snapshot: verdict.snapshot,
        }
        return this.login(login)
      }
      case true:
      default:
        return this.absent
    }
  }

  private login({
    classified,
    snapshot,
  }: SidePanelLoginSelectionRequest): SidePanelLoginWorkflow {
    switch (snapshot.kind) {
      case AuthenticationWorkflowKind.Login:
        break
      case AuthenticationWorkflowKind.Signup:
      case AuthenticationWorkflowKind.PasswordChange:
      case AuthenticationWorkflowKind.TotpChallenge:
      case AuthenticationWorkflowKind.TotpEnrollment:
      case AuthenticationWorkflowKind.Manual:
        return this.absent
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
