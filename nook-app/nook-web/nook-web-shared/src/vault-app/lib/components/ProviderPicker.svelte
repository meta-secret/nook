<script lang="ts">
  type ProviderDescriptionRequest = {
    readonly key: string
    readonly kind: ProviderKind
  }

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { ReplicationSupport } from '$app-wasm'

  import { Archive, Cloud, FolderOpen } from '@lucide/svelte'
  import GoogleDriveMark from '$lib/components/provider-marks/GoogleDriveMark.svelte'
  import ICloudMark from '$lib/components/provider-marks/ICloudMark.svelte'
  import type { ProviderKind } from '$lib/auth/providers'
  import { provider_kind_replication_capability } from '$lib/vault/architecture-model'
  import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'
  import { PickerRow } from '$lib/components/provider-picker-state'
  import { cloudKitRuntime } from '$lib/auth/icloud/cloudkit-runtime'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onSelect,
    localFolder,
  }: {
    vault: VaultState
    onSelect: (kind: ProviderKind) => void
    /** Whether the Local folder row is offered. */
    localFolder: PickerRow
  } = $props()

  const localFolderUnavailable = $derived(!vault.localFolderBackupSupported)
  /** Brave ships folder access switched off; say where to turn it on. */
  const localFolderUnavailableText = $derived(
    vault.t(
      cloudKitRuntime.isBraveBrowser()
        ? I18N_KEYS.ProviderPickerLocalFolderUnavailableBrave
        : I18N_KEYS.ProviderPickerLocalFolderUnavailableDesc,
    ),
  )
  /** Rust's capability for the kind decides whether this vault's
   * replication can use it; the DOM takes the answer as `disabled`. */
  function blocked(kind: ProviderKind): boolean {
    const capability = provider_kind_replication_capability(kind)
    try {
      switch (capability.supports(vault.draftReplicationType)) {
        case ReplicationSupport.Supported:
          return false
        case ReplicationSupport.Unsupported:
          return true
      }
    } finally {
      capability.free()
    }
  }

  function description({ key, kind }: ProviderDescriptionRequest): string {
    if (blocked(kind)) {
      return vault.t(I18N_KEYS.ProviderPickerUnsupportedReplicationDesc)
    }
    return vault.t(key)
  }
</script>

<fieldset class="min-w-0 w-full max-w-full space-y-2">
  <legend class="sr-only"
    >{vault.t(I18N_KEYS.ProviderPickerChooseProvider)}</legend
  >
  <ul
    class="min-w-0 w-full max-w-full space-y-1.5 overflow-hidden"
    data-testid="provider-picker-list"
  >
    {#if localFolder === PickerRow.Offered}
      <li class="min-w-0 max-w-full">
        <button
          type="button"
          class="flex min-w-0 w-full max-w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/10 disabled:opacity-60 disabled:hover:bg-muted/10"
          data-testid="provider-option-local-folder"
          disabled={localFolderUnavailable ||
            blocked(ProviderSetupKinds.LOCAL_FOLDER)}
          onclick={() => {
            if (!localFolderUnavailable && !blocked(ProviderSetupKinds.LOCAL_FOLDER))
              onSelect(ProviderSetupKinds.LOCAL_FOLDER)
          }}
        >
          <FolderOpen class="size-4 shrink-0 text-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold text-foreground"
              >{vault.t(I18N_KEYS.ProviderPickerLocalFolder)}</span
            >
            <span
              class="block truncate text-xs text-muted-foreground"
              data-testid="provider-option-local-folder-desc"
              {...localFolderUnavailable
                ? { title: localFolderUnavailableText }
                : {}}
            >
              {localFolderUnavailable
                ? localFolderUnavailableText
                : (() => {
                    const descriptionRequest: Parameters<
                      typeof description
                    >[0] = {
                      key: I18N_KEYS.ProviderPickerLocalFolderDesc,
                      kind: ProviderSetupKinds.LOCAL_FOLDER,
                    }
                    return description(descriptionRequest)
                  })()}
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
        disabled={blocked(ProviderSetupKinds.GOOGLE_DRIVE)}
        onclick={() => {
          if (!blocked(ProviderSetupKinds.GOOGLE_DRIVE))
            onSelect(ProviderSetupKinds.GOOGLE_DRIVE)
        }}
      >
        <GoogleDriveMark class="size-4 shrink-0 text-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.ProviderPickerGoogleDrive)}</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            {(() => {
              const descriptionRequest: Parameters<typeof description>[0] = {
                key: I18N_KEYS.ProviderPickerGoogleDriveDesc,
                kind: ProviderSetupKinds.GOOGLE_DRIVE,
              }
              return description(descriptionRequest)
            })()}
          </span>
        </span>
      </button>
    </li>
    <li class="min-w-0 max-w-full">
      <button
        type="button"
        class="flex min-w-0 w-full max-w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
        data-testid="provider-option-icloud"
        disabled={blocked(ProviderSetupKinds.ICLOUD)}
        onclick={() => {
          if (!blocked(ProviderSetupKinds.ICLOUD)) onSelect(ProviderSetupKinds.ICLOUD)
        }}
      >
        <ICloudMark class="size-4 shrink-0 text-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.ProviderPickerIcloud)}</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            {(() => {
              const descriptionRequest: Parameters<typeof description>[0] = {
                key: I18N_KEYS.ProviderPickerIcloudDesc,
                kind: ProviderSetupKinds.ICLOUD,
              }
              return description(descriptionRequest)
            })()}
          </span>
        </span>
      </button>
    </li>
    <li class="min-w-0 max-w-full">
      <button
        type="button"
        class="flex min-w-0 w-full max-w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
        data-testid="provider-option-github"
        disabled={blocked(ProviderSetupKinds.GITHUB)}
        onclick={() => {
          if (!blocked(ProviderSetupKinds.GITHUB)) onSelect(ProviderSetupKinds.GITHUB)
        }}
      >
        <Cloud class="size-4 shrink-0 text-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.ProviderPickerGithub)}</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            {(() => {
              const descriptionRequest: Parameters<typeof description>[0] = {
                key: I18N_KEYS.ProviderPickerGithubDesc,
                kind: ProviderSetupKinds.GITHUB,
              }
              return description(descriptionRequest)
            })()}
          </span>
        </span>
      </button>
    </li>
    <li class="min-w-0 max-w-full">
      <button
        type="button"
        class="flex min-w-0 w-full max-w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent"
        data-testid="provider-option-s3"
        disabled={blocked(ProviderSetupKinds.S3)}
        onclick={() => {
          if (!blocked(ProviderSetupKinds.S3)) onSelect(ProviderSetupKinds.S3)
        }}
      >
        <Archive class="size-4 shrink-0 text-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t(I18N_KEYS.ProviderPickerS3)}</span
          >
          <span class="block truncate text-xs text-muted-foreground">
            {(() => {
              const descriptionRequest: Parameters<typeof description>[0] = {
                key: I18N_KEYS.ProviderPickerS3Desc,
                kind: ProviderSetupKinds.S3,
              }
              return description(descriptionRequest)
            })()}
          </span>
        </span>
      </button>
    </li>
  </ul>
</fieldset>
