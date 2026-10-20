<!--
The extension's device-protection ceremony, shared by the Nook tab and the
side panel: set up the key (an existing passkey or a new one, side by side;
a PIN where passkeys cannot work) and unlock it again. Setup keeps a passkey
autofill request open: clicking the passkey field lists only the Nook
passkeys the browser holds, with no dialog when there are none. Chromium
browsers quit on an immediate (uiMode) request from an extension page, so the
ceremony never sends one. When the browser's picker closes without a passkey,
the ceremony offers creating one or looking again; it never starts creating
one by itself. Each surface frames this ceremony with its own heading art; the
controls, messages and Rust/WASM calls live here once.
-->
<script lang="ts">
  import { Effect } from 'effect'
  import { Fingerprint, KeyRound } from '@lucide/svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { DeviceProtectionSetupWorkflow } from '../../../nook-web-shared/src/vault-app/lib/components/device-protection-gate-state'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import {
    DeviceMode,
    DeviceProtectionStatus,
    type ExtensionSessionDeviceWire,
    PasskeyRecoveryPrompt,
    type PasskeyRecoveryRequest,
    extensionWasmRuntime,
  } from '../lib/nook-wasm'
  import {
    DeviceProtectionActivity,
    DeviceProtectionAttempt,
    DeviceProtectionCopy,
    DeviceProtectionFailureKind,
    DeviceProtectionFailureMap,
    DeviceProtectionFocus,
    DeviceProtectionNoticeKind,
    DeviceProtectionNoticePlace,
    DeviceProtectionPurposeKind,
    DeviceProtectionStage,
    DeviceProtectionStageMap,
    IdentityKeyCancelOutcome,
    PasskeyNotAllowedMap,
    PasskeyNotAllowedOutcome,
    PasskeyNotAllowedReaction,
    type PasskeyNotAllowedRequest,
    type DeviceProtectionCopyRequest,
    type DeviceProtectionFailure,
    type DeviceProtectionFailureRequest,
    type DeviceProtectionNotice,
    type DeviceProtectionPurpose,
    type DeviceProtectionUnlock,
    type IdentityKeyCancel,
  } from './device-protection-ceremony'
  import { DeviceActionFollowUp } from './popup-app-state'

  type ExtensionDeviceProtectionProps = {
    readonly i18n: ExtensionI18n
    /** The host owns the status; the ceremony asks it to move to PIN
     * setup when passkeys cannot protect this browser. */
    readonly status: DeviceProtectionStatus
    readonly purpose: DeviceProtectionPurpose
    readonly onstatus: (status: DeviceProtectionStatus) => void
    readonly onunlocked: (unlock: DeviceProtectionUnlock) => void
  }

  type CeremonyStep = {
    readonly action: () => Promise<ExtensionSessionDeviceWire>
    readonly fallbackKey: I18nKey
    readonly followUp: DeviceActionFollowUp
    readonly notAllowed: PasskeyNotAllowedReaction
  }

  /** A failed step and what it does when the browser did not let it
   * finish. */
  type CeremonyFailure = {
    readonly failure: DeviceProtectionFailure
    readonly reaction: PasskeyNotAllowedReaction
  }

  /** One step to perform, and whether its result still applies once it
   * settles: a stopped autofill request's result does not. */
  type CeremonyRun = {
    readonly step: CeremonyStep
    readonly current: () => boolean
  }

  type CeremonyAttempt = Parameters<
    typeof Effect.tryPromise<
      ExtensionSessionDeviceWire,
      DeviceProtectionFailure
    >
  >[0]

  let {
    i18n,
    status,
    purpose,
    onstatus,
    onunlocked,
  }: ExtensionDeviceProtectionProps = $props()

  function initialWorkflow(): DeviceProtectionSetupWorkflow {
    return DeviceProtectionStageMap.initialWorkflow(purpose.kind)
  }

  let activity = $state<DeviceProtectionActivity>(DeviceProtectionActivity.Idle)
  let notice = $state<DeviceProtectionNotice>({
    kind: DeviceProtectionNoticeKind.None,
  })
  let setupWorkflow = $state<DeviceProtectionSetupWorkflow>(initialWorkflow())
  let passkeyLabel = $state('')
  let deviceMode = $state<DeviceMode>(DeviceMode.Standard)
  let pin = $state('')
  let pinConfirm = $state('')
  let attempt = $state<DeviceProtectionAttempt>(DeviceProtectionAttempt.first())

  const stage = $derived(DeviceProtectionStageMap.from(status))
  const copyRequest = $derived<DeviceProtectionCopyRequest>({
    stage,
    purpose: purpose.kind,
    workflow: setupWorkflow,
  })
  const pending = $derived(activity === DeviceProtectionActivity.Pending)
  const focus = $derived(new DeviceProtectionFocus(attempt))
  const noticePlace = $derived(DeviceProtectionStageMap.noticePlace(stage))
  const autofillWanted = $derived(
    DeviceProtectionStageMap.offersAutofill(copyRequest) &&
      activity === DeviceProtectionActivity.Idle,
  )
  /** The passkey autofill request. Its signal is aborted once the request
   * has ended, and another passkey prompt aborts it first, since the
   * browser runs one request at a time. */
  let autofill = new AbortController()

  $effect(() => {
    switch (autofillWanted) {
      case false:
        return
      case true:
        break
    }
    startAutofill()
    return () => autofill.abort()
  })

  function startAutofill(): void {
    const controller = new AbortController()
    autofill = controller
    void listenForAutofill(controller)
  }

  /** A try that ended leaves no request open: clicking the field again
   * opens a new one. It never restarts by itself, so a browser that refuses
   * autofill at once cannot loop. */
  function reopenAutofill(): void {
    switch (autofill.signal.aborted && autofillWanted) {
      case true:
        startAutofill()
        return
      case false:
        return
    }
  }

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  /** The action's label, or the waiting label while it runs. */
  function actionLabel(key: I18nKey): string {
    switch (activity) {
      case DeviceProtectionActivity.Idle:
        return translatePlain(key)
      case DeviceProtectionActivity.Pending:
        return translatePlain(I18N_KEYS.DeviceProtectionAuthorizing)
    }
  }

  function pinUnlockLabel(): string {
    switch (activity) {
      case DeviceProtectionActivity.Idle:
        return translatePlain(I18N_KEYS.ExtensionDeviceSetupUnlockAction)
      case DeviceProtectionActivity.Pending:
        return translatePlain(I18N_KEYS.LoginUnlocking)
    }
  }

  function show(key: I18nKey): void {
    notice = { kind: DeviceProtectionNoticeKind.Shown, key }
  }

  /** Leaves an empty notice alone, so focus attachments do not re-run. */
  function clearNotice(): void {
    switch (notice.kind) {
      case DeviceProtectionNoticeKind.None:
        return
      case DeviceProtectionNoticeKind.Shown:
        notice = { kind: DeviceProtectionNoticeKind.None }
    }
  }

  /** A PIN or passphrase lives only for the try that uses it: it is
   * dropped as soon as that try settles, whatever its outcome. */
  function forgetPin(): void {
    pin = ''
    pinConfirm = ''
  }

  /** A failed try: say why and return focus to the stage. */
  function failed(): void {
    forgetPin()
    attempt = attempt.next()
  }

  function present(ceremonyFailure: CeremonyFailure): void {
    const { failure, reaction } = ceremonyFailure
    switch (failure.kind) {
      case DeviceProtectionFailureKind.PinFallback:
        onstatus(DeviceProtectionStatus.PinSetup)
        show(failure.notice)
        return
      case DeviceProtectionFailureKind.Message:
        show(failure.message)
        return
      case DeviceProtectionFailureKind.NotAllowed:
        break
    }
    const notAllowed: PasskeyNotAllowedRequest = {
      reaction,
      workflow: setupWorkflow,
    }
    switch (PasskeyNotAllowedMap.outcome(notAllowed)) {
      case PasskeyNotAllowedOutcome.ShowChoice:
        setupWorkflow = DeviceProtectionSetupWorkflow.NotFound
        return
      case PasskeyNotAllowedOutcome.ShowNotice:
        show(failure.message)
    }
  }

  async function run(step: CeremonyStep): Promise<void> {
    switch (activity) {
      case DeviceProtectionActivity.Pending:
        return
      case DeviceProtectionActivity.Idle:
        break
    }
    autofill.abort()
    activity = DeviceProtectionActivity.Pending
    clearNotice()
    const ceremonyRun: CeremonyRun = { step, current: () => true }
    await perform(ceremonyRun)
  }

  /** Waits for the person to pick a passkey from the field's suggestions.
   * A browser without passkey autofill offers none; the field then only
   * explains, and creating or the picker stay available. */
  async function listenForAutofill(controller: AbortController): Promise<void> {
    const { signal } = controller
    switch (await extensionWasmRuntime.passkeyAutofillAvailable()) {
      case false:
        return
      case true:
        break
    }
    const request: PasskeyRecoveryRequest = {
      prompt: PasskeyRecoveryPrompt.Autofill,
      signal,
    }
    const step: CeremonyStep = {
      action: () => extensionWasmRuntime.recoverExtensionPasskey(request),
      fallbackKey: I18N_KEYS.ExtensionDeviceSetupPasskeyUseNotAllowed,
      followUp: DeviceActionFollowUp.Menu,
      notAllowed: PasskeyNotAllowedReaction.Notice,
    }
    const ceremonyRun: CeremonyRun = { step, current: () => !signal.aborted }
    await perform(ceremonyRun)
    controller.abort()
  }

  async function perform(ceremonyRun: CeremonyRun): Promise<void> {
    const { step, current } = ceremonyRun
    const ceremonyAttempt: CeremonyAttempt = {
      try: () => step.action(),
      catch: (caught) => {
        const request: DeviceProtectionFailureRequest = {
          reported: String(caught),
          fallbackKey: step.fallbackKey,
        }
        return DeviceProtectionFailureMap.from(request)
      },
    }
    const outcome = await Effect.runPromise(
      Effect.result(Effect.tryPromise(ceremonyAttempt)),
    )
    switch (current()) {
      case false:
        return
      case true:
        break
    }
    activity = DeviceProtectionActivity.Idle
    switch (outcome._tag) {
      case 'Success': {
        forgetPin()
        const unlock: DeviceProtectionUnlock = {
          device: outcome.success,
          followUp: step.followUp,
        }
        onunlocked(unlock)
        return
      }
      case 'Failure': {
        failed()
        const ceremonyFailure: CeremonyFailure = {
          failure: outcome.failure,
          reaction: step.notAllowed,
        }
        present(ceremonyFailure)
      }
    }
  }

  function useExistingPasskey(): void {
    const request: PasskeyRecoveryRequest = {
      prompt: PasskeyRecoveryPrompt.Picker,
    }
    const step: CeremonyStep = {
      action: () => extensionWasmRuntime.recoverExtensionPasskey(request),
      fallbackKey: I18N_KEYS.ExtensionDeviceSetupPasskeyUseNotAllowed,
      followUp: DeviceActionFollowUp.Menu,
      notAllowed: PasskeyNotAllowedReaction.OfferChoice,
    }
    void run(step)
  }

  function createPasskey(): void {
    const createArgs: Parameters<
      typeof extensionWasmRuntime.createExtensionPasskey
    >[0] = { passkeyLabel, deviceMode }
    const step: CeremonyStep = {
      action: () => extensionWasmRuntime.createExtensionPasskey(createArgs),
      fallbackKey: I18N_KEYS.ExtensionDeviceSetupPasskeyCreateNotAllowed,
      followUp: DeviceActionFollowUp.Menu,
      notAllowed: PasskeyNotAllowedReaction.Notice,
    }
    void run(step)
  }

  function unlockPasskey(): void {
    const step: CeremonyStep = {
      action: () => extensionWasmRuntime.unlockExtensionPasskey(),
      fallbackKey: I18N_KEYS.ExtensionDeviceSetupPasskeyUnlockNotAllowed,
      followUp: DeviceActionFollowUp.RefreshIdentity,
      notAllowed: PasskeyNotAllowedReaction.Notice,
    }
    void run(step)
  }

  function createPin(event: SubmitEvent): void {
    event.preventDefault()
    switch (pin === pinConfirm) {
      case false:
        failed()
        show(I18N_KEYS.DeviceProtectionPinMismatch)
        return
      case true:
        break
    }
    const value = pin
    const step: CeremonyStep = {
      action: () => extensionWasmRuntime.createExtensionPin(value),
      fallbackKey: I18N_KEYS.DeviceProtectionPinSetupFailed,
      followUp: DeviceActionFollowUp.Menu,
      notAllowed: PasskeyNotAllowedReaction.Notice,
    }
    void run(step)
  }

  function unlockPin(event: SubmitEvent): void {
    event.preventDefault()
    switch (pin.length) {
      case 0:
        return
      default:
        break
    }
    const value = pin
    const step: CeremonyStep = {
      action: () => extensionWasmRuntime.unlockExtensionPin(value),
      fallbackKey: I18N_KEYS.DeviceProtectionPinUnlockFailed,
      followUp: DeviceActionFollowUp.RefreshIdentity,
      notAllowed: PasskeyNotAllowedReaction.Notice,
    }
    void run(step)
  }

  function chooseWorkflow(workflow: DeviceProtectionSetupWorkflow): void {
    switch (activity) {
      case DeviceProtectionActivity.Pending:
        return
      case DeviceProtectionActivity.Idle:
        setupWorkflow = workflow
        clearNotice()
    }
  }

  function cancelIdentityKey(): void {
    switch (purpose.kind) {
      case DeviceProtectionPurposeKind.ExtensionKey:
        return
      case DeviceProtectionPurposeKind.IdentityKey:
        void runCancel(purpose.cancel)
    }
  }

  async function runCancel(cancel: IdentityKeyCancel): Promise<void> {
    switch (activity) {
      case DeviceProtectionActivity.Pending:
        return
      case DeviceProtectionActivity.Idle:
        break
    }
    activity = DeviceProtectionActivity.Pending
    clearNotice()
    const cancelled = await cancel()
    activity = DeviceProtectionActivity.Idle
    switch (cancelled) {
      case IdentityKeyCancelOutcome.Cancelled:
        return
      case IdentityKeyCancelOutcome.Failed:
        show(I18N_KEYS.ExtensionCompanionConnectIdentityFailed)
    }
  }
</script>

{#snippet noticeBlock()}
  <div id="device-protection-notice" class="device-protection-notice">
    {#if notice.kind === DeviceProtectionNoticeKind.Shown}
      <p
        class="error-message"
        role="alert"
        data-testid="device-protection-error"
      >
        {translatePlain(notice.key)}
      </p>
    {/if}
  </div>
{/snippet}

<h1 class="device-protection-title" data-testid="device-protection-title">
  {translatePlain(DeviceProtectionCopy.title(copyRequest))}
</h1>
<p class="description">
  {translatePlain(DeviceProtectionCopy.description(copyRequest))}
</p>

{#if stage === DeviceProtectionStage.PinSetup}
  <form class="device-protection-form" onsubmit={createPin}>
    <div class="field-group">
      <label for="device-protection-pin">
        {translatePlain(I18N_KEYS.DeviceProtectionPinLabel)}
      </label>
      <input
        id="device-protection-pin"
        type="password"
        inputmode="numeric"
        autocomplete="new-password"
        bind:value={pin}
        readonly={pending}
        aria-describedby="device-protection-notice"
        data-testid="device-protection-pin-input"
        {@attach focus.enter}
      />
    </div>
    <div class="field-group">
      <label for="device-protection-pin-confirm">
        {translatePlain(I18N_KEYS.DeviceProtectionPinConfirmLabel)}
      </label>
      <input
        id="device-protection-pin-confirm"
        type="password"
        inputmode="numeric"
        autocomplete="new-password"
        bind:value={pinConfirm}
        readonly={pending}
        aria-describedby="device-protection-notice"
        data-testid="device-protection-pin-confirm"
      />
    </div>
    <p class="field-hint">
      {translatePlain(I18N_KEYS.DeviceProtectionPinSecurityNote)}
    </p>
    {@render noticeBlock()}
    <button
      type="submit"
      aria-disabled={pending}
      aria-busy={pending}
      data-testid="device-protection-pin-setup-btn"
    >
      {actionLabel(I18N_KEYS.DeviceProtectionPinSetupAction)}
    </button>
  </form>
{:else if stage === DeviceProtectionStage.Setup && setupWorkflow === DeviceProtectionSetupWorkflow.Authenticate}
  <div class="field-group">
    <label for="device-protection-passkey">
      {translatePlain(I18N_KEYS.ExtensionDeviceSetupPasskeyFieldLabel)}
    </label>
    <input
      id="device-protection-passkey"
      type="text"
      autocomplete="username webauthn"
      placeholder={translatePlain(
        I18N_KEYS.ExtensionDeviceSetupPasskeyFieldPlaceholder,
      )}
      readonly={pending}
      aria-describedby="device-protection-passkey-hint device-protection-notice"
      data-testid="device-protection-passkey-field"
      onfocus={reopenAutofill}
      {@attach focus.enter}
    />
    <p id="device-protection-passkey-hint" class="field-hint">
      {translatePlain(I18N_KEYS.ExtensionDeviceSetupPasskeyFieldHint)}
    </p>
  </div>
  <button
    type="button"
    aria-disabled={pending}
    data-testid="device-protection-create-new-choice"
    onclick={() => chooseWorkflow(DeviceProtectionSetupWorkflow.Create)}
  >
    <KeyRound size={16} aria-hidden="true" />
    {translatePlain(I18N_KEYS.ExtensionDeviceSetupCreateOne)}
  </button>
  <p class="alternative-line">
    {translatePlain(I18N_KEYS.ExtensionDeviceSetupPasskeyOtherDevice)}
    <button
      type="button"
      class="link-button"
      aria-disabled={pending}
      aria-busy={pending}
      data-testid="device-protection-use-existing-choice"
      onclick={useExistingPasskey}
    >
      {actionLabel(I18N_KEYS.ExtensionDeviceSetupUseExisting)}
    </button>
  </p>
{:else if stage === DeviceProtectionStage.Setup && setupWorkflow === DeviceProtectionSetupWorkflow.NotFound}
  <button
    type="button"
    aria-disabled={pending}
    data-testid="device-protection-create-new-choice"
    onclick={() => chooseWorkflow(DeviceProtectionSetupWorkflow.Create)}
    {@attach focus.enter}
  >
    <KeyRound size={16} aria-hidden="true" />
    {translatePlain(I18N_KEYS.ExtensionDeviceSetupCreateAction)}
  </button>
  <p class="alternative-line">
    {translatePlain(I18N_KEYS.ExtensionDeviceSetupPasskeyElsewhere)}
    <button
      type="button"
      class="link-button"
      aria-disabled={pending}
      aria-busy={pending}
      data-testid="device-protection-use-existing-choice"
      onclick={useExistingPasskey}
    >
      {actionLabel(I18N_KEYS.ExtensionDeviceSetupUseExisting)}
    </button>
  </p>
{:else if stage === DeviceProtectionStage.Setup}
  <button
    type="button"
    aria-disabled={pending}
    aria-busy={pending}
    data-testid="device-protection-setup-btn"
    onclick={createPasskey}
  >
    <KeyRound size={16} aria-hidden="true" />
    {actionLabel(I18N_KEYS.ExtensionDeviceSetupCreateAction)}
  </button>
  <details class="setup-options">
    <summary>{translatePlain(I18N_KEYS.ExtensionDeviceSetupOptions)}</summary>
    <div class="field-group">
      <label for="device-protection-mode">
        {translatePlain(I18N_KEYS.DeviceProtectionModeGroupLabel)}
      </label>
      <select
        id="device-protection-mode"
        bind:value={deviceMode}
        disabled={pending}
        data-testid="device-mode-select"
      >
        <option value={DeviceMode.Standard}>
          {translatePlain(I18N_KEYS.DeviceProtectionModeStandardTitle)}
        </option>
        <option value={DeviceMode.AntiHacker}>
          {translatePlain(I18N_KEYS.DeviceProtectionModeAntiHackerTitle)}
        </option>
      </select>
      <p class="field-hint">
        {#if deviceMode === DeviceMode.Standard}
          {translatePlain(I18N_KEYS.DeviceProtectionModeStandardDescription)}
        {:else}
          {translatePlain(I18N_KEYS.DeviceProtectionModeAntiHackerDescription)}
        {/if}
      </p>
    </div>
    <div class="field-group">
      <label for="device-protection-label">
        {translatePlain(I18N_KEYS.DeviceProtectionPasskeyLabel)}
      </label>
      <input
        id="device-protection-label"
        type="text"
        autocomplete="off"
        placeholder={translatePlain(
          I18N_KEYS.DeviceProtectionPasskeyLabelPlaceholder,
        )}
        bind:value={passkeyLabel}
        readonly={pending}
        data-testid="device-protection-label-input"
      />
    </div>
  </details>
  {#if purpose.kind === DeviceProtectionPurposeKind.ExtensionKey}
    <p class="alternative-line">
      {translatePlain(I18N_KEYS.ExtensionDeviceSetupHavePasskey)}
      <button
        type="button"
        class="link-button"
        aria-disabled={pending}
        data-testid="device-protection-use-existing-choice"
        onclick={useExistingPasskey}
      >
        {translatePlain(I18N_KEYS.ExtensionDeviceSetupUseExisting)}
      </button>
    </p>
  {/if}
{:else if stage === DeviceProtectionStage.PinUnlock}
  <form class="device-protection-form" onsubmit={unlockPin}>
    <div class="field-group">
      <label for="device-protection-pin">
        {translatePlain(I18N_KEYS.DeviceProtectionPinLabel)}
      </label>
      <input
        id="device-protection-pin"
        type="password"
        inputmode="numeric"
        autocomplete="current-password"
        bind:value={pin}
        oninput={clearNotice}
        readonly={pending}
        aria-invalid={notice.kind === DeviceProtectionNoticeKind.Shown}
        aria-describedby="device-protection-notice"
        data-testid="device-protection-pin-unlock-input"
        {@attach focus.enter}
      />
    </div>
    {@render noticeBlock()}
    <button
      type="submit"
      aria-disabled={pending || pin.length === 0}
      aria-busy={pending}
      data-testid="device-protection-pin-unlock-btn"
    >
      {pinUnlockLabel()}
    </button>
  </form>
{:else}
  <button
    type="button"
    aria-disabled={pending}
    aria-busy={pending}
    data-testid="device-protection-unlock-btn"
    onclick={unlockPasskey}
    {@attach focus.enter}
  >
    <Fingerprint size={16} aria-hidden="true" />
    {actionLabel(I18N_KEYS.ExtensionDeviceSetupUnlockAction)}
  </button>
{/if}

{#if purpose.kind === DeviceProtectionPurposeKind.IdentityKey}
  <button
    type="button"
    class="secondary-button"
    aria-disabled={pending}
    data-testid="identity-key-cancel"
    onclick={cancelIdentityKey}
  >
    {translatePlain(I18N_KEYS.ExtensionDeviceSetupIdentityKeyCancel)}
  </button>
{/if}

{#if noticePlace === DeviceProtectionNoticePlace.AfterControls}
  {@render noticeBlock()}
{/if}
