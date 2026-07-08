<script lang="ts">
  import { Check, Copy } from '@lucide/svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    enrollmentLink,
    instruction = '',
    issuedSuffix = '',
    linkTitle,
    linkDescription,
    passwordReminder = '',
    copyBtnTestId = 'copy-onboard-link-btn',
    linkInputTestId = 'onboarding-link-url',
    linkSrOnlyTestId = 'onboard-link',
    resultTestId = 'onboard-enrollment-result',
  }: {
    vault: VaultState
    enrollmentLink: string
    instruction?: string
    issuedSuffix?: string
    linkTitle: string
    linkDescription: string
    passwordReminder?: string
    copyBtnTestId?: string
    linkInputTestId?: string
    linkSrOnlyTestId?: string
    resultTestId?: string
  } = $props()

  let copied = $state(false)

  async function copyLink() {
    if (!enrollmentLink) return
    try {
      await navigator.clipboard.writeText(enrollmentLink)
      copied = true
      setTimeout(() => {
        copied = false
      }, 1500)
    } catch {
      // best effort
    }
  }
</script>

<div
  class="space-y-4 rounded-lg border border-border bg-background p-3"
  data-testid={resultTestId}
>
  {#if instruction || issuedSuffix}
    <p class="text-xs text-muted-foreground text-pretty">
      {instruction}
      {#if issuedSuffix}
        <span class="ml-1 text-muted-foreground/80">{issuedSuffix}</span>
      {/if}
    </p>
  {/if}

  <div class="flex justify-center">
    <EnrollmentQrCode
      {enrollmentLink}
      loadingLabel={vault.t('onboard_device.generating_qr')}
    />
  </div>

  <div class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <label
        for="enrollment-link-field"
        class="text-sm font-semibold text-foreground"
      >
        {linkTitle}
      </label>
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        onclick={copyLink}
        data-testid={copyBtnTestId}
      >
        {#if copied}
          <Check class="size-3" />
          {vault.t('onboard_device.copied_link')}
        {:else}
          <Copy class="size-3" />
          {vault.t('onboard_device.copy_link')}
        {/if}
      </button>
    </div>
    <p class="text-xs text-muted-foreground text-pretty">{linkDescription}</p>
    <input
      id="enrollment-link-field"
      type="text"
      readonly
      value={enrollmentLink}
      data-testid={linkInputTestId}
      class="h-10 w-full cursor-text rounded-md border border-border bg-muted/30 px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      onclick={(event) => {
        event.currentTarget.select()
      }}
    />
    <span class="sr-only" data-testid={linkSrOnlyTestId}>{enrollmentLink}</span>
  </div>

  {#if passwordReminder}
    <p class="text-xs text-muted-foreground text-pretty">{passwordReminder}</p>
  {/if}
</div>
