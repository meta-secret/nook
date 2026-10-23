import { Deferred, Effect, Fiber } from "effect";
import { afterEach, expect, test, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("chrome", {
    runtime: { id: "nook-extension", onMessage: { addListener: () => {} } },
  });
  vi.stubGlobal("__NOOK_EXTENSION_DIAGNOSTICS_ENABLED__", false);
});
vi.mock(
  "../../../../nook-web-extension/src/content/autofill/companion-wasm-gate",
  () => ({
    queueSubmitCaptureUntilCompanionWasmReady: () => ({
      capture: () => {},
      discard: () => {},
      enable: () => {},
    }),
    runAfterCompanionWasmReady: async () => {},
  }),
);
vi.mock(
  "../../../../nook-web-extension/src/content/autofill/companion-wasm-readiness",
  () => ({
    companionWasmReadiness: { waitForExtensionClassification: async () => {} },
  }),
);

import { AuthenticationScanRenderLifecycle } from "../../../../nook-web-extension/src/content/autofill";
import {
  focusedCredentialInteraction,
  focusedCredentialTargetSensor,
} from "../../../../nook-web-extension/src/content/autofill/focused-credential-interaction";
import { FocusedCredentialTargetKind } from "../../../../nook-web-extension/src/content/autofill/focused-credential-target";
import {
  scanState,
  widgetState,
  WidgetCredentialActuation,
} from "../../../../nook-web-extension/src/content/autofill/state";
import { workflowUi } from "../../../../nook-web-extension/src/content/autofill/workflow-ui";
import { PilotVaultConnectionKind } from "../../../../nook-web-extension/src/content/autofill/widget-presentation-state";
import {
  authenticationRuntimeTransport,
  RuntimeMessageDeliveryKind,
} from "../../../../nook-web-extension/src/content/autofill/runtime-message-adapter";
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
} from "../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages";
import { FocusedCredentialOpportunity } from "../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js";
import { FocusedFieldRecognitionOperation } from "../../../../nook-web-extension/src/offscreen/session-focused-field-recognition";
import {
  passwordFieldDiscovery,
  passwordFormInteraction,
} from "../../../../nook-web-shared/src/extension/password-forms";
import {
  loginSaveInteraction,
  PendingSaveOfferLoadKind,
} from "../../../../nook-web-extension/src/content/autofill/login-save";
import { recoveryCopyObservation } from "../../../../nook-web-extension/src/lib/backup-code-candidates";
import { pageQrCapture } from "../../../../nook-web-extension/src/lib/page-qr-capture";
import { authenticatorEnrollmentInteraction } from "../../../../nook-web-extension/src/content/enrollment-flow";

enum ClassificationDelivery {
  Immediate = "immediate",
  Held = "held",
}
type TransitionFixtureContext = { readonly self: FocusedFormTransitionFixture };

class FocusedFormTransitionFixture {
  readonly form = document.createElement("form");
  readonly username = document.createElement("input");
  readonly password = document.createElement("input");
  readonly submitter = document.createElement("button");
  readonly submit = vi.fn<() => void>();
  readonly scheduled = vi.fn<() => void>();
  readonly started = Effect.runSync(Deferred.make<void>());
  readonly released = Effect.runSync(Deferred.make<void>());
  readonly recognitions: FocusedCredentialOpportunity[] = [];
  delivery = ClassificationDelivery.Immediate;
  readonly lifecycle = new AuthenticationScanRenderLifecycle({ scanState });
  private readonly generatorContext: TransitionFixtureContext = { self: this };

  constructor() {
    widgetState.dismissed = false;
    widgetState.busy = false;
    widgetState.credentialActuation = WidgetCredentialActuation.Idle;
    this.form.setAttribute("id", "login-form");
    this.form.setAttribute("class", "account-panel");
    this.form.setAttribute("method", "post");
    this.form.setAttribute("action", "/Account/Login");
    this.form.autocomplete = "off";
    const identity = document.createElement("input");
    identity.type = "hidden";
    identity.name = "id";
    const className = document.createElement("input");
    className.type = "hidden";
    className.name = "className";
    this.username.id = "username";
    this.username.name = "UserName";
    this.password.id = "password";
    this.password.name = "Password";
    this.password.type = "password";
    this.submitter.type = "submit";
    this.submitter.textContent = "Log In";
    this.form.append(
      identity,
      className,
      this.username,
      this.password,
      this.submitter,
    );
    this.form.addEventListener("submit", this.submit);
    this.form.addEventListener(
      "focusin",
      focusedCredentialTargetSensor.observe.bind(focusedCredentialTargetSensor),
    );
    document.body.append(this.form);
    vi.spyOn(scanState, "schedule").mockImplementation(this.scheduled);
    vi.spyOn(
      authenticatorEnrollmentInteraction,
      "enrollmentScanBlocked",
    ).mockReturnValue(false);
    vi.spyOn(
      passwordFieldDiscovery,
      "prepareCompanionClassification",
    ).mockImplementation(() => Effect.runPromise(Effect.void));
    vi.spyOn(
      passwordFormInteraction,
      "prepareCompanionWorkflowPolicies",
    ).mockImplementation(() => Effect.runPromise(Effect.void));
    vi.spyOn(
      recoveryCopyObservation,
      "prepareAuthenticationRecoveryEvidence",
    ).mockImplementation(() => Effect.runPromise(Effect.void));
    const setup: Awaited<
      ReturnType<
        typeof pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation
      >
    > = { metadataKey: "fixture", observation: "absent" };
    vi.spyOn(
      pageQrCapture,
      "prepareAuthenticationAuthenticatorSetupObservation",
    ).mockImplementation(() => Effect.runPromise(Effect.succeed(setup)));
    vi.spyOn(
      pageQrCapture,
      "authenticationAuthenticatorSetupSnapshotIsCurrent",
    ).mockReturnValue(true);
    const offer: Awaited<
      ReturnType<typeof loginSaveInteraction.loadPendingSaveOffer>
    > = { kind: PendingSaveOfferLoadKind.Absent };
    vi.spyOn(loginSaveInteraction, "loadPendingSaveOffer").mockImplementation(
      () => Effect.runPromise(Effect.succeed(offer)),
    );
    const connection: Awaited<
      ReturnType<typeof workflowUi.loadPilotVaultConnection>
    > = { kind: PilotVaultConnectionKind.Connected };
    vi.spyOn(workflowUi, "loadPilotVaultConnection").mockImplementation(() =>
      Effect.runPromise(Effect.succeed(connection)),
    );
    vi.spyOn(workflowUi, "translatedMessage").mockReturnValue(
      "Translated fixture",
    );
    vi.spyOn(
      authenticationRuntimeTransport,
      "sendCompanionWasmRuntimeMessage",
    ).mockImplementation(this.deliver.bind(this));
  }

  private recognition(message: CompanionWasmSessionMessage) {
    switch (message.type) {
      case CompanionWasmSessionMessageType.ClassifyFocusedCredentialField:
      case CompanionWasmSessionMessageType.RevalidateFocusedCredentialField:
        return new FocusedFieldRecognitionOperation(message).run();
      default:
        throw new Error("Expected the focused native recognition boundary");
    }
  }
  private deliver(message: CompanionWasmSessionMessage) {
    return Effect.runPromise(this.deliveryEffect(message));
  }
  private deliveryEffect = Effect.fn(
    this.generatorContext,
    function* (message: CompanionWasmSessionMessage) {
      const response = this.recognition(message);
      this.recognitions.push(response.focusedOpportunity);
      switch (this.delivery) {
        case ClassificationDelivery.Immediate:
          break;
        case ClassificationDelivery.Held:
          this.delivery = ClassificationDelivery.Immediate;
          yield* Deferred.succeed(this.started, void 0);
          yield* Deferred.await(this.released);
          break;
      }
      const delivery: Awaited<
        ReturnType<
          typeof authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage
        >
      > = { kind: RuntimeMessageDeliveryKind.Delivered, response };
      return delivery;
    },
  );

  run = Effect.fn(this.generatorContext, function* () {
    this.form.setAttribute("method", "get");
    this.submitter.remove();
    this.username.focus();
    yield* Effect.tryPromise(() => this.lifecycle.scanAndRender());
    expect(
      document
        .querySelector("#nook-auth-widget")
        ?.getAttribute("data-nook-credential-mode"),
    ).toBe("focused");
    expect(this.recognitions).toContain(FocusedCredentialOpportunity.Username);
    this.delivery = ClassificationDelivery.Held;
    const oldScan = yield* Effect.forkChild(
      Effect.tryPromise(() => this.lifecycle.scanAndRender()),
    );
    yield* Deferred.await(this.started);
    const sequence = scanState.sequence;
    this.password.focus();
    expect(scanState.sequence).toBe(sequence);
    expect(focusedCredentialTargetSensor.target).toMatchObject({
      kind: FocusedCredentialTargetKind.Retained,
      input: this.password,
    });
    yield* Deferred.succeed(this.released, void 0);
    yield* Fiber.join(oldScan);
    // Drive the scan already requested by focus; no new focus/click repairs the target.
    yield* Effect.tryPromise(() => this.lifecycle.scanAndRender());
    expect
      .soft(focusedCredentialTargetSensor.target)
      .toMatchObject({
        kind: FocusedCredentialTargetKind.Retained,
        input: this.password,
      });
    expect
      .soft(
        document
          .querySelector("#nook-auth-widget")
          ?.getAttribute("data-nook-credential-mode"),
      )
      .toBe("focused");
    expect
      .soft(this.recognitions)
      .toContain(FocusedCredentialOpportunity.CurrentPassword);
    expect(this.username.value).toBe("");
    expect(this.password.value).toBe("");
    expect(this.submit).not.toHaveBeenCalled();
  });
}

afterEach(() => {
  workflowUi.removeWidget();
  focusedCredentialInteraction.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test("preserves password focus when an older eligible username scan finishes after the POST-to-GET transition", () => {
  const fixture = new FocusedFormTransitionFixture();
  return Effect.runPromise(fixture.run());
});
