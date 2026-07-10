<script lang="ts">
  import {
    Cloud,
    Copy,
    KeyRound,
    RefreshCw,
    ShieldCheck,
    UserPlus,
    Users,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import NexusUnlockParticipantHelper from '$lib/components/login/NexusUnlockParticipantHelper.svelte'
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

  type WizardStep =
    | 'choose'
    | 'simple-create'
    | 'nexus-policy'
    | 'nexus-ceremony'
    | 'join'

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
    onCreateNexusGenesisPublicKeyAnnouncement,
    onRememberNexusGenesisRequest,
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
    onCreateNexusGenesisPublicKeyAnnouncement?: () => string | Promise<string>
    onRememberNexusGenesisRequest?: (
      requestPayload: string,
    ) => void | Promise<void>
    onReceiveNexusGenesisShare?: (sharePayload: string) => void | Promise<void>
    onCompleteNexusGenesisDelivery?: () => void | Promise<void>
    nexusGenesisStatus?: NexusGenesisStatus
    nexusGenesisRequest?: string
    nexusGenesisParticipantCount?: number
    nexusGenesisParticipants?: NexusGenesisParticipantSummary[]
    nexusGenesisDeliveries?: NexusGenesisDelivery[]
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
  let wizardStep = $state<WizardStep>('choose')
  let nexusName = $state('')
  let nexusParticipantCount = $state(3)
  let nexusThreshold = $state(2)
  let participantResponse = $state('')
  let copyingRequest = $state(false)
  let copyingJoinResponse = $state(false)
  let nexusActionBusy = $state(false)
  let participantRequest = $state('')
  let sessionParticipantRequest = $state('')
  let generatedParticipantResponse = $state('')
  let generatedParticipantFingerprint = $state('')
  let participantShare = $state('')
  let joinPublicKeysLoading = $state(false)

  $effect(() => {
    if (
      wizardStep === 'join' &&
      !generatedParticipantResponse &&
      !joinPublicKeysLoading &&
      onCreateNexusGenesisPublicKeyAnnouncement
    ) {
      void loadJoinPublicKeys()
    }
  })

  async function loadJoinPublicKeys() {
    if (
      joinPublicKeysLoading ||
      generatedParticipantResponse ||
      !onCreateNexusGenesisPublicKeyAnnouncement
    ) {
      return
    }
    joinPublicKeysLoading = true
    try {
      generatedParticipantResponse =
        await onCreateNexusGenesisPublicKeyAnnouncement()
      const announcement = JSON.parse(generatedParticipantResponse) as {
        fingerprint?: string
      }
      generatedParticipantFingerprint = announcement.fingerprint ?? ''
    } catch (error) {
      generatedParticipantResponse = ''
      generatedParticipantFingerprint = ''
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t('login.nexus_genesis_response_failed')
    } finally {
      joinPublicKeysLoading = false
    }
  }

  $effect(() => {
    if (
      nexusGenesisStatus === 'delivering' &&
      nexusGenesisDeliveries.length > 0
    ) {
      wizardStep = 'nexus-ceremony'
    }
  })

  const nexusNameReady = $derived(nexusName.trim().length > 0)
  const nexusPolicyValid = $derived(
    Number.isInteger(nexusParticipantCount) &&
      Number.isInteger(nexusThreshold) &&
      nexusParticipantCount >= 2 &&
      nexusParticipantCount <= 16 &&
      nexusThreshold >= 2 &&
      nexusThreshold <= nexusParticipantCount,
  )
  const nexusReadyToFinalize = $derived(nexusGenesisStatus === 'ready')
  const showPathChooser = $derived(wizardStep === 'choose')
  const showImportFooter = $derived(
    wizardStep === 'choose' ||
      wizardStep === 'simple-create' ||
      wizardStep === 'nexus-policy',
  )

  function chooseSimplePath() {
    vault.draftVaultType = 'simple'
    wizardStep = 'simple-create'
  }

  function chooseNexusCreatePath() {
    vault.draftVaultType = 'nexus'
    wizardStep = 'nexus-policy'
  }

  function chooseJoinPath() {
    wizardStep = 'join'
  }

  function backToChooser() {
    if (wizardStep === 'nexus-ceremony') return
    wizardStep = 'choose'
  }

  async function startNexusGenesis() {
    if (
      !nexusNameReady ||
      !nexusPolicyValid ||
      isBusy ||
      nexusActionBusy ||
      !onStartNexusGenesis
    ) {
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

  async function copyJoinResponse() {
    if (!generatedParticipantResponse) return
    try {
      await navigator.clipboard.writeText(generatedParticipantResponse)
      copyingJoinResponse = true
      setTimeout(() => {
        copyingJoinResponse = false
      }, 1500)
    } catch {
      vault.errorMsg = vault.t('login.nexus_genesis_copy_failed')
    }
  }

  async function createParticipantResponse() {
    const requestPayload = sessionParticipantRequest.trim()
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
    } catch (error) {
      generatedParticipantResponse = ''
      generatedParticipantFingerprint = ''
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t('login.nexus_genesis_response_failed')
    } finally {
      nexusActionBusy = false
    }
  }

  function refreshJoinPublicKeys() {
    generatedParticipantResponse = ''
    generatedParticipantFingerprint = ''
    void loadJoinPublicKeys()
  }

  async function receiveParticipantShare() {
    const sharePayload = participantShare.trim()
    if (!sharePayload || nexusActionBusy || !onReceiveNexusGenesisShare) return
    nexusActionBusy = true
    try {
      const requestPayload = participantRequest.trim()
      if (requestPayload && onRememberNexusGenesisRequest) {
        await onRememberNexusGenesisRequest(requestPayload)
      }
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

  {#if showPathChooser}
    <section class="space-y-4" data-testid="get-started-path-chooser">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-foreground">
          {vault.t('login.get_started_paths_title')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.get_started_paths_description')}
        </p>
      </div>

      <div class="grid gap-3" data-testid="get-started-path-list">
        <button
          type="button"
          class="rounded-lg border border-border/60 bg-muted/10 p-4 text-left transition-colors hover:border-foreground/40 hover:bg-muted/20 disabled:opacity-60"
          data-testid="get-started-path-simple"
          disabled={isBusy}
          onclick={chooseSimplePath}
        >
          <div class="flex items-start gap-3">
            <KeyRound class="mt-0.5 size-5 shrink-0 text-foreground" />
            <div class="min-w-0 space-y-1">
              <p class="text-sm font-semibold text-foreground">
                {vault.t('login.get_started_path_simple_title')}
              </p>
              <p class="text-sm text-pretty text-muted-foreground">
                {vault.t('login.get_started_path_simple_description')}
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          class="rounded-lg border border-border/60 bg-muted/10 p-4 text-left transition-colors hover:border-foreground/40 hover:bg-muted/20 disabled:opacity-60"
          data-testid="get-started-path-nexus"
          disabled={isBusy}
          onclick={chooseNexusCreatePath}
        >
          <div class="flex items-start gap-3">
            <Users class="mt-0.5 size-5 shrink-0 text-foreground" />
            <div class="min-w-0 space-y-1">
              <p class="text-sm font-semibold text-foreground">
                {vault.t('login.get_started_path_nexus_title')}
              </p>
              <p class="text-sm text-pretty text-muted-foreground">
                {vault.t('login.get_started_path_nexus_description')}
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          class="rounded-lg border border-border/60 bg-muted/10 p-4 text-left transition-colors hover:border-foreground/40 hover:bg-muted/20 disabled:opacity-60"
          data-testid="get-started-path-join"
          disabled={isBusy}
          onclick={chooseJoinPath}
        >
          <div class="flex items-start gap-3">
            <UserPlus class="mt-0.5 size-5 shrink-0 text-foreground" />
            <div class="min-w-0 space-y-1">
              <p class="text-sm font-semibold text-foreground">
                {vault.t('login.get_started_path_join_title')}
              </p>
              <p class="text-sm text-pretty text-muted-foreground">
                {vault.t('login.get_started_path_join_description')}
              </p>
            </div>
          </div>
        </button>
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
        onclick={backToChooser}
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
          onclick={backToChooser}
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
            !nexusPolicyValid ||
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
  {:else if wizardStep === 'nexus-ceremony'}
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
  {:else}
    <section class="space-y-4" data-testid="nexus-genesis-participant-step">
      <div class="space-y-1">
        <h3 class="text-lg font-semibold text-foreground">
          {vault.t('login.nexus_genesis_join_title')}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t('login.nexus_genesis_join_description')}
        </p>
      </div>

      {#if generatedParticipantResponse}
        <div
          class="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4"
          data-testid="nexus-genesis-join-response"
        >
          <div class="space-y-1">
            <p class="text-sm font-semibold text-foreground">
              {vault.t('login.nexus_genesis_generated_response')}
            </p>
            <p class="text-xs text-pretty text-muted-foreground">
              {vault.t('login.nexus_genesis_join_qr_hint')}
            </p>
          </div>
          <div class="grid gap-3 sm:grid-cols-[160px_1fr]">
            <EnrollmentQrCode
              enrollmentLink={generatedParticipantResponse}
              loadingLabel={vault.t('login.nexus_genesis_qr_loading')}
            />
            <div class="space-y-2">
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
                data-testid="nexus-genesis-copy-join-response"
                onclick={() => void copyJoinResponse()}
              >
                <Copy class="size-4" />
                {copyingJoinResponse
                  ? vault.t('common.copied')
                  : vault.t('common.copy')}
              </Button>
            </div>
          </div>
        </div>
      {:else if joinPublicKeysLoading}
        <p
          class="text-sm text-muted-foreground"
          data-testid="nexus-genesis-join-loading"
        >
          {vault.t('login.nexus_genesis_join_loading')}
        </p>
      {:else}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="nexus-genesis-refresh-public-keys"
          disabled={isBusy || nexusActionBusy}
          onclick={() => refreshJoinPublicKeys()}
        >
          <RefreshCw class="size-4" />
          {vault.t('login.nexus_genesis_refresh_public_keys')}
        </Button>
      {/if}

      <details class="rounded-lg border border-border/60 bg-muted/10 p-4">
        <summary
          class="cursor-pointer text-sm font-medium text-foreground"
          data-testid="nexus-genesis-join-request-toggle"
        >
          {vault.t('login.nexus_genesis_join_request_optional')}
        </summary>
        <div class="mt-3 space-y-2">
          <p class="text-xs text-pretty text-muted-foreground">
            {vault.t('login.nexus_genesis_join_request_optional_description')}
          </p>
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
            bind:value={sessionParticipantRequest}
            disabled={isBusy || nexusActionBusy}></textarea>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="nexus-genesis-create-response"
            disabled={isBusy ||
              nexusActionBusy ||
              !sessionParticipantRequest.trim() ||
              !onCreateNexusGenesisParticipantResponse}
            onclick={() => void createParticipantResponse()}
          >
            {#if nexusActionBusy}
              <RefreshCw class="size-4 animate-spin" />
            {:else}
              <ShieldCheck class="size-4" />
            {/if}
            {vault.t('login.nexus_genesis_create_session_response')}
          </Button>
        </div>
      </details>

      <div class="space-y-2 border-t border-border pt-4">
        <p class="text-xs font-medium text-foreground">
          {vault.t('login.nexus_genesis_join_share_title')}
        </p>
        <p class="text-xs text-pretty text-muted-foreground">
          {vault.t('login.nexus_genesis_join_share_description')}
        </p>
        <label
          class="text-xs font-medium text-foreground"
          for="nexus-share-request"
        >
          {vault.t('login.nexus_genesis_join_share_request_label')}
        </label>
        <textarea
          id="nexus-share-request"
          class="min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
          data-testid="nexus-genesis-share-request-input"
          placeholder={vault.t(
            'login.nexus_genesis_join_share_request_placeholder',
          )}
          bind:value={participantRequest}
          disabled={isBusy || nexusActionBusy}></textarea>
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
          placeholder={vault.t('login.nexus_genesis_receive_share_placeholder')}
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

      <Button
        type="button"
        variant="ghost"
        data-testid="create-vault-wizard-back"
        disabled={isBusy || nexusActionBusy}
        onclick={backToChooser}
      >
        {vault.t('common.back')}
      </Button>
    </section>
  {/if}

  {#if showImportFooter}
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
    </div>
  {/if}

  <NexusUnlockParticipantHelper {vault} disabled={isBusy} expanded />
</div>
