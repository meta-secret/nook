import { describe, expect, test } from 'bun:test'
import {
  extensionArchiveName,
  extensionInstallTarget,
} from './deployment-package'

describe('extension deployment archive', () => {
  test('uses predictable channel-specific names', () => {
    expect(extensionArchiveName('production', '1.2.3')).toBe(
      'nook-passwords-1.2.3.zip',
    )
    expect(extensionArchiveName('development', '1.2.3')).toBe(
      'nook-passwords-dev.zip',
    )
    expect(extensionArchiveName('local', '1.2.3')).toBe(
      'nook-passwords-local.zip',
    )
    expect(extensionArchiveName('pr-408', '1.2.3')).toBe(
      'nook-passwords-pr-408.zip',
    )
  })

  test('rejects unsafe production versions', () => {
    expect(() => extensionArchiveName('production', '../latest')).toThrow()
  })

  test('sends production installs to the Chrome Web Store', () => {
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
    expect(
      extensionInstallTarget(
        'production',
        extensionId,
        'https://nokey.sh/downloads/nook-passwords-1.2.3.zip',
      ),
    ).toEqual({
      install_method: 'chrome_web_store',
      install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
    })
  })

  test('keeps non-production installs on the channel ZIP', () => {
    const downloadUrl =
      'https://pr-408.nokey-sh.pages.dev/downloads/nook-passwords-pr-408.zip'
    expect(
      extensionInstallTarget(
        'pr-408',
        'abcdefghijklmnopabcdefghijklmnop',
        downloadUrl,
      ),
    ).toEqual({ install_method: 'manual_zip', install_url: downloadUrl })
  })

  test('rejects invalid extension IDs when creating install links', () => {
    expect(() =>
      extensionInstallTarget(
        'production',
        'invalid',
        'https://nokey.sh/downloads/nook-passwords-1.2.3.zip',
      ),
    ).toThrow()
  })
})
