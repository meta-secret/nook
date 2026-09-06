<script lang="ts">
  import {
    MICROSOFT_CONSUMER_MOCK_USERNAME,
    MicrosoftConsumerAuthMockScenario,
    MicrosoftConsumerAuthTransitionKind,
  } from '../lib/microsoft-consumer-auth-flow'
  import { navigate } from '../lib/navigation'

  const SUBMISSION_EVIDENCE_KEY = 'microsoft-consumer-submission-evidence'

  let username = $state('')
  let closeActivationCount = $state(0)
  let recoveryActivationCount = $state(0)
  let outsideActivationCount = $state(0)
  let unrelatedFormSubmissionCount = $state(0)
  let error = $state('')

  function recordCloseActivation(): void {
    closeActivationCount += 1
  }

  function recordRecoveryActivation(): void {
    recoveryActivationCount += 1
  }

  function recordOutsideActivation(event: MouseEvent): void {
    event.preventDefault()
    outsideActivationCount += 1
  }

  function submitUnrelatedForm(event: SubmitEvent): void {
    event.preventDefault()
    unrelatedFormSubmissionCount += 1
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const submittedControl =
      event.submitter instanceof HTMLButtonElement
        ? ((value) => (value ? value.trim() : ''))(event.submitter.textContent)
        : ''
    const completed =
      MicrosoftConsumerAuthMockScenario.transition({
        username,
        submittedControl,
        closeActivationCount,
        recoveryActivationCount,
        outsideActivationCount,
        unrelatedFormSubmissionCount,
      }) === MicrosoftConsumerAuthTransitionKind.Completed
    sessionStorage.setItem(
      SUBMISSION_EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        usernameMatched: username === MICROSOFT_CONSUMER_MOCK_USERNAME,
        closeUntouched: closeActivationCount === 0,
        recoveryUntouched: recoveryActivationCount === 0,
        signupAndHelpUntouched: outsideActivationCount === 0,
        unrelatedFormUntouched: unrelatedFormSubmissionCount === 0,
      }),
    )
    if (!completed) {
      error = 'Authentication was not completed.'
      return
    }
    navigate('/plain/success')
  }
</script>

<form
  method="post"
  action=""
  data-testid="microsoft-unrelated-empty-form"
  onsubmit={submitUnrelatedForm}
></form>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">microsoft-consumer-identifier</p>
  {#if error}<p role="alert">{error}</p>{/if}

  <form method="post" data-testid="microsoft-consumer-form" onsubmit={submit}>
    <button type="button" aria-label="Close" onclick={recordCloseActivation}
      >Close</button
    >
    <label for="usernameEntry">Email or phone number</label>
    <input
      id="usernameEntry"
      type="email"
      autocomplete="username webauthn"
      bind:value={username}
    />
    <button type="button" onclick={recordRecoveryActivation}
      >Forgot your username?</button
    >
    <button type="submit">Next</button>
  </form>

  <nav aria-label="Microsoft account help">
    <a href="/create-account" onclick={recordOutsideActivation}
      >Create an account</a
    >
    <a href="/help" onclick={recordOutsideActivation}>Help</a>
    <a href="/feedback" onclick={recordOutsideActivation}>Feedback</a>
    <a href="/terms" onclick={recordOutsideActivation}>Terms of use</a>
    <a href="/privacy" onclick={recordOutsideActivation}>Privacy & cookies</a>
  </nav>
  <p>Use a private browsing window if this is not your device.</p>
</main>
