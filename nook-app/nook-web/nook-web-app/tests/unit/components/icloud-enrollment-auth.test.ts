import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte'
import { err } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { OAuthFailure, OAuthFailureKind } from '$lib/auth/oauth-failure'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const prepareICloudSignInControl = vi.hoisted(() => vi.fn())

vi.mock('$lib/auth/icloud/oauth', () => ({
  iCloudOAuthSession: { prepareICloudSignInControl },
}))

import ICloudEnrollmentAuth from '$lib/components/login/ICloudEnrollmentAuth.svelte'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('iCloud enrollment authentication', () => {
  test('shows a typed preparation failure and retries after reopening', async () => {
    const failure = new OAuthFailure(OAuthFailureKind.CloudKitAuthentication)
    prepareICloudSignInControl.mockResolvedValue(err(failure))
    const vault = VaultStateTestFixture.create()
    vi.spyOn(vault, 't').mockImplementation((request) =>
      `translated:${typeof request === 'string' ? request : request.key}`,
    )
    const view = render(ICloudEnrollmentAuth, { vault })
    const toggle = view.getByTestId('enrollment-icloud-auth-toggle')

    await fireEvent.click(toggle)
    await waitFor(() => {
      expect(
        view.getByText(`translated:${failure.translationKey}`),
      ).toBeTruthy()
    })

    await fireEvent.click(toggle)
    await fireEvent.click(toggle)
    await waitFor(() => {
      expect(prepareICloudSignInControl).toHaveBeenCalledTimes(2)
    })
  })
})
