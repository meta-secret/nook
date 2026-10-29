import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { err } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { JoinICloudSignIn } from '$lib/vault/state/ui.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const prepareICloudSignInControl = vi.hoisted(() => vi.fn())

vi.mock('$lib/auth/icloud/oauth', () => ({
  iCloudOAuthSession: { prepareICloudSignInControl },
}))

import ICloudEnrollmentAuth from '$lib/components/login/ICloudEnrollmentAuth.svelte'
import JoinThisDevice from '../../../../nook-web-shared/src/vault-app/lib/components/join/JoinThisDevice.svelte'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('iCloud sign-in for an invite kept in iCloud', () => {
  test('prepares the sign-in when shown, says why it failed, and tries again', async () => {
    const failure = new OAuthFailure(OAuthFailureKind.CloudKitAuthentication)
    prepareICloudSignInControl.mockResolvedValue(err(failure))
    const vault = VaultStateTestFixture.create()
    vi.spyOn(vault, 't').mockImplementation(
      (request) =>
        `translated:${typeof request === 'string' ? request : request.key}`,
    )
    const view = render(ICloudEnrollmentAuth, { vault })

    await waitFor(() => {
      expect(
        view.getByText(`translated:${failure.translationKey}`),
      ).toBeTruthy()
    })
    await fireEvent.click(view.getByTestId('enrollment-icloud-auth-retry'))
    await waitFor(() => {
      expect(prepareICloudSignInControl).toHaveBeenCalledTimes(2)
    })
  })

  test('the join screen asks for iCloud only once the invite needs it', async () => {
    const failure = new OAuthFailure(OAuthFailureKind.CloudKitAuthentication)
    prepareICloudSignInControl.mockResolvedValue(err(failure))
    const vault = VaultStateTestFixture.create()
    const props: ComponentProps<typeof JoinThisDevice> = {
      vault,
      isVerifying: false,
      onUseEnrollmentCode: vi.fn(),
    }
    const view = render(JoinThisDevice, props)

    expect(view.queryAllByTestId('enrollment-icloud-auth')).toHaveLength(0)
    expect(prepareICloudSignInControl).not.toHaveBeenCalled()

    vault.joinICloudSignIn = JoinICloudSignIn.Needed
    await waitFor(() => {
      expect(view.getAllByTestId('enrollment-icloud-auth')).toHaveLength(1)
    })
  })
})
