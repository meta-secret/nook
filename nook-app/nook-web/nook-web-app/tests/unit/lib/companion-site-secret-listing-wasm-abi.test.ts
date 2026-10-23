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
  type SiteSecretRow,
  type SiteSecretSection,
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

/** Reads the sections Rust presents. */
class SiteListingSections {
  /** A section's rows; none when its vault holds nothing the page needs. */
  static rows(section: SiteSecretSection): SiteSecretRow[] {
    switch (section.content.kind) {
      case 'Listed':
        return section.content.rows
      case 'Empty':
        return []
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

  test('present_site_secret_listing shows one identity:vault section per vault in grant order and filters by need', () => {
    const listing = present_site_secret_listing(
      SitePageNeed.AnySiteSecret,
      SiteListingInputs.vaults(),
    )
    expect(listing.summary).toEqual({ kind: 'Listed' })
    expect(
      listing.sections.map((section) => [
        section.vault_store_id,
        section.identity,
        section.vault,
      ]),
    ).toEqual([
      [
        'store_personalvlt',
        { kind: 'Named', name: 'Personal' },
        { kind: 'Named', name: 'www' },
      ],
      [
        'store_workvaultxx',
        { kind: 'Named', name: 'work' },
        { kind: 'Named', name: 'www' },
      ],
    ])
    expect(
      listing.sections.map((section) =>
        SiteListingSections.rows(section).map((row) => [
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
    expect(codes.summary).toEqual({ kind: 'Listed' })
    // The vault without a code keeps its section with Rust's muted line.
    expect(codes.sections.map((section) => section.content)).toEqual([
      {
        kind: 'Empty',
        message_key: I18N_KEYS.ExtensionActionSiteVaultEmpty,
      },
      {
        kind: 'Listed',
        rows: [expect.objectContaining({ kind: 'Authenticator' })],
      },
    ])
  })

  test('present_site_secret_listing types an empty result by need above every section', () => {
    const empty: SiteSecretVaults = {
      vaults: [SiteListingInputs.vault('store_personalvlt', 'Personal', [])],
    }
    expect(
      present_site_secret_listing(SitePageNeed.OneTimeCode, empty),
    ).toEqual({
      summary: {
        kind: 'Empty',
        message_key: I18N_KEYS.ExtensionActionSiteEmptyTotp,
        hint: { kind: 'Absent' },
      },
      sections: [
        {
          vault_store_id: 'store_personalvlt',
          identity: { kind: 'Named', name: 'Personal' },
          vault: { kind: 'Named', name: 'www' },
          content: {
            kind: 'Empty',
            message_key: I18N_KEYS.ExtensionActionSiteVaultEmpty,
          },
        },
      ],
      page_offer: { kind: 'Absent' },
    })
  })

  test('present_site_secret_listing offers to add the authenticator only for a setup page', () => {
    const setup = present_site_secret_listing(
      SitePageNeed.AuthenticatorSetup,
      SiteListingInputs.vaults(),
    )
    expect(setup.page_offer).toEqual({
      kind: 'AddAuthenticator',
      label_key: I18N_KEYS.ExtensionActionSiteAddAuthenticator,
    })
    // Replacing an authenticator keeps every saved site item listed.
    expect(setup.summary).toEqual({ kind: 'Listed' })
    for (const need of [
      SitePageNeed.AnySiteSecret,
      SitePageNeed.OneTimeCode,
      SitePageNeed.Credentials,
    ]) {
      expect(
        present_site_secret_listing(need, SiteListingInputs.vaults())
          .page_offer,
      ).toEqual({ kind: 'Absent' })
    }
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
