import { describe, expect, test } from 'bun:test'
import {
  ExtensionConnectStartKind,
  ExtensionConnectStarts,
  type ExtensionConnectStart,
} from '../../nook-web-shared/src/extension/extension-connect-start'

// The side panel's connect choice travels to Nook's connect page in the URL
// fragment the service worker writes; the page reads it back.

describe('extension connect start fragment', () => {
  test('a named first vault and a join survive the trip to the connect page', () => {
    const starts: ExtensionConnectStart[] = [
      { kind: ExtensionConnectStartKind.Create, vaultName: 'Home & Family' },
      { kind: ExtensionConnectStartKind.Join },
    ]
    for (const start of starts) {
      const url = new URL('https://simple.nokey.sh/extension-connect?nonce=n')
      url.hash = ExtensionConnectStarts.fragment(start)
      expect(ExtensionConnectStarts.fromFragment(url.hash)).toEqual(start)
    }
  })

  test('no choice writes no fragment', () => {
    expect(
      ExtensionConnectStarts.fragment(ExtensionConnectStarts.unspecified()),
    ).toBe('')
    expect(ExtensionConnectStarts.fromFragment('')).toEqual(
      ExtensionConnectStarts.unspecified(),
    )
  })

  test('a fragment the page cannot read is no choice', () => {
    for (const hash of [
      '#start=create',
      '#start=create&vault_name=%20%20',
      `#start=create&vault_name=${'x'.repeat(65)}`,
      '#start=delete',
      '#vault_name=Home',
    ]) {
      expect(ExtensionConnectStarts.fromFragment(hash)).toEqual(
        ExtensionConnectStarts.unspecified(),
      )
    }
  })

  test('the page prefills the named vault or opens on joining', () => {
    const create: ExtensionConnectStart = {
      kind: ExtensionConnectStartKind.Create,
      vaultName: 'Home',
    }
    const join: ExtensionConnectStart = {
      kind: ExtensionConnectStartKind.Join,
    }
    expect(ExtensionConnectStarts.presetVaultName(create)).toBe('Home')
    expect(ExtensionConnectStarts.opensJoin(create)).toBe(false)
    expect(ExtensionConnectStarts.presetVaultName(join)).toBe('')
    expect(ExtensionConnectStarts.opensJoin(join)).toBe(true)
    const none = ExtensionConnectStarts.unspecified()
    expect(ExtensionConnectStarts.presetVaultName(none)).toBe('')
    expect(ExtensionConnectStarts.opensJoin(none)).toBe(false)
  })
})
