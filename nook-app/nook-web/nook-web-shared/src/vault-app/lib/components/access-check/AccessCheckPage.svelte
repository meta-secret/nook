<!--
Check access: which passkeys and backup passwords open which vaults, before
recovering or importing anything. Choose where to look (this browser, a
Google Drive account, or a local folder), then check one passkey or one
backup password at a time; each result adds to the list. Every check
decrypts in memory only and nothing is saved, imported, or written. The page
keeps one live action button: preparing a source comes first, then Check.
-->
<script lang="ts">
  import { RefreshCw, ShieldCheck } from '@lucide/svelte'
  import {
    choose_local_folder_backup_directory,
    type CredentialCheckReport,
  } from '$app-wasm'
  import BackButton from '$lib/components/workspace/BackButton.svelte'
  import AccessCheckResults from '$lib/components/access-check/AccessCheckResults.svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import {
    GoogleDriveOAuthScope,
    GoogleOAuthPrompt,
    googleOAuthSession,
    type GoogleAccessTokenRequest,
  } from '$lib/auth/google/oauth'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    AccessCheckActions,
    type BackupPasswordCheckRequest,
  } from '$lib/vault/access-check'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    ACCESS_CHECK_SOURCES,
    AccessCheckMethod,
    AccessCheckSourceKind,
    PreparedSourceKind,
    type PreparedSource,
  } from '$lib/components/access-check/access-check-page'

  let { vault, onClose }: { vault: VaultState; onClose: () => void } =
    $props()

  let sourceKind = $state<AccessCheckSourceKind>(AccessCheckSourceKind.ThisBrowser)
  let driveToken = $state('')
  let folderName = $state('')
  let folderHandle = $state('')
  let method = $state<AccessCheckMethod>(AccessCheckMethod.Passkey)
  let password = $state('')
  let busy = $state(false)
  let reports = $state<CredentialCheckReport[]>([])

  const prepared = $derived.by((): PreparedSource => {
    switch (sourceKind) {
      case AccessCheckSourceKind.ThisBrowser:
        return { kind: PreparedSourceKind.Ready, source: { kind: 'thisBrowser' } }
      case AccessCheckSourceKind.GoogleDrive:
        return driveToken
          ? {
              kind: PreparedSourceKind.Ready,
              source: { kind: 'googleDrive', accessToken: driveToken },
            }
          : { kind: PreparedSourceKind.Pending }
      case AccessCheckSourceKind.LocalFolder:
        return folderHandle
          ? {
              kind: PreparedSourceKind.Ready,
              source: { kind: 'localFolder', handleId: folderHandle },
            }
          : { kind: PreparedSourceKind.Pending }
    }
  })
  const canCheck = $derived(
    prepared.kind === PreparedSourceKind.Ready &&
      !busy &&
      (method === AccessCheckMethod.Passkey || password.length > 0),
  )

  function chooseSource(kind: AccessCheckSourceKind): void {
    sourceKind = kind
    reports = []
  }

  async function signInToDrive(): Promise<void> {
    busy = true
    try {
      const request: GoogleAccessTokenRequest = {
        prompt: GoogleOAuthPrompt.Default,
        scope: GoogleDriveOAuthScope.VaultFolder,
        accountHint: '',
        includeGrantedScopes: true,
      }
      const tokens = await googleOAuthSession.requestGoogleAccessToken(request)
      if (tokens.isErr()) {
        vault.errorMsg = vault.t(tokens.error.translationKey)
        return
      }
      driveToken = tokens.value.accessToken
    } finally {
      busy = false
    }
  }

  async function chooseFolder(): Promise<void> {
    busy = true
    try {
      const folder = await choose_local_folder_backup_directory()
      folderName = folder.directoryName
      folderHandle = folder.handleId
    } catch {
      vault.errorMsg = vault.t(I18N_KEYS.AccessCheckFailed)
    } finally {
      busy = false
    }
  }

  async function check(): Promise<void> {
    if (prepared.kind !== PreparedSourceKind.Ready) return
    busy = true
    vault.errorMsg = ''
    try {
      const actions = new AccessCheckActions()
      let checked: Awaited<ReturnType<AccessCheckActions['checkPasskey']>>
      if (method === AccessCheckMethod.Passkey) {
        checked = await actions.checkPasskey(prepared.source)
      } else {
        const request: BackupPasswordCheckRequest = {
          source: prepared.source,
          password,
        }
        checked = await actions.checkBackupPassword(request)
        password = ''
      }
      if (checked.isErr()) {
        vault.errorMsg = vault.t(checked.error.translationKey)
        return
      }
      reports = [...reports, checked.value]
    } finally {
      busy = false
    }
  }

  function sourceLabel(kind: AccessCheckSourceKind): string {
    switch (kind) {
      case AccessCheckSourceKind.ThisBrowser:
        return vault.t(I18N_KEYS.AccessCheckSourceBrowser)
      case AccessCheckSourceKind.GoogleDrive:
        return vault.t(I18N_KEYS.AccessCheckSourceDrive)
      case AccessCheckSourceKind.LocalFolder:
        return vault.t(I18N_KEYS.AccessCheckSourceFolder)
    }
  }
</script>

<div class="w-full animate-in fade-in duration-300" data-testid="access-check-page">
  <Card
    class="gap-0 overflow-hidden border-border bg-card/80 py-0 shadow-lg shadow-black/20 backdrop-blur-sm"
  >
    <CardHeader class="gap-0 space-y-0 border-b border-border/60 px-4 pb-3 pt-3 sm:px-5">
      <div class="flex items-center gap-3">
        <BackButton
          label={vault.t(I18N_KEYS.CommonBack)}
          testId="access-check-back-btn"
          onBack={onClose}
        />
        <div class="min-w-0 flex-1 space-y-0.5">
          <CardTitle class="text-base font-semibold tracking-tight text-foreground">
            {vault.t(I18N_KEYS.AccessCheckTitle)}
          </CardTitle>
          <CardDescription class="text-pretty text-xs leading-snug">
            {vault.t(I18N_KEYS.AccessCheckIntro)}
          </CardDescription>
        </div>
      </div>
    </CardHeader>
    <CardContent class="space-y-5 px-4 py-4 sm:px-5">
      <fieldset class="space-y-2" data-testid="access-check-sources">
        <legend class="nk-subpanel-head">
          {vault.t(I18N_KEYS.AccessCheckSourceLabel)}
        </legend>
        {#each ACCESS_CHECK_SOURCES as kind (kind)}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label class="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                class="size-4"
                type="radio"
                name="access-check-source"
                data-testid="access-check-source-{kind}"
                checked={sourceKind === kind}
                disabled={busy}
                onchange={() => chooseSource(kind)}
              />
              {sourceLabel(kind)}
            </label>
            {#if kind === AccessCheckSourceKind.GoogleDrive && sourceKind === kind}
              {#if driveToken}
                <span class="text-xs text-muted-foreground" data-testid="access-check-drive-ready">
                  {vault.t(I18N_KEYS.AccessCheckDriveSignedIn)}
                </span>
              {:else}
                <Button
                  type="button"
                  size="sm"
                  data-testid="access-check-drive-sign-in"
                  disabled={busy}
                  onclick={() => void signInToDrive()}
                >
                  {vault.t(I18N_KEYS.AccessCheckDriveSignIn)}
                </Button>
              {/if}
            {:else if kind === AccessCheckSourceKind.LocalFolder && sourceKind === kind}
              {#if folderHandle}
                {@const chosen: Parameters<typeof vault.t>[0] = {
                  key: I18N_KEYS.AccessCheckFolderChosen,
                  replacements: { name: folderName },
                }}
                <span class="text-xs text-muted-foreground" data-testid="access-check-folder-ready">
                  {vault.t(chosen)}
                </span>
              {:else}
                <Button
                  type="button"
                  size="sm"
                  data-testid="access-check-folder-choose"
                  disabled={busy}
                  onclick={() => void chooseFolder()}
                >
                  {vault.t(I18N_KEYS.AccessCheckFolderChoose)}
                </Button>
              {/if}
            {/if}
          </div>
        {/each}
      </fieldset>

      <fieldset class="space-y-2" data-testid="access-check-methods">
        <legend class="nk-subpanel-head">
          {vault.t(I18N_KEYS.AccessCheckMethodLabel)}
        </legend>
        <label class="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            class="size-4"
            type="radio"
            name="access-check-method"
            data-testid="access-check-method-passkey"
            checked={method === AccessCheckMethod.Passkey}
            disabled={busy}
            onchange={() => (method = AccessCheckMethod.Passkey)}
          />
          {vault.t(I18N_KEYS.AccessCheckMethodPasskey)}
        </label>
        <label class="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            class="size-4"
            type="radio"
            name="access-check-method"
            data-testid="access-check-method-password"
            checked={method === AccessCheckMethod.BackupPassword}
            disabled={busy}
            onchange={() => (method = AccessCheckMethod.BackupPassword)}
          />
          {vault.t(I18N_KEYS.AccessCheckMethodPassword)}
        </label>
        {#if method === AccessCheckMethod.BackupPassword}
          <label class="grid max-w-sm gap-1 text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.AccessCheckPasswordLabel)}
            <input
              type="password"
              autocomplete="off"
              class="h-9 border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-foreground/50"
              data-testid="access-check-password"
              bind:value={password}
              disabled={busy}
            />
          </label>
        {/if}
      </fieldset>

      {#if vault.errorMsg}
        <p class="text-xs text-destructive" role="alert" data-testid="access-check-error">
          {vault.errorMsg}
        </p>
      {/if}

      <div class="flex flex-wrap items-center justify-end gap-3">
        {#if reports.length > 0}
          <button
            type="button"
            class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            data-testid="access-check-clear"
            disabled={busy}
            onclick={() => (reports = [])}
          >
            {vault.t(I18N_KEYS.AccessCheckClear)}
          </button>
        {/if}
        <Button
          type="button"
          class="sm:min-w-[160px]"
          data-testid="access-check-run"
          disabled={!canCheck}
          onclick={() => void check()}
        >
          {#if busy}
            <RefreshCw class="size-4 animate-spin" />
            {vault.t(I18N_KEYS.AccessCheckChecking)}
          {:else}
            <ShieldCheck class="size-4" />
            {vault.t(I18N_KEYS.AccessCheckCheck)}
          {/if}
        </Button>
      </div>

      {#if reports.length > 0}
        <AccessCheckResults {vault} {reports} />
      {/if}
    </CardContent>
  </Card>
</div>
