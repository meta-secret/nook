<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  import {
    NETFLIX_MOCK_PASSWORD,
    NETFLIX_MOCK_USERNAME,
    NetflixAuthMockScenario,
    NetflixAuthTransitionKind,
  } from '../lib/netflix-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'netflix-submission-evidence'
  const PASSWORD_AUTOCOMPLETE =
    'password' as HTMLInputAttributes['autocomplete']
  let username = $state('')
  let password = $state('')
  let auxiliaryActivationCount = $state(0)
  let error = $state('')

  function recordAuxiliary(event: Event): void {
    event.preventDefault()
    auxiliaryActivationCount += 1
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const submittedControl =
      event.submitter instanceof HTMLButtonElement
        ? ((label) => (label ? label.trim() : ''))(event.submitter.textContent)
        : ''
    const completed =
      NetflixAuthMockScenario.transition({
        username,
        password,
        submittedControl,
        formMethod: form.method,
        formHasAction: form.hasAttribute('action'),
        auxiliaryActivationCount,
      }) === NetflixAuthTransitionKind.Completed
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        credentialsMatched:
          username === NETFLIX_MOCK_USERNAME &&
          password === NETFLIX_MOCK_PASSWORD,
        postWithoutAction:
          form.method === 'post' && !form.hasAttribute('action'),
        auxiliaryControlsUntouched: auxiliaryActivationCount === 0,
      }),
    )
    if (!completed) {
      error = 'Authentication was not completed.'
      return
    }
    navigate('/plain/success')
  }
</script>

<main>
  <h1>Enter your info to sign in</h1>
  <p data-testid="mock-auth-scenario">netflix-combined</p>
  {#if error}<p role="alert">{error}</p>{/if}
  <form method="post" data-testid="netflix-login-form" onsubmit={submit}>
    <label
      >Email or mobile number<input
        name="userLoginId"
        type="text"
        autocomplete="email"
        aria-label="Email or mobile number"
        bind:value={username}
      /></label
    >
    <label
      >Password<input
        name="password"
        type="password"
        autocomplete={PASSWORD_AUTOCOMPLETE}
        aria-label="Password"
        bind:value={password}
      /></label
    >
    <button type="submit">Continue</button>
    <button type="button" onclick={recordAuxiliary}>Get Help</button>
  </form>

  <section aria-labelledby="netflix-new-account-heading">
    <h2 id="netflix-new-account-heading">Or get started with a new account.</h2>
    <a href="/signup" onclick={recordAuxiliary}>Sign up</a>
  </section>
  <p data-testid="netflix-recaptcha-disclosure">
    This page is protected by reCAPTCHA to ensure you're not a bot.
  </p>
  <footer>
    <a href="/help" onclick={recordAuxiliary}>Questions? Contact us.</a>
    <a href="/terms" onclick={recordAuxiliary}>Terms of Use</a>
    <a href="/privacy" onclick={recordAuxiliary}>Privacy</a>
    <label
      >Language<select onchange={recordAuxiliary}
        ><option>English</option></select
      ></label
    >
  </footer>
</main>
