import { fireEvent, render } from '@testing-library/svelte'
import { expect, test, vi } from 'vitest'
import { FirstRunStage } from '$lib/vault/state/ui.svelte'
import FirstRunProtectStep from '$lib/components/login/FirstRunProtectStep.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import enLocale from '../../../../../nook-platform/nook-app-common/locales/en.json' with { type: 'json' }
import ruLocale from '../../../../../nook-platform/nook-app-common/locales/ru.json' with { type: 'json' }

test.each([enLocale, ruLocale])(
  'explains local passkey protection without keyring jargon and supports returning to start',
  async (locale) => {
    const vault = VaultStateTestFixture.create()
    vault.translations = JSON.stringify(locale)
    vault.firstRun = FirstRunStage.Protect
    const onBack = vi.fn()
    const view = render(FirstRunProtectStep, { vault, onBack })

    const step = view.getByTestId('first-run-protect-step')
    expect(step.textContent).not.toMatch(/keyring/i)
    expect(step.textContent).not.toMatch(/связк/i)
    expect(
      view.getByRole('heading', {
        level: 1,
        name: locale.first_run.protect_title,
      }),
    ).toBeTruthy()
    expect(view.getByText(locale.first_run.protect_body)).toBeTruthy()
    expect(view.getByTestId('device-protection-gate')).toBeTruthy()

    const back = view.getByTestId('first-run-back')
    expect(back.matches(':disabled')).toBe(false)
    await fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()

    vault.isVerifying = true
    await view.rerender({ vault, onBack })
    expect(back.matches(':disabled')).toBe(true)
  },
)
