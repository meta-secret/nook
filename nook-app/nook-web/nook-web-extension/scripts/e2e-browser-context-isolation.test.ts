import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

class BrowserContextIsolationRegression {
  private async source(relativePath: string): Promise<string> {
    return readFile(new URL(relativePath, import.meta.url), 'utf8')
  }

  async extensionSmokeSource(): Promise<string> {
    return this.source('../e2e/extension-smoke.spec.ts')
  }

  async twoFactorEnrollmentSource(): Promise<string> {
    return this.source('../e2e/twofa-enrollment.spec.ts')
  }

  async extensionSmokeRuntimeSource(): Promise<string> {
    return this.source('../e2e/helpers/extension-smoke-runtime.ts')
  }
}

const regression = new BrowserContextIsolationRegression()

describe('extension E2E browser-context isolation', () => {
  test('does not close over a Node-side scenario inside page.evaluate', async () => {
    const source = await regression.extensionSmokeSource()

    expect(source).not.toContain(
      'extensionSmokeScenario.isLoginAccountResponseList',
    )
  })

  test('does not call a Node-side this method inside worker.evaluate', async () => {
    const source = await regression.twoFactorEnrollmentSource()

    expect(source).not.toContain('this.isAuthenticatorResponse(responseValue)')
  })

  test('accepts the extension credential adapter by its public contract', async () => {
    const source = await regression.extensionSmokeRuntimeSource()

    expect(source).not.toContain('credential instanceof PublicKeyCredential')
  })
})
