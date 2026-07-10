<script lang="ts">
  import { Cloud, Copy, RefreshCw, ShieldCheck, Users } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import NexusUnlockParticipantHelper from '$lib/components/login/NexusUnlockParticipantHelper.svelte'
  import VaultArchitectureSelect from '$lib/components/VaultArchitectureSelect.svelte'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  type NexusGenesisStatus =
    | 'idle'
    | 'collecting'
    | 'ready'
    | 'finalizing'
    | 'delivering'
    | 'complete'

  type StartNexusGenesisArgs = {
    label: string
    participantCount: number
    threshold: number
  }

  type NexusGenesisDelivery = {
    participantId: string
    fingerprint?: string
    payload: string
  }

  type NexusGenesisParticipantSummary = {
    participantId: string
    label: string
    fingerprint: string
  }

  let {
    vault,
    isVerifying,
    isInitializing,
    onCreateDeviceVault,
    onConnectStorage,
    onStartNexusGenesis,
    onAddNexusGenesisParticipantResponse,
    onFinalizeNexusGenesis,
    onCreateNexusGenesisParticipantResponse,
    onReceiveNexusGenesisShare,
    onCompleteNexusGenesisDelivery,
    nexusGenesisStatus = 'idle',
    nexusGenesisRequest = '',
    nexusGenesisParticipantCount = 0,
    nexusGenesisParticipants = [],
    nexusGenesisDeliveries = [],
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    onCreateDeviceVault: (label: string) => void | Promise<void>
    onConnectStorage: () => void
    onStartNexusGenesis?: (args: StartNexusGenesisArgs) => void | Promise<void>
    onAddNexusGenesisParticipantResponse?: (
      payload: string,
    ) => void | Promise<void>
    onFinalizeNexusGenesis?: () => void | Promise<void>
    onCreateNexusGenesisParticipantResponse?: (
      requestPayload: string,
    ) => string | Promise<string>
    onReceiveNexusGenesisShare?: (sharePayload: string) => void | Promise<void>
    onCompleteNexusGenesisDelivery?: () => void | Promise<void>
    nexusGenesisStatus?: NexusGenesisStatus
    nexusGenesisRequest?: string
    nexusGenesisParticipantCount?: number
    nexusGenesisParticipants?: NexusGenesisParticipantSummary[]
    nexusGenesisDeliveries?: NexusGenesisDelivery[]
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
  type WizardStep =
    | 'vault'
    | 'simple-create'
    | 'nexus-policy'
    | 'nexus-ceremony'
  let wizardStep = $state<WizardStep>('vault')
  let nexusName = $state('')
  let nexusParticipantCount = $state(3)
  let nexusThreshold = $state(2)
  let participantResponse = $state('')
  let copyingRequest = $state(false)
  let nexusActionBusy = $state(false)
  let joiningNexus = $state(false)
  let participantRequest = $state('')
  let generatedParticipantResponse = $state('')
  let generatedParticipantFingerprint = $state('')
  let participantShare = $state('')

  $effect(() => {
    if (
      nexusGenesisStatus === 'delivering' &&
      nexusGenesisDeliveries.length > 0
    ) {
      wizardStep = 'nexus-ceremony'
    }
  })

  const isNexus = $derived(vault.draftVaultType === 'nexus')
  const currentStepNumber = $derived(wizardStep === 'vault' ? 1 : 2)
  const nexusNameReady = $derived(nexusName.trim().length > 0)
  const nexusReadyToFinalize = $derived(nexusGenesisStatus === 'ready')

  function continueFromVaultType() {
    wizardStep = isNexus ? 'nexus-policy' : 'simple-create'
  }

  async function startNexusGenesis() {
    if (!nexusNameReady || isBusy || nexusActionBusy || !onStartNexusGenesis) {
      return
    }
    nexusActionBusy = true
    try {
      await onStartNexusGenesis({
        label: nexusName.trim(),
        participantCount: nexusParticipantCount,
        threshold: nexusThreshold,
      })
      wizardStep = 'nexus-ceremony'
    } finally {
      nexusActionBusy = false
    }
  }

  async function addParticipantResponse() {
    const payload = participantResponse.trim()
    if (!payload || nexusActionBusy || !onAddNexusGenesisParticipantResponse) {
      return
    }
    nexusActionBusy = true
    try {
      await onAddNexusGenesisParticipantResponse(payload)
      participantResponse = ''
    } finally {
      nexusActionBusy = false
    }
  }

  async function finalizeNexusGenesis() {
    if (!nexusReadyToFinalize || nexusActionBusy || !onFinalizeNexusGenesis) {
      return
    }
    nexusActionBusy = true
    try {
      await onFinalizeNexusGenesis()
    } finally {
      nexusActionBusy = false
    }
  }

  async function copyGenesisRequest() {
    if (!nexusGenesisRequest) return
    try {
      await navigator.clipboard.writeText(nexusGenesisRequest)
      copyingRequest = true
      setTimeout(() => {
        copyingRequest = false
      }, 1500)
    } catch {
      vault.errorMsg = vault.t('login.nexus_genesis_copy_failed')
    }
  }

  async function createParticipantResponse() {
    const requestPayload = participantRequest.trim()
    if (
      !requestPayload ||
      nexusActionBusy ||
      !onCreateNexusGenesisParticipantResponse
    ) {
      return
    }
    nexusActionBusy = true
    try {
      generatedParticipantResponse =
        await onCreateNexusGenesisParticipantResponse(requestPayload)
      const response = JSON.parse(generatedParticipantResponse) as {
        participant?: { fingerprint?: string }
      }
      generatedParticipantFingerprint = response.participant?.fingerprint ?? ''
    } finally {
      nexusActionBusy = false
    }
  }

  async function receiveParticipantShare() {
    const sharePayload = participantShare.trim()
    if (!sharePayload || nexusActionBusy || !onReceiveNexusGenesisShare) return
    nexusActionBusy = true
    try {
      await onReceiveNexusGenesisShare(sharePayload)
      participantShare = ''
    } finally {
      nexusActionBusy = false
    }
  }
</script>

<div class="space-y-5" data-testid="login-create-vault-chooser">
  <p class="text-sm text-pretty text-muted-foreground">
    {vault.t('login.create_vault_intro')}
  </p>

  <ol class="grid grid-cols-2 gap-2" data-testid="create-vault-wizard-progress">
    <li>
      <button
        type="button"
        class:border-foreground={wizardStep === 'vault'}
        class:text-foreground={wizardStep === 'vault'}
        class="w-full border-b-2 pb-2 text-left text-muted-foreground transition-colors"
        data-testid="create-vault-wizard-nav-vault"
        aria-current={wizardStep === 'vault' ? 'step' : undefined}
        disabled={isBusy || wizardStep === 'nexus-ceremony'}
        onclick={() => (wizardStep = 'vault')}
      >
        <span class="block text-xs font-medium">01</span>
        <span class="block text-sm font-semibold">
          {vault.t('login.create_wizard_vault_label')}
        </span>
      </button>
    </li>
    <li>
      <div
        class:border-foreground={currentStepNumber === 2}
        class:text-foreground={currentStepNumber === 2}
        class="w-full border-b-2 pb-2 text-left text-muted-foreground"
        data-testid="create-vault-wizard-nav-next"
        aria-current={currentStepNumber === 2 ? 'step' : undefined}
      >
        <span class="block text-xs font-medium">02</span>
        <span class="block text-sm font-semibold">
          {isNexus
            ? vault.t('login.create_wizard_nexus_label')
            : vault.t('login.create_wizard_create_label')}
        </span>
      </div>
    </li>
  </ol>

  {#if wizardStep === 'vault'}
    <section class="space-y-4" data-testid="create-vault-wizard-vault">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-foreground">
          {vault.t('login.create_wizard_vault_title')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.create_wizard_vault_description')}
        </p>
      </div>

      <VaultArchitectureSelect
        {vault}
        kind="vault"
        id="vault-type"
        disabled={isBusy}
      />

      {#if isNexus}
        <div
          class="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-foreground"
          data-testid="nexus-genesis-introduction"
        >
          <p class="font-medium">
            {vault.t('login.nexus_genesis_intro_title')}
          </p>
          <p class="mt-1 text-xs text-pretty text-muted-foreground">
            {vault.t('login.nexus_genesis_intro_description')}
          </p>
        </div>
      {/if}

      <div class="flex justify-end pt-1">
        <Button
          type="button"
          class="min-w-[140px]"
          data-testid="create-vault-wizard-continue"
          disabled={isBusy}
          onclick={continueFromVaultType}
        >
          {vault.t('login.create_wizard_continue')}
        </Button>
      </div>
    </section>
  {:else if wizardStep === 'simple-create'}
    <section class="space-y-4" data-testid="create-vault-wizard-create">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-foreground">
          {vault.t('login.create_wizard_create_title')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.create_wizard_simple_description')}
        </p>
      </div>

      <LoginVaultNameForm
        {vault}
        {isVerifying}
        {isInitializing}
        submitLabel={vault.t('login.path_local_btn')}
        onCreate={onCreateDeviceVault}
      />

      <Button
        type="button"
        variant="ghost"
        data-testid="create-vault-wizard-back"
        disabled={isBusy}
        onclick={() => (wizardStep = 'vault')}
      >
        {vault.t('common.back')}
      </Button>
    </section>
  {:else if wizardStep === 'nexus-policy'}
    <section class="space-y-4" data-testid="nexus-genesis-policy-step">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-foreground">
          {vault.t('login.nexus_genesis_policy_title')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.nexus_genesis_policy_description')}
        </p>
      </div>

      <div class="space-y-1.5">
        <label
          class="text-xs font-medium text-foreground"
          for="nexus-vault-name"
        >
          {vault.t('login.vault_name_label')}
        </label>
        <input
          id="nexus-vault-name"
          type="text"
          class="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          placeholder={vault.t('login.vault_name_placeholder')}
          maxlength="64"
          autocomplete="off"
          data-testid="nexus-genesis-name-input"
          bind:value={nexusName}
          disabled={isBusy || nexusActionBusy}
        />
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="nexus-participant-count"
          >
            {vault.t('login.nexus_genesis_participant_count')}
          </label>
          <input
            id="nexus-participant-count"
            type="number"
            min="2"
            max="16"
            step="1"
            class="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            data-testid="nexus-genesis-participant-count"
            bind:value={nexusParticipantCount}
            disabled={isBusy || nexusActionBusy}
          />
          <p class="text-xs text-pretty text-muted-foreground">
            {vault.t('login.nexus_genesis_participant_count_hint')}
          </p>
        </div>
        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="nexus-threshold"
          >
            {vault.t('login.nexus_genesis_threshold')}
          </label>
          <input
            id="nexus-threshold"
            type="number"
            min="2"
            max={nexusParticipantCount}
            step="1"
            class="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            data-testid="nexus-genesis-threshold"
            bind:value={nexusThreshold}
            disabled={isBusy || nexusActionBusy}
          />
          <p class="text-xs text-pretty text-muted-foreground">
            {vault.t('login.nexus_genesis_threshold_hint')}
          </p>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3 pt-1">
        <Button
          type="button"
          variant="ghost"
          data-testid="create-vault-wizard-back"
          disabled={isBusy || nexusActionBusy}
          onclick={() => (wizardStep = 'vault')}
        >
          {vault.t('common.back')}
        </Button>
        <Button
          type="button"
          class="min-w-[180px]"
          data-testid="nexus-genesis-start"
          disabled={isBusy ||
            nexusActionBusy ||
            !nexusNameReady ||
            !onStartNexusGenesis}
          onclick={() => void startNexusGenesis()}
        >
          {#if nexusActionBusy}
            <RefreshCw class="size-4 animate-spin" />
          {:else}
            <Users class="size-4" />
          {/if}
          {vault.t('login.nexus_genesis_start')}
        </Button>
      </div>
    </section>
  {:else}
    <section class="space-y-5" data-testid="nexus-genesis-ceremony-step">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-foreground">
          {vault.t('login.nexus_genesis_collect_title')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.nexus_genesis_collect_description')}
        </p>
      </div>

      <div
        class="rounded-lg border border-border/60 bg-muted/10 p-4 space-y-3"
        data-testid="nexus-genesis-request"
      >
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-foreground">
              {vault.t('login.nexus_genesis_request_title')}
            </p>
            <p class="text-xs text-muted-foreground">
              {vault.t('login.nexus_genesis_request_description')}
            </p>
          </div>
          <span
            class="text-xs font-medium text-muted-foreground"
            data-testid="nexus-genesis-progress"
          >
            {nexusGenesisParticipantCount} / {nexusParticipantCount}
          </span>
        </div>

        {#if nexusGenesisRequest}
          <div class="grid gap-3 sm:grid-cols-[160px_1fr]">
            <EnrollmentQrCode
              enrollmentLink={nexusGenesisRequest}
              loadingLabel={vault.t('login.nexus_genesis_qr_loading')}
            />
            <div class="space-y-2">
              <textarea
                class="min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                readonly
                data-testid="nexus-genesis-request-output"
                value={nexusGenesisRequest}></textarea>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="nexus-genesis-copy-request"
                onclick={() => void copyGenesisRequest()}
              >
                <Copy class="size-4" />
                {copyingRequest
                  ? vault.t('common.copied')
                  : vault.t('common.copy')}
              </Button>
            </div>
          </div>
        {:else}
          <p class="text-sm text-muted-foreground" role="status">
            {vault.t('login.nexus_genesis_request_preparing')}
          </p>
        {/if}

        {#if nexusGenesisParticipants.length > 0}
          <div
            class="space-y-2 border-t border-border pt-3"
            data-testid="nexus-genesis-verified-participants"
          >
            <p class="text-xs font-medium text-foreground">
              {vault.t('login.nexus_genesis_verified_participants')}
            </p>
            <ul class="space-y-1.5">
              {#each nexusGenesisParticipants as participant (participant.participantId)}
                <li
                  class="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
                >
                  <span class="text-foreground">
                    {participant.label || participant.participantId}
                  </span>
                  <code class="text-muted-foreground"
                    >{participant.fingerprint}</code
                  >
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>

      <div class="space-y-2">
        <label
          class="text-xs font-medium text-foreground"
          for="nexus-participant-response"
        >
          {vault.t('login.nexus_genesis_response_label')}
        </label>
        <textarea
          id="nexus-participant-response"
          class="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="nexus-genesis-response-input"
          placeholder={vault.t('login.nexus_genesis_response_placeholder')}
          bind:value={participantResponse}
          disabled={isBusy || nexusActionBusy || nexusReadyToFinalize}
        ></textarea>
        <Button
          type="button"
          variant="outline"
          data-testid="nexus-genesis-add-participant"
          disabled={isBusy ||
            nexusActionBusy ||
            !participantResponse.trim() ||
            !onAddNexusGenesisParticipantResponse}
          onclick={() => void addParticipantResponse()}
        >
          <Users class="size-4" />
          {vault.t('login.nexus_genesis_add_participant')}
        </Button>
      </div>

      <div
        class="rounded-md border border-border/60 p-3 text-xs text-pretty text-muted-foreground"
      >
        {vault.t('login.nexus_genesis_atomic_notice')}
      </div>

      <Button
        type="button"
        class="w-full sm:w-auto sm:min-w-[220px]"
        data-testid="nexus-genesis-finalize"
        disabled={isBusy ||
          nexusActionBusy ||
          !nexusReadyToFinalize ||
          !onFinalizeNexusGenesis}
        onclick={() => void finalizeNexusGenesis()}
      >
        {#if nexusActionBusy || nexusGenesisStatus === 'finalizing'}
          <RefreshCw class="size-4 animate-spin" />
        {:else}
          <ShieldCheck class="size-4" />
        {/if}
        {vault.t('login.nexus_genesis_finalize')}
      </Button>

      {#if nexusGenesisStatus === 'delivering' || nexusGenesisDeliveries.length > 0}
        <div
          class="space-y-3 border-t border-border pt-5"
          data-testid="nexus-genesis-deliveries"
        >
          <div class="space-y-1">
            <h4 class="text-sm font-semibold text-foreground">
              {vault.t('login.nexus_genesis_delivery_title')}
            </h4>
            <p class="text-xs text-pretty text-muted-foreground">
              {vault.t('login.nexus_genesis_delivery_description')}
            </p>
          </div>

          {#if nexusGenesisDeliveries.length === 0}
            <p class="text-sm text-muted-foreground" role="status">
              {vault.t('login.nexus_genesis_delivery_waiting')}
            </p>
          {:else}
            <div class="space-y-3">
              {#each nexusGenesisDeliveries as delivery, index (delivery.participantId)}
                <div
                  class="grid gap-3 rounded-lg border border-border/60 bg-muted/10 p-3 sm:grid-cols-[120px_1fr]"
                  data-testid="nexus-genesis-delivery"
                >
                  <EnrollmentQrCode
                    enrollmentLink={delivery.payload}
                    loadingLabel={vault.t('login.nexus_genesis_qr_loading')}
                  />
                  <div class="min-w-0 space-y-2">
                    <p class="text-sm font-medium text-foreground">
                      {vault.t('login.nexus_genesis_delivery_participant')}
                      {index + 1}
                    </p>
                    {#if delivery.fingerprint}
                      <p
                        class="break-all font-mono text-xs text-muted-foreground"
                      >
                        {delivery.fingerprint}
                      </p>
                    {/if}
                    <textarea
                      class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                      readonly
                      data-testid="nexus-genesis-delivery-output"
                      value={delivery.payload}></textarea>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="nexus-genesis-copy-delivery"
                      onclick={() =>
                        void navigator.clipboard.writeText(delivery.payload)}
                    >
                      <Copy class="size-4" />
                      {vault.t('common.copy')}
                    </Button>
                  </div>
                </div>
              {/each}
              <div class="flex justify-end pt-2">
                <Button
                  type="button"
                  data-testid="nexus-genesis-delivery-complete"
                  disabled={isBusy ||
                    nexusActionBusy ||
                    !onCompleteNexusGenesisDelivery}
                  onclick={() => void onCompleteNexusGenesisDelivery?.()}
                >
                  {vault.t('common.done')}
                </Button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  {#if wizardStep !== 'nexus-ceremony'}
    <div class="pt-2" data-testid="login-path-cloud">
      <div
        class="flex items-center gap-3 text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
      >
        <span class="text-xs text-center">
          {vault.t('login.import_existing_alternative')}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        class="mx-auto mt-2 flex text-foreground"
        data-testid="login-connect-storage-btn"
        disabled={isBusy}
        onclick={onConnectStorage}
      >
        <Cloud class="size-4" />
        {vault.t('login.path_cloud_btn')}
      </Button>

      <Button
        type="button"
        variant="ghost"
        class="mx-auto flex text-muted-foreground"
        data-testid="nexus-genesis-join-toggle"
        disabled={isBusy}
        onclick={() => (joiningNexus = !joiningNexus)}
      >
        <Users class="size-4" />
        {vault.t('login.nexus_genesis_join_alternative')}
      </Button>

      {#if joiningNexus}
        <section
          class="mt-3 space-y-4 rounded-lg border border-border/60 bg-muted/10 p-4"
          data-testid="nexus-genesis-participant-step"
        >
          <div class="space-y-1">
            <h3 class="text-sm font-semibold text-foreground">
              {vault.t('login.nexus_genesis_join_title')}
            </h3>
            <p class="text-xs text-pretty text-muted-foreground">
              {vault.t('login.nexus_genesis_join_description')}
            </p>
          </div>

          <div class="space-y-2">
            <label
              class="text-xs font-medium text-foreground"
              for="nexus-participant-request"
            >
              {vault.t('login.nexus_genesis_join_request_label')}
            </label>
            <textarea
              id="nexus-participant-request"
              class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              data-testid="nexus-genesis-join-request-input"
              placeholder={vault.t(
                'login.nexus_genesis_join_request_placeholder',
              )}
              bind:value={participantRequest}
              disabled={isBusy || nexusActionBusy}></textarea>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="nexus-genesis-create-response"
              disabled={isBusy ||
                nexusActionBusy ||
                !participantRequest.trim() ||
                !onCreateNexusGenesisParticipantResponse}
              onclick={() => void createParticipantResponse()}
            >
              <ShieldCheck class="size-4" />
              {vault.t('login.nexus_genesis_create_response')}
            </Button>
          </div>

          {#if generatedParticipantResponse}
            <div class="space-y-2">
              <label
                class="text-xs font-medium text-foreground"
                for="nexus-generated-response"
              >
                {vault.t('login.nexus_genesis_generated_response')}
              </label>
              <textarea
                id="nexus-generated-response"
                class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                readonly
                data-testid="nexus-genesis-generated-response"
                value={generatedParticipantResponse}></textarea>
              {#if generatedParticipantFingerprint}
                <p
                  class="text-xs text-muted-foreground"
                  data-testid="nexus-genesis-generated-fingerprint"
                >
                  {vault.t('login.nexus_genesis_fingerprint')}:
                  <code class="text-foreground"
                    >{generatedParticipantFingerprint}</code
                  >
                </p>
              {/if}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onclick={() =>
                  void navigator.clipboard.writeText(
                    generatedParticipantResponse,
                  )}
              >
                <Copy class="size-4" />
                {vault.t('common.copy')}
              </Button>
            </div>
          {/if}

          <div class="space-y-2 border-t border-border pt-4">
            <label
              class="text-xs font-medium text-foreground"
              for="nexus-received-share"
            >
              {vault.t('login.nexus_genesis_receive_share_label')}
            </label>
            <textarea
              id="nexus-received-share"
              class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              data-testid="nexus-genesis-receive-share-input"
              placeholder={vault.t(
                'login.nexus_genesis_receive_share_placeholder',
              )}
              bind:value={participantShare}
              disabled={isBusy || nexusActionBusy}></textarea>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="nexus-genesis-receive-share"
              disabled={isBusy ||
                nexusActionBusy ||
                !participantShare.trim() ||
                !onReceiveNexusGenesisShare}
              onclick={() => void receiveParticipantShare()}
            >
              <ShieldCheck class="size-4" />
              {vault.t('login.nexus_genesis_receive_share')}
            </Button>
          </div>
        </section>
      {/if}
    </div>
  {/if}

  <NexusUnlockParticipantHelper {vault} disabled={isBusy} expanded />
</div>
