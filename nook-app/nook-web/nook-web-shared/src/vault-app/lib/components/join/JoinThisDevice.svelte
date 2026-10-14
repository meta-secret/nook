<!--
The one place a new browser joins an existing identity. It shows who is
added where (this device, to the identity your other device already has),
what happens (the sync provider carries the encrypted vaults here), and the
steps on each device. An invite link opened on this device arrives with its
code filled in; only the passphrase is left.
-->
<script lang="ts">
  import { CheckCircle2, Cloud, RefreshCw } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import FirstRunBackLink from "$lib/components/login/FirstRunBackLink.svelte";
  import type { EnrollmentCodeUnlock } from "$lib/components/login/login-create-vault-chooser-contract";
  import type { VaultState } from "$lib/vault.svelte";
  import { IdentityJoinKind } from "$lib/vault/identity-control.svelte";
  import JoinFlowDiagram from "./JoinFlowDiagram.svelte";
  import JoinSteps from "./JoinSteps.svelte";
  import { JoinSide, JoinStep } from "./join-flow";

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
  const current = $derived.by(() => {
    switch (vault.identityControl.join.kind) {
      case IdentityJoinKind.Pending:
        return JoinStep.Approve;
      case IdentityJoinKind.Approved:
        return JoinStep.Download;
      case IdentityJoinKind.Idle:
        // Until a link is here, the invite may not exist yet.
        return joinCode ? JoinStep.Redeem : JoinStep.Invite;
    }
  });

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
  class="mx-auto grid w-full max-w-5xl gap-6 py-6 text-left sm:py-10"
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

  <header class="space-y-2">
    <p class="nk-label">{vault.t(I18N_KEYS.JoinEyebrow)}</p>
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.JoinTitle)}
    </h1>
    <p class="max-w-[68ch] text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.JoinLead)}
    </p>
  </header>

  <JoinFlowDiagram {vault} side={JoinSide.Joining} />

  <div
    class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]"
  >
    <JoinSteps {vault} {current} />

    {#if current === JoinStep.Invite || current === JoinStep.Redeem}
      <form
        class="grid gap-4 border border-foreground bg-card p-4 sm:p-5"
        data-testid="join-form"
        onsubmit={submit}
      >
        {#if linkReceived}
          <p
            class="inline-flex items-center gap-2 text-sm font-medium text-foreground"
            data-testid="join-link-received"
          >
            <CheckCircle2 class="size-4 text-success" aria-hidden="true" />
            {vault.t(I18N_KEYS.JoinLinkReceived)}
          </p>
        {:else}
          <div class="grid gap-1.5">
            <label
              for="join-link-input"
              class="text-sm font-medium text-foreground"
            >
              {vault.t(I18N_KEYS.JoinLinkLabel)}
            </label>
            <textarea
              id="join-link-input"
              rows="3"
              class="w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed focus:ring-2 focus:ring-ring focus:outline-none"
              placeholder={vault.t(I18N_KEYS.LoginPastePlaceholder)}
              bind:value={linkInput}
              data-testid="enrollment-code-input"
            ></textarea>
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
            class="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:ring-2 focus:ring-ring focus:outline-none"
            bind:value={passphraseInput}
            autocomplete="one-time-code"
            data-testid="enrollment-password-input"
          />
        </div>
        <Button
          type="submit"
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
          class="flex items-start gap-2 text-xs text-pretty text-muted-foreground"
          data-testid="join-requirement"
        >
          <Cloud class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {vault.t(I18N_KEYS.JoinRequirement)}
        </p>
      </form>
    {/if}
  </div>
</section>
