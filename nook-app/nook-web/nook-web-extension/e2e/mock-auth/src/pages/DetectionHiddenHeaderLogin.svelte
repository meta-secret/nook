<script lang="ts">
  import { completePlainLogin, PlainLoginResult } from '../lib/plain-login'

  const SUBMISSION_EVIDENCE_KEY = 'namecheap-submission-evidence'

  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return

    const fieldValue = (selector: string): string => {
      const field = form.querySelector<HTMLInputElement>(selector)
      return field ? field.value : ''
    }
    const submitter = event.submitter
    const submittedControlIdentity =
      submitter instanceof HTMLElement ? submitter.id : ''
    const username = fieldValue('fieldset.loginForm [name="LoginUserName"]')
    const password = fieldValue('#main-password')
    sessionStorage.setItem(
      SUBMISSION_EVIDENCE_KEY,
      JSON.stringify({
        submittedControlIdentity,
        headerUsernameUnchanged:
          fieldValue('#header-username') === 'header-user',
        headerPasswordUnchanged:
          fieldValue('#header-password') === 'header-password',
        searchUnchanged: fieldValue('#account-search') === 'account help',
        newsletterUnchanged:
          fieldValue('#newsletter-email') === 'reader@example.test',
        loginCredentialsMatched:
          username === 'alice@nook.test' &&
          password === 'extension-fill-password',
      }),
    )
    if (submittedControlIdentity !== 'login-submit') {
      error = 'Unexpected form control submitted.'
      return
    }
    if (completePlainLogin(username, password) === PlainLoginResult.Invalid) {
      error = 'Invalid username or password.'
    }
  }
</script>

<form id="aspnetForm" method="post" action="/auth/login" {onsubmit}>
  <header>
    <div class="gb-dropdown__holder" style="display: none">
      <input
        id="header-username"
        name="LoginUserName"
        title="Your username"
        autocomplete="on"
        value="header-user"
      />
      <input
        id="header-password"
        name="LoginPassword"
        title="Your password"
        type="password"
        autocomplete="on"
        value="header-password"
      />
    </div>
    <input
      id="account-search"
      name="search"
      type="search"
      value="account help"
    />
    <button id="header-submit" type="submit">Search</button>
  </header>
  <div class="gb-scope loginBox nc_login">
    <div class="gb-panel">
      <div class="gb-panel__body">
        <fieldset class="loginForm">
          <h1>Log in to your account</h1>
          <p data-testid="mock-auth-scenario">hidden-header-login</p>
          {#if error}
            <p class="error" role="alert">{error}</p>
          {/if}
          <input
            name="LoginUserName"
            title="Your username"
            autocomplete="on"
            class="gb-form-control nc_username nc_username_required"
          />
          <input
            id="main-password"
            name="LoginPassword"
            title="Your password"
            type="password"
            autocomplete="on"
            class="nc_password nc_password_required handlereturn gb-form-control"
          />
          <input
            id="login-submit"
            type="submit"
            value="Sign in"
            class="nc_login_submit"
          />
        </fieldset>
      </div>
    </div>
  </div>
  <footer>
    <input
      id="newsletter-email"
      name="newsletter-email"
      type="email"
      value="reader@example.test"
    />
    <button id="passkey-control" type="button">Use a passkey</button>
    <button id="footer-submit" type="submit">Subscribe</button>
  </footer>
</form>
