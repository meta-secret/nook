import { fireEvent, render } from '@testing-library/svelte'
import { err, ok } from 'neverthrow'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { LOCAL_PROVIDER_TYPE } from '$lib/auth/providers'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { FirstRunActions } from '$lib/vault/first-run'
import { IdentityActionOutcome } from '$lib/vault/identity-control.svelte'
import { GoogleVaultFolderOrigin, VaultOAuthActions } from '$lib/vault/oauth'
import { ProviderSaveOutcome } from '$lib/vault/providers.svelte'
import { FirstRunStage } from '$lib/vault/state/ui.svelte'
import FirstRunConnectStep from '../../../../nook-web-shared/src/vault-app/lib/components/login/FirstRunConnectStep.svelte'
import { S3ConnectionFixture } from '../s3-connection-fixture'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

describe('the first-run Connect step on S3', () => {
  test('a sync that fails after the save is tried again on S3, not Google Drive', async () => {
    const vault = VaultStateTestFixture.create()
    vi.spyOn(vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
    const actions = new FirstRunActions(vault)
    actions.beginS3()
    vault.configureS3(S3ConnectionFixture.configuration())
    vault.firstRun = FirstRunStage.Connect
    const folder = vi
      .spyOn(VaultOAuthActions.prototype, 'connectGoogleVaultFolder')
      .mockResolvedValue(
        ok({ name: 'Nook', origin: GoogleVaultFolderOrigin.Existing }),
      )
    // Saving projects the saved credentials back: the storage mode is local
    // again and the S3 draft is gone.
    vi.spyOn(vault, 'ensureProviderSaved').mockImplementation(() => {
      vault.storageMode = LOCAL_PROVIDER_TYPE
      vault.clearS3()
      return Promise.resolve(ok(ProviderSaveOutcome.Saved))
    })
    const sync = vi
      .spyOn(vault.identityControl, 'syncWithMounts')
      .mockResolvedValueOnce(
        err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
      )
      .mockResolvedValueOnce(ok(IdentityActionOutcome.Completed))
    vi.spyOn(vault.identityControl, 'grantedVaultElsewhere').mockReturnValue(
      false,
    )
    vi.spyOn(vault, 'openSection').mockImplementation(() => {})
    const onDone = vi.fn()
    const props = {
      vault,
      onDone,
    } satisfies ComponentProps<typeof FirstRunConnectStep>

    const view = render(FirstRunConnectStep, props)

    const retry = await vi.waitFor(() =>
      view.getByTestId('first-run-connect-retry'),
    )
    const heading = view.getByRole('heading', { level: 1 })
    expect(heading.textContent?.trim()).toBe(I18N_KEYS.FirstRunConnectTitleS3)

    await fireEvent.click(retry)

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(sync).toHaveBeenCalledTimes(2)
    expect(folder).not.toHaveBeenCalled()
    expect(heading.textContent?.trim()).toBe(I18N_KEYS.FirstRunConnectTitleS3)
  })
})
