function shell(title: string, body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f7; color: #171921; }
      main { width: min(420px, calc(100vw - 32px)); padding: 28px; border: 1px solid #d8dce5; border-radius: 16px; background: #fff; box-shadow: 0 18px 50px rgb(0 0 0 / 8%); }
      h1 { margin: 0 0 8px; font-size: 26px; }
      p { margin: 0 0 18px; color: #5b6475; line-height: 1.45; }
      form { display: grid; gap: 14px; }
      label { display: grid; gap: 6px; font-size: 13px; font-weight: 650; }
      input { min-height: 44px; padding: 10px 12px; border: 1px solid #c9ced8; border-radius: 10px; font: inherit; }
      button { min-height: 44px; border: 0; border-radius: 10px; background: #171921; color: #fff; font: 700 14px/1 Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
      .error { color: #9b1c1c; }
      .ok { color: #0f6b3c; font-weight: 650; }
    </style>
  </head>
  <body><main>${body}</main></body>
</html>`
}

export function plainLoginPage(error?: string): string {
  return shell(
    'Mock plain login',
    `
      <h1>Sign in</h1>
      <p data-testid="mock-auth-scenario">plain-login</p>
      ${error ? `<p class="error" role="alert">${error}</p>` : ''}
      <form id="login-form" method="post" action="/plain/login">
        <label>Email <input autocomplete="username" name="username" type="email" /></label>
        <label>Password <input autocomplete="current-password" name="password" type="password" /></label>
        <button type="submit">Sign in</button>
      </form>
      <script>
        window.__nookLoginSubmitted = null
        document.getElementById('login-form').addEventListener('submit', (event) => {
          const form = event.currentTarget
          window.__nookLoginSubmitted = {
            email: form.querySelector('[name="username"]').value,
            password: form.querySelector('[name="password"]').value,
          }
        })
      </script>
    `,
  )
}

export function totpLoginPage(error?: string): string {
  return shell(
    'Mock login with 2FA',
    `
      <h1>Sign in</h1>
      <p data-testid="mock-auth-scenario">login-then-totp</p>
      ${error ? `<p class="error" role="alert">${error}</p>` : ''}
      <form id="login-form" method="post" action="/totp/login">
        <label>Email <input autocomplete="username" name="username" type="email" /></label>
        <label>Password <input autocomplete="current-password" name="password" type="password" /></label>
        <button type="submit">Sign in</button>
      </form>
      <script>
        window.__nookLoginSubmitted = null
        document.getElementById('login-form').addEventListener('submit', (event) => {
          const form = event.currentTarget
          window.__nookLoginSubmitted = {
            email: form.querySelector('[name="username"]').value,
            password: form.querySelector('[name="password"]').value,
          }
        })
      </script>
    `,
  )
}

export function totpVerifyPage(error?: string): string {
  return shell(
    'Mock 2FA verification',
    `
      <h1>Verify account</h1>
      <p data-testid="mock-auth-scenario">totp-challenge</p>
      ${error ? `<p class="error" role="alert">${error}</p>` : ''}
      <form id="otp-form" method="post" action="/totp/verify">
        <label>Authentication code
          <input autocomplete="one-time-code" inputmode="numeric" name="otp" />
        </label>
        <button type="submit">Verify</button>
      </form>
    `,
  )
}

export function successPage(flow: string): string {
  return shell(
    'Mock auth success',
    `
      <h1>Signed in</h1>
      <p class="ok" data-testid="mock-auth-success">Authentication complete</p>
      <p data-testid="mock-auth-flow">${flow}</p>
    `,
  )
}

export function detectionLoginPage(): string {
  return `<!doctype html>
<html>
  <head><title>Nook extension e2e login</title></head>
  <body>
    <main>
      <h1>Sign in</h1>
      <form id="login-form">
        <label>Email <input autocomplete="username" name="email" type="email" /></label>
        <label>Password <input autocomplete="current-password" name="password" type="password" /></label>
        <button type="submit">Sign in</button>
      </form>
    </main>
    <script>
      window.__nookLoginSubmitted = null
      document.getElementById('login-form').addEventListener('submit', (event) => {
        event.preventDefault()
        const form = event.currentTarget
        window.__nookLoginSubmitted = {
          email: form.querySelector('[name="email"]').value,
          password: form.querySelector('[name="password"]').value,
        }
      })
    </script>
  </body>
</html>`
}

export function detectionSignupPage(): string {
  return `<!doctype html>
<html><body><main><h1>Create account</h1>
  <form>
    <input autocomplete="username" name="email" type="email" />
    <input autocomplete="new-password" name="password" type="password" />
    <input autocomplete="new-password" name="password-confirm" type="password" />
    <button type="submit">Create account</button>
  </form>
</main></body></html>`
}

export function detectionOtpPage(): string {
  return `<!doctype html>
<html><body><main><h1>Verify account</h1>
  <form>
    <input autocomplete="one-time-code" inputmode="numeric" name="otp" />
    <button type="submit">Verify</button>
  </form>
</main></body></html>`
}

export function detectionHiddenOtpPage(): string {
  return `<!doctype html>
<html><body><main><h1>Verify account</h1>
  <form id="otp-form" hidden>
    <input autocomplete="one-time-code" inputmode="numeric" name="otp" />
    <button type="submit">Verify</button>
  </form>
  <button id="reveal-otp" type="button">Continue to verification</button>
  <script>
    document.getElementById('reveal-otp').addEventListener('click', (event) => {
      document.getElementById('otp-form').hidden = false
      event.currentTarget.remove()
    })
  </script>
</main></body></html>`
}

export function detectionCombinedPage(): string {
  return `<!doctype html>
<html><body><main>
  <form id="signup-form">
    <input autocomplete="section-signup username" name="signup-email" type="email" />
    <input autocomplete="section-signup new-password" name="signup-password" type="password" />
    <button type="submit">Create account</button>
  </form>
  <form id="login-form">
    <input autocomplete="section-login username" name="email" type="email" />
    <input autocomplete="section-login current-password webauthn" name="password" type="password" />
    <button type="submit">Sign in</button>
  </form>
</main></body></html>`
}

export function detectionSpaPage(): string {
  return `<!doctype html>
<html><body><main>
  <form id="login-form">
    <input autocomplete="username" name="email" type="email" />
    <button id="next" type="button">Next</button>
  </form>
  <script>
    document.getElementById('next').addEventListener('click', (event) => {
      const form = document.getElementById('login-form')
      event.currentTarget.remove()
      form.insertAdjacentHTML('beforeend',
        '<input autocomplete="current-password" name="password" type="password" /><button type="submit">Sign in</button>')
    })
  </script>
</main></body></html>`
}

export function detectionHiddenHeaderLoginPage(): string {
  return `<!doctype html>
<html><body>
  <form id="aspnetForm">
    <div class="gb-dropdown__holder" style="display: none">
      <input name="LoginUserName" type="text" />
      <input id="header-password" name="LoginPassword" type="password" />
    </div>
    <fieldset class="loginForm">
      <h1>Log in to your account</h1>
      <input name="LoginUserName" type="text" />
      <input id="main-password" name="LoginPassword" type="password" autocomplete="on" />
      <button type="submit">Sign in</button>
    </fieldset>
  </form>
</body></html>`
}
