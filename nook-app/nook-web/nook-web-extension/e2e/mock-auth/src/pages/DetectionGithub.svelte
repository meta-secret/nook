<script lang="ts">
  import {
    findPlainMockAuthAccount,
    MockAuthAccountLookupKind,
  } from '../../accounts'
  import { completePlainLogin, PlainLoginResult } from '../lib/plain-login'

  const SUBMISSION_EVIDENCE_KEY = 'github-submission-evidence'
  const EXPECTED_METADATA_IDENTITY =
    'add_account:|webauthn-conditional:unknown|javascript-support:unknown|webauthn-support:unknown|webauthn-iuvpaa-support:unknown|return_to:|allow_signup:|client_id:|integration:'

  let username = $state('')
  let password = $state('')
  let honeypot = $state('')
  let alternativeActivationCount = $state(0)
  let error = $state('')

  function recordAlternativeActivation(): void {
    alternativeActivationCount += 1
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const submitter = event.submitter
    const submittedControlIdentity =
      submitter instanceof HTMLInputElement
        ? `${submitter.name}:${submitter.value}`
        : ''
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const metadataIdentity = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    )
      .map((field) => `${field.name}:${field.value}`)
      .join('|')
    const credentialsMatched =
      findPlainMockAuthAccount(username, password).kind ===
      MockAuthAccountLookupKind.Found
    const metadataUnchanged = metadataIdentity === EXPECTED_METADATA_IDENTITY
    sessionStorage.setItem(
      SUBMISSION_EVIDENCE_KEY,
      JSON.stringify({
        submittedControlIdentity,
        credentialsMatched,
        honeypotUnchanged: honeypot === '',
        metadataUnchanged,
        alternativesUntouched: alternativeActivationCount === 0,
      }),
    )
    if (
      submittedControlIdentity !== 'commit:Sign in' ||
      honeypot !== '' ||
      alternativeActivationCount !== 0 ||
      !metadataUnchanged ||
      !credentialsMatched
    ) {
      error = 'Authentication was not completed.'
      return
    }
    if (completePlainLogin(username, password) === PlainLoginResult.Invalid)
      error = 'Authentication was not completed.'
  }
</script>

<main>
  <h1>Sign in to GitHub</h1>
  <p data-testid="mock-auth-scenario">github-owned-login</p>
  {#if error}
    <p role="alert">{error}</p>
  {/if}

  <form
    data-turbo="false"
    action="/session"
    method="post"
    accept-charset="UTF-8"
    onsubmit={submit}
  >
    <input name="add_account" type="hidden" value="" />
    <input name="webauthn-conditional" type="hidden" value="unknown" />
    <input name="javascript-support" type="hidden" value="unknown" />
    <input name="webauthn-support" type="hidden" value="unknown" />
    <input name="webauthn-iuvpaa-support" type="hidden" value="unknown" />
    <input name="return_to" type="hidden" value="" />
    <input name="allow_signup" type="hidden" value="" />
    <input name="client_id" type="hidden" value="" />
    <input name="integration" type="hidden" value="" />
    <input
      name="required_field_mock_auth"
      type="text"
      class="form-control"
      hidden
      bind:value={honeypot}
    />

    <label for="login_field">Username or email address</label>
    <input
      id="login_field"
      name="login"
      type="text"
      autocapitalize="off"
      autocorrect="off"
      autocomplete="username"
      autofocus
      required
      bind:value={username}
    />
    <label for="password">Password</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      required
      bind:value={password}
    />
    <a id="forgot-password" href="/password_reset">Forgot password?</a>
    <input
      type="submit"
      name="commit"
      value="Sign in"
      class="js-sign-in-button"
      data-disable-with="Signing in…"
      data-signin-label="Sign in"
      data-sso-label="Sign in with your identity provider"
    />
  </form>

  <section aria-label="Other sign-in options">
    <button type="button" onclick={recordAlternativeActivation}
      >Continue with Google</button
    >
    <button type="button" onclick={recordAlternativeActivation}
      >Continue with Apple</button
    >
    <button type="button" onclick={recordAlternativeActivation}
      >Sign in with a passkey</button
    >
    <a href="/signup">Create an account</a>
  </section>
</main>
