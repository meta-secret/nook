<script lang="ts">
  import {
    LINKEDIN_MOCK_PASSWORD,
    LINKEDIN_MOCK_USERNAME,
    LinkedInAuthMockScenario,
    LinkedInAuthTransitionKind,
  } from '../lib/linkedin-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'linkedin-submission-evidence'
  let username = $state('')
  let password = $state('')
  let hiddenUsername = $state('')
  let hiddenPassword = $state('')
  let keepSignedInChecked = $state(true)
  let signInActivationCount = $state(0)
  let alternativeActivationCount = $state(0)
  let error = $state('')

  function recordAlternative(event: Event): void {
    event.preventDefault()
    alternativeActivationCount += 1
  }

  function activateSignIn(): void {
    signInActivationCount += 1
    const completed =
      LinkedInAuthMockScenario.transition({
        username,
        password,
        hiddenUsername,
        hiddenPassword,
        signInActivationCount,
        alternativeActivationCount,
        keepSignedInChecked,
      }) === LinkedInAuthTransitionKind.Completed
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        visibleCredentialsMatched:
          username === LINKEDIN_MOCK_USERNAME &&
          password === LINKEDIN_MOCK_PASSWORD,
        hiddenDuplicateUntouched:
          hiddenUsername === '' && hiddenPassword === '',
        signInActivated: signInActivationCount === 1,
        alternativesUntouched: alternativeActivationCount === 0,
        keepSignedInUnchanged: keepSignedInChecked,
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
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">linkedin-combined</p>
  {#if error}<p role="alert">{error}</p>{/if}
  <section data-testid="linkedin-active-surface">
    <label
      >Email or phone<input
        type="email"
        autocomplete="username"
        bind:value={username}
      /></label
    >
    <label
      >Password<input
        type="password"
        autocomplete="current-password"
        bind:value={password}
      /></label
    >
    <button type="button" onclick={recordAlternative}>Show password</button>
    <label
      ><input type="checkbox" bind:checked={keepSignedInChecked} />Keep me
      signed in</label
    >
    <a href="/checkpoint/rp/request-password-reset" onclick={recordAlternative}
      >Forgot password?</a
    >
    <button
      type="button"
      data-testid="linkedin-sign-in"
      onclick={activateSignIn}>Sign in</button
    >
  </section>

  <button type="button" onclick={recordAlternative}>Sign in with Apple</button>
  <a href="/signup" onclick={recordAlternative}>Join now</a>
  <nav aria-label="Legal and help">
    <a href="/legal/user-agreement" onclick={recordAlternative}
      >User Agreement</a
    >
    <a href="/legal/privacy-policy" onclick={recordAlternative}
      >Privacy Policy</a
    >
    <a href="/legal/cookie-policy" onclick={recordAlternative}>Cookie Policy</a>
    <a href="/help" onclick={recordAlternative}>Help Center</a>
  </nav>
  <label
    >Language<select onchange={recordAlternative}
      ><option>English</option></select
    ></label
  >

  <section data-testid="linkedin-responsive-duplicate" hidden>
    <label
      >Email or phone<input
        type="email"
        autocomplete="username"
        bind:value={hiddenUsername}
      /></label
    >
    <label
      >Password<input
        type="password"
        autocomplete="current-password"
        bind:value={hiddenPassword}
      /></label
    >
    <button type="button">Sign in</button>
  </section>
</main>
