import { expect, test, type Page, type Route, type TestInfo } from '../fixtures'
import {
  launchPairedPinExtension,
  saveVaultLogin,
} from '../../../nook-web-extension/e2e/helpers/paired-pin-extension'
import { demoBeat } from './pilot-demo-helpers'

interface GoogleLoginDemoCapabilities {
  readonly browserPage: Page
  readonly recordingPage: Page
  readonly testInfo: TestInfo
}

interface GoogleDemoCheckpoint {
  readonly name: string
  readonly caption: string
}

class GoogleLoginDemo {
  constructor(private readonly capabilities: GoogleLoginDemoCapabilities) {}

  async recordCheckpoint(request: GoogleDemoCheckpoint): Promise<void> {
    const screenshot: Parameters<Page['screenshot']>[0] = {
      path: this.capabilities.testInfo.outputPath(`${request.name}.png`),
    }
    const image = await this.capabilities.browserPage.screenshot(screenshot)
    const attachment: Parameters<TestInfo['attach']>[1] = {
      body: image,
      contentType: 'image/png',
    }
    await this.capabilities.testInfo.attach(request.name, attachment)
    await this.capabilities.recordingPage.setContent(
      `<html><head><title>Selected Google login demo</title></head><body style="margin:0;background:#f8fafd;font:20px system-ui;color:#202124"><p style="margin:20px">${request.caption}</p><img alt="Actual paired extension checkpoint" style="width:100%;max-height:650px;object-fit:contain" src="data:image/png;base64,${image.toString('base64')}"></body></html>`,
    )
    await demoBeat(this.capabilities.recordingPage)
  }

  private readonly identifierFixture = `<!doctype html><html><head><title>Google Account sign in</title>
<style>:root { color-scheme:light; font-family:system-ui,sans-serif; } body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f8fafd; color:#202124; } main { width:400px; padding:36px; border:1px solid #dadce0; border-radius:14px; background:white; } h1 { font-weight:500; } label { display:grid; gap:10px; margin:24px 0; } input,button { padding:12px; font:inherit; border:1px solid #80868b; border-radius:6px; } button { background:#1a73e8; color:white; cursor:pointer; } p { color:#5f6368; }</style>
</head><body><main><h1>Sign in</h1><p>Use your Google Account</p>
<label>Email or phone<input id="identifierId" name="identifier" type="text" autocomplete="username webauthn"></label>
<input name="hiddenPassword" type="password" aria-hidden="true" style="display:none">
<div id="identifierNext"><div><button type="button">Next</button></div></div>
<script>
const root = document.documentElement;
root.dataset.identifierNextCount = '0';
root.dataset.passwordFillCount = '0';
root.dataset.passwordSubmitCount = '0';
document.querySelector('#identifierNext button').addEventListener('click', () => {
  root.dataset.selectedUsername = document.querySelector('#identifierId').value;
  root.dataset.identifierNextCount = String(Number(root.dataset.identifierNextCount) + 1);
  history.pushState('', '', '/v3/signin/challenge/pwd');
  document.querySelector('main').innerHTML = '<h1>Welcome</h1><p id="selected-account"></p><label>Enter your password<input name="Passwd" type="password" autocomplete="current-password"></label><div id="passwordNext"><button type="button">Next</button></div><p id="site-status" role="status">Password submission awaits your explicit Next.</p>';
  document.querySelector('#selected-account').textContent = root.dataset.selectedUsername;
  document.querySelector('[name=Passwd]').addEventListener('input', () => {
    root.dataset.passwordFillCount = String(Number(root.dataset.passwordFillCount) + 1);
  });
  document.querySelector('#passwordNext button').addEventListener('click', () => {
    root.dataset.passwordSubmitCount = String(Number(root.dataset.passwordSubmitCount) + 1);
    document.querySelector('#site-status').textContent = 'Synthetic Google sign-in submitted explicitly.';
  });
});
</script></main></body></html>`

  async fulfillIdentifier(route: Route): Promise<void> {
    const fulfillment: Parameters<Route['fulfill']>[0] = {
      contentType: 'text/html',
      body: this.identifierFixture,
    }
    await route.fulfill(fulfillment)
  }
}

test('selected Google login advances the identifier and fills its password once before explicit submission', async ({
  page: recordingPage,
}, testInfo) => {
  const paired = await launchPairedPinExtension(testInfo)
  try {
    await saveVaultLogin(
      paired.vaultPage,
      'https://accounts.google.com',
      'selected@nook.test',
      'selected-demo-password',
    )
    const browserPage = await paired.context.newPage()
    const capabilities: GoogleLoginDemoCapabilities = {
      browserPage,
      recordingPage,
      testInfo,
    }
    const demo = new GoogleLoginDemo(capabilities)
    await browserPage.route(
      'https://accounts.google.com/**',
      demo.fulfillIdentifier.bind(demo),
    )
    await browserPage.goto(
      'https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn',
    )
    const widget = browserPage.locator('#nook-auth-widget')
    await expect(widget.getByText('Ready to sign in')).toBeVisible()
    const selectionCheckpoint: GoogleDemoCheckpoint = {
      name: 'google-select-saved-login',
      caption:
        'Select the synthetic saved Google login with Continue with Nook.',
    }
    await demo.recordCheckpoint(selectionCheckpoint)
    await widget.getByRole('button', { name: 'Continue with Nook' }).click()

    await expect(browserPage).toHaveURL(
      'https://accounts.google.com/v3/signin/challenge/pwd',
    )
    await expect(browserPage.locator('#selected-account')).toHaveText(
      'selected@nook.test',
    )
    await expect(browserPage.locator('[name="Passwd"]')).toHaveValue(
      'selected-demo-password',
    )
    await expect(browserPage.locator('html')).toHaveAttribute(
      'data-identifier-next-count',
      '1',
    )
    await expect(browserPage.locator('html')).toHaveAttribute(
      'data-password-fill-count',
      '1',
    )
    await expect(browserPage.locator('html')).toHaveAttribute(
      'data-password-submit-count',
      '0',
    )
    const passwordCheckpoint: GoogleDemoCheckpoint = {
      name: 'google-password-filled-awaiting-user',
      caption:
        'Google Next advanced once. The same saved password filled once; submission still awaits you.',
    }
    await demo.recordCheckpoint(passwordCheckpoint)

    await browserPage.locator('#passwordNext button').click()
    await expect(browserPage.locator('html')).toHaveAttribute(
      'data-password-submit-count',
      '1',
    )
    await expect(browserPage.getByRole('status')).toHaveText(
      'Synthetic Google sign-in submitted explicitly.',
    )
    const submittedCheckpoint: GoogleDemoCheckpoint = {
      name: 'google-user-submitted-password',
      caption: 'Your separate explicit Next submits the password.',
    }
    await demo.recordCheckpoint(submittedCheckpoint)
  } finally {
    await paired.context.close()
  }
})
