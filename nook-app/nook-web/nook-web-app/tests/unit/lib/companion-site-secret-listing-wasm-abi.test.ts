import { describe, expect, test } from 'vitest'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  AuthenticationWorkflowStage,
  SitePageNeed,
  present_site_secret_listing,
  site_page_need,
  type AuthenticationWorkflowMatch,
  type AuthenticationWorkflowSnapshot,
  type SiteSecretItem,
  type SiteSecretVault,
  type SiteSecretVaults,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'

/** Classified workflows and vault matches as the extension passes them to Rust. */
class SiteListingInputs {
  static matched(
    kind: AuthenticationWorkflowKind,
  ): AuthenticationWorkflowMatch {
    const snapshot: AuthenticationWorkflowSnapshot = {
      kind,
      stage: AuthenticationWorkflowStage.Credentials,
      action: AuthenticationWorkflowAction.ContinueWithNook,
      currentStep: 1,
      totalSteps: 1,
      approvalRequirement: 'explicit-user-approval',
      savedLoginCapability: 'unavailable',
      observationIndex: 0,
    }
    return { kind: 'matched', snapshot }
  }

  static item(
    kind: SiteSecretItem['kind'],
    secretId: string,
    title: string,
  ): SiteSecretItem {
    return {
      kind,
      secret_id: secretId,
      title,
      account: 'bynull',
      saved_host: 'www.namecheap.com',
    }
  }

  static vault(
    vaultStoreId: string,
    identityName: string,
    items: SiteSecretItem[],
  ): SiteSecretVault {
    return {
      vault_store_id: vaultStoreId,
      vault_name: 'www',
      identity: { device_id: `${identityName}-device`, name: identityName },
      matches: { items },
    }
  }

  static vaults(): SiteSecretVaults {
    return {
      vaults: [
        SiteListingInputs.vault('store_personalvlt', 'Personal', [
          SiteListingInputs.item('Passkey', 'secret_passkey01', 'Namecheap'),
          SiteListingInputs.item('Login', 'secret_login0001', 'namecheap.com'),
        ]),
        SiteListingInputs.vault('store_workvaultxx', 'work', [
          SiteListingInputs.item(
            'Authenticator',
            'secret_totp00001',
            'Namecheap',
          ),
        ]),
      ],
    }
  }
}

describe('companion site-secret listing WASM ABI', () => {
  test('site_page_need maps the classified workflow to what This site lists', () => {
    expect(
      site_page_need(
        SiteListingInputs.matched(AuthenticationWorkflowKind.TotpChallenge),
      ),
    ).toBe(SitePageNeed.OneTimeCode)
    expect(
      site_page_need(
        SiteListingInputs.matched(AuthenticationWorkflowKind.Login),
      ),
    ).toBe(SitePageNeed.Credentials)
    const noMatch: AuthenticationWorkflowMatch = { kind: 'no-match' }
    expect(site_page_need(noMatch)).toBe(SitePageNeed.AnySiteSecret)
  })

  test('present_site_secret_listing groups rows under identities in grant order and filters by need', () => {
    const listing = present_site_secret_listing(
      SitePageNeed.AnySiteSecret,
      SiteListingInputs.vaults(),
    )
    if (listing.kind !== 'Listed') throw new Error('expected rows')
    expect(listing.groups.map((group) => group.header)).toEqual([
      { kind: 'Named', name: 'Personal' },
      { kind: 'Named', name: 'work' },
    ])
    expect(
      listing.groups.map((group) =>
        group.rows.map((row) => [
          row.kind,
          row.type_label_key,
          row.action.kind,
        ]),
      ),
    ).toEqual([
      [
        ['Login', I18N_KEYS.VaultTypesLogin, 'FillLogin'],
        ['Passkey', I18N_KEYS.VaultTypesPasskey, 'ViewOnly'],
      ],
      [['Authenticator', I18N_KEYS.VaultTypesAuthenticator, 'FillCode']],
    ])

    const codes = present_site_secret_listing(
      SitePageNeed.OneTimeCode,
      SiteListingInputs.vaults(),
    )
    if (codes.kind !== 'Listed') throw new Error('expected rows')
    expect(
      codes.groups.flatMap((group) => group.rows.map((row) => row.kind)),
    ).toEqual(['Authenticator'])
  })

  test('present_site_secret_listing types an empty result by need', () => {
    const empty: SiteSecretVaults = {
      vaults: [SiteListingInputs.vault('store_personalvlt', 'Personal', [])],
    }
    expect(
      present_site_secret_listing(SitePageNeed.OneTimeCode, empty),
    ).toEqual({
      kind: 'Empty',
      message_key: I18N_KEYS.ExtensionActionSiteEmptyTotp,
      hint: { kind: 'Absent' },
    })
  })

  test('present_site_secret_listing rejects an invalid store id as a JavaScript error', () => {
    const invalidId = {
      vaults: [SiteListingInputs.vault('not a store id', 'Personal', [])],
    }
    expect(() =>
      present_site_secret_listing(SitePageNeed.AnySiteSecret, invalidId),
    ).toThrow('Invalid site secret vault matches.')
  })
})
