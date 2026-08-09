<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { ReplicationType } from '$app-wasm'

  import { Cloud, FolderOpen, HardDrive } from '@lucide/svelte'
  import {
    configuredOAuthFile,
    DEFAULT_DRIVE_BACKUP_NAME,
    defaultOAuthFileConfig,
    GITHUB_PROVIDER_TYPE,
    GOOGLE_DRIVE_OAUTH_FILE_PRESET,
    ICLOUD_OAUTH_FILE_PRESET,
    LOCAL_FOLDER_PROVIDER_TYPE,
    LOCAL_PROVIDER_TYPE,
    OAUTH_FILE_PROVIDER_TYPE,
    providerPersistenceDefaults,
    storedGithubPat,
    storedGithubRepository,
    type ProviderSetupRequest,
    type StorageProvider,
  } from '$lib/auth/providers'
  import { providerReplicationCapability } from '$lib/vault/architecture-model'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onSelect,
    excludeLocal = false,
    excludeLocalFolder = false,
  }: {
    vault: VaultState
    onSelect: (request: ProviderSetupRequest) => void
    excludeLocal?: boolean
    excludeLocalFolder?: boolean
  } = $props()

  const localFolderUnavailable = $derived(!vault.localFolderBackupSupported)
  const localProviderRequest: Parameters<typeof blocked>[0] = {
    type: LOCAL_PROVIDER_TYPE,
  }
  const localFolderProviderRequest: Parameters<typeof blocked>[0] = {
    type: LOCAL_FOLDER_PROVIDER_TYPE,
  }
  const googleDriveProviderRequest: Parameters<typeof blocked>[0] = {
    type: OAUTH_FILE_PROVIDER_TYPE,
    oauthPreset: GOOGLE_DRIVE_OAUTH_FILE_PRESET,
  }
  const iCloudProviderRequest: Parameters<typeof blocked>[0] = {
    type: OAUTH_FILE_PROVIDER_TYPE,
    oauthPreset: ICLOUD_OAUTH_FILE_PRESET,
  }
  const githubProviderRequest: Parameters<typeof blocked>[0] = {
    type: GITHUB_PROVIDER_TYPE,
  }

  function draftProvider(request: ProviderSetupRequest): StorageProvider {
    const { type } = request
    const oauthPreset = type === OAUTH_FILE_PROVIDER_TYPE ? request.oauthPreset : 'default'
    const base: StorageProvider = {
      ...providerPersistenceDefaults(),
      id: `draft-${type}-${oauthPreset ?? 'default'}`,
      type,
      label: type,
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: new Date(0).toISOString(),
    }
    if (type === GITHUB_PROVIDER_TYPE) {
      return {
        ...base,
        githubPat: storedGithubPat('github_pat_draft'),
        githubRepo: storedGithubRepository('nook'),
      }
    }
    if (type === OAUTH_FILE_PROVIDER_TYPE) {
      const defaultConfigRequest: Parameters<typeof defaultOAuthFileConfig>[0] = {
        preset: request.oauthPreset,
        fileName: DEFAULT_DRIVE_BACKUP_NAME,
      }
      return {
        ...base,
        oauthFile: configuredOAuthFile(
          defaultOAuthFileConfig(defaultConfigRequest),
        ),
      }
    }
    return base
  }

  function blocked(request: ProviderSetupRequest): boolean {
    const draftProviderArgs: Parameters<typeof draftProvider>[0] = request;
    const result = providerReplicationCapability(
      draftProvider(draftProviderArgs),
    )
    try {
      return vault.draftReplicationType === ReplicationType.Shared
        ? !result.supportsShared
        : !result.supportsPersonal
    } finally {
      result.free()
    }
  }

  function description({
    key,
    request,
  }: {
    readonly key: string
    readonly request: ProviderSetupRequest
  }): string {
    if (blocked(request)) {
      return vault.t(I18N_KEYS.ProviderPickerUnsupportedReplicationDesc)
    }
    return vault.t(key)
  }
</script>

<fieldset class="min-w-0 w-full max-w-full space-y-2">
  <legend class="sr-only">{vault.t(I18N_KEYS.ProviderPickerChooseProvider)}</legend>
  <ul
    class="min-w-0 w-full max-w-full space-y-1.5 overflow-hidden"
    data-testid="provider-picker-list"
  >
    {#if !excludeLocal}
      <li>
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
          data-testid="provider-option-local"
          disabled={blocked(localProviderRequest)}
          onclick={() => onSelect(localProviderRequest)}
        >
          <HardDrive class="size-4 shrink-0 text-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold text-foreground"
              >{vault.t(I18N_KEYS.ProviderPickerThisDevice)}</span
            >
            <span class="block truncate text-xs text-muted-foreground">
              {(() => { const descriptionRequest: Parameters<typeof description>[0] = {
                key: I18N_KEYS.ProviderPickerThisDeviceDesc,
                request: localProviderRequest,
              }; return description(descriptionRequest); })()}
            </span>
          </span>
        </button>
      </li>
    {/if}
    {#if !excludeLocalFolder}
      <li class="min-w-0 max-w-full">
        <button
          type="button"
          class="flex min-w-0 w-full max-w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/10 disabled:opacity-60 disabled:hover:bg-muted/10"
          data-testid="provider-option-local-folder"
          disabled={localFolderUnavailable || blocked(localFolderProviderRequest)}
          onclick={() => {
            if (!localFolderUnavailable && !blocked(localFolderProviderRequest))
              onSelect(localFolderProviderRequest)
          }}
        >
          <FolderOpen class="size-4 shrink-0 text-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold text-foreground"
              >{vault.t(I18N_KEYS.ProviderPickerLocalFolder)}</span
            >
            <span class="block truncate text-xs text-muted-foreground">
              {localFolderUnavailable
                ? vault.t(I18N_KEYS.ProviderPickerLocalFolderUnavailableDesc)
                : (() => { const descriptionRequest: Parameters<typeof description>[0] = {
                    key: I18N_KEYS.ProviderPickerLocalFolderDesc,
                    request: localFolderProviderRequest,
                  }; return description(descriptionRequest); })()}
            </span>
          </span>
        </button>
      </li>
    {/if}
    <li class="min-w-0 max-w-full">
      <button
        type="button"
        class="flex min-w-0 w-full max-w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
        data-testid="provider-option-oauth-file"
        disabled={blocked(googleDriveProviderRequest)}
        onclick={() => {
          if (!blocked(googleDriveProviderRequest))
            onSelect(googleDriveProviderRequest)
        }}
      >
        <svg
          class="size-4 shrink-0 text-foreground"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.ProviderPickerGoogleDrive)}</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            {(() => { const descriptionRequest: Parameters<typeof description>[0] = {
              key: I18N_KEYS.ProviderPickerGoogleDriveDesc,
              request: googleDriveProviderRequest,
            }; return description(descriptionRequest); })()}
          </span>
        </span>
      </button>
    </li>
    <li class="min-w-0 max-w-full">
      <button
        type="button"
        class="flex min-w-0 w-full max-w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
        data-testid="provider-option-icloud"
        disabled={blocked(iCloudProviderRequest)}
        onclick={() => {
          if (!blocked(iCloudProviderRequest)) onSelect(iCloudProviderRequest)
        }}
      >
        <svg
          class="size-4 shrink-0 text-foreground"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M13.762 4.29a6.51 6.51 0 0 0-11.025 4.126 5.243 5.243 0 0 0-2.326 8.65A4.92 4.92 0 0 0 12 22.5a4.8 4.8 0 0 0 4.7-3.84 6.48 6.48 0 0 0 2.084-12.84 6.5 6.5 0 0 0-4.022-1.59Z"
          />
        </svg>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.ProviderPickerIcloud)}</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            {(() => { const descriptionRequest: Parameters<typeof description>[0] = {
              key: I18N_KEYS.ProviderPickerIcloudDesc,
              request: iCloudProviderRequest,
            }; return description(descriptionRequest); })()}
          </span>
        </span>
      </button>
    </li>
    <li class="min-w-0 max-w-full">
      <button
        type="button"
        class="flex min-w-0 w-full max-w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
        data-testid="provider-option-github"
        disabled={blocked(githubProviderRequest)}
        onclick={() => {
          if (!blocked(githubProviderRequest)) onSelect(githubProviderRequest)
        }}
      >
        <Cloud class="size-4 shrink-0 text-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.ProviderPickerGithub)}</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            {(() => { const descriptionRequest: Parameters<typeof description>[0] = {
              key: I18N_KEYS.ProviderPickerGithubDesc,
              request: githubProviderRequest,
            }; return description(descriptionRequest); })()}
          </span>
        </span>
      </button>
    </li>
  </ul>
</fieldset>
