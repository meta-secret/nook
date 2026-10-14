<!--
The one place a new browser joins an existing identity: what happens in a
sentence and a small diagram, where to get the invite, and the form. An
invite link opened on this device arrives with its code filled in; only
the passphrase is left. Once submitted, the identities hub shows the wait
for approval.
-->
<script lang="ts">
  import { CheckCircle2, RefreshCw } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import FirstRunBackLink from "$lib/components/login/FirstRunBackLink.svelte";
  import ICloudEnrollmentAuth from "$lib/components/login/ICloudEnrollmentAuth.svelte";
  import type { EnrollmentCodeUnlock } from "$lib/components/login/login-create-vault-chooser-contract";
  import type { VaultState } from "$lib/vault.svelte";
  import { IdentityJoinKind } from "$lib/vault/identity-control.svelte";
  import JoinFlowDiagram from "./JoinFlowDiagram.svelte";
  import { JoinSide } from "./join-flow";

  let {
    vault,
    isVerifying,
    code = "",
    onUseEnrollmentCode,
    onBack,
  }: {
    vault: VaultState;
    isVerifying: boolean;
    /** The code from an invite link opened on this device. */
    code?: string;
    onUseEnrollmentCode: (
      request: EnrollmentCodeUnlock,
    ) => void | Promise<void>;
    /** Absent when the invite link itself opened this screen. */
    onBack?: () => void;
  } = $props();

  let linkInput = $state("");
  let passphraseInput = $state("");

  const linkReceived = $derived(Boolean(code));
  const joinCode = $derived(linkReceived ? code : linkInput.trim());
  const requested = $derived(
    vault.identityControl.join.kind !== IdentityJoinKind.Idle,
  );

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!joinCode || !passphraseInput.trim()) return;
    const request: EnrollmentCodeUnlock = {
      code: joinCode,
      password: passphraseInput,
    };
    void onUseEnrollmentCode(request);
  }
</script>

<section
  class="mx-auto grid w-full max-w-md gap-7 py-10 sm:py-16"
  data-testid="join-this-device"
>
  {#if onBack}
    <FirstRunBackLink
      {vault}
      testId="join-back"
      disabled={isVerifying}
      {onBack}
    />
  {/if}

  <header class="space-y-2 text-center">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.JoinTitle)}
    </h1>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.JoinSubtitle)}
    </p>
  </header>

  <JoinFlowDiagram {vault} side={JoinSide.Joining} />

  {#if !requested}
    <form class="grid gap-4" data-testid="join-form" onsubmit={submit}>
      {#if linkReceived}
        <p
          class="inline-flex items-center gap-2 text-sm font-medium text-foreground"
          data-testid="join-link-received"
        >
          <CheckCircle2 class="size-4 text-success" aria-hidden="true" />
          {vault.t(I18N_KEYS.JoinLinkReceived)}
        </p>
      {:else}
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.JoinInstruction)}
        </p>
        <div class="grid gap-1.5">
          <label for="join-link-input" class="text-sm font-medium text-foreground">
            {vault.t(I18N_KEYS.JoinLinkLabel)}
          </label>
          <input
            id="join-link-input"
            type="text"
            class="h-10 w-full border border-border bg-card px-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={vault.t(I18N_KEYS.LoginPastePlaceholder)}
            autocomplete="off"
            bind:value={linkInput}
            data-testid="enrollment-code-input"
          />
        </div>
      {/if}
      <div class="grid gap-1.5">
        <label
          for="join-passphrase-input"
          class="text-sm font-medium text-foreground"
        >
          {vault.t(I18N_KEYS.JoinPassphraseLabel)}
        </label>
        <input
          id="join-passphrase-input"
          type="password"
          class="h-10 w-full border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
          bind:value={passphraseInput}
          autocomplete="one-time-code"
          data-testid="enrollment-password-input"
        />
      </div>
      <ICloudEnrollmentAuth {vault} />
      <Button
        type="submit"
        class="h-10"
        disabled={isVerifying || !joinCode || !passphraseInput.trim()}
        data-testid="submit-enrollment-code-btn"
      >
        {#if isVerifying}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t(I18N_KEYS.JoinSubmitting)}
        {:else}
          {vault.t(I18N_KEYS.JoinSubmit)}
        {/if}
      </Button>
      <p
        class="text-center font-mono text-[11px] tracking-[0.04em] text-muted-foreground"
        data-testid="join-requirement"
      >
        {vault.t(I18N_KEYS.JoinRequirement)}
      </p>
    </form>
  {/if}
</section>
