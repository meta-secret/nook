<script lang="ts">
  import {
    AMAZON_METADATA_IDENTITY,
    AMAZON_MOCK_EMAIL,
    AmazonAuthMockScenario,
    AmazonAuthTransitionKind,
  } from '../lib/amazon-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'amazon-submission-evidence'
  let email = $state('')
  let hiddenPassword = $state('')
  let backdetectSubmissionCount = $state(0)
  let alternativeActivationCount = $state(0)
  let error = $state('')

  function recordBackdetect(event: SubmitEvent): void {
    event.preventDefault()
    backdetectSubmissionCount += 1
  }

  function recordAlternative(event: MouseEvent): void {
    event.preventDefault()
    alternativeActivationCount += 1
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const submittedControl =
      event.submitter instanceof HTMLButtonElement
        ? ((value) => (value ? value.trim() : ''))(event.submitter.textContent)
        : ''
    const metadataIdentity = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    )
      .map((field) => `${field.name}=${field.value}`)
      .join('|')
    const completed =
      AmazonAuthMockScenario.transition({
        email,
        hiddenPassword,
        submittedControl,
        metadataIdentity,
        backdetectSubmissionCount,
        alternativeActivationCount,
      }) === AmazonAuthTransitionKind.Completed
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        emailMatched: email === AMAZON_MOCK_EMAIL,
        hiddenPasswordUntouched: hiddenPassword === '',
        metadataUntouched: metadataIdentity === AMAZON_METADATA_IDENTITY,
        backdetectFormsUntouched: backdetectSubmissionCount === 0,
        alternativesUntouched: alternativeActivationCount === 0,
      }),
    )
    if (!completed) {
      error = 'Authentication was not completed.'
      return
    }
    navigate('/plain/success')
  }
</script>

<form name="ue_backdetect" action="get" onsubmit={recordBackdetect}></form>
<form name="ue_backdetect" action="get" onsubmit={recordBackdetect}></form>

<main>
  <h1>Sign in or create account</h1>
  <p data-testid="mock-auth-scenario">amazon-identifier</p>
  {#if error}<p role="alert">{error}</p>{/if}
  <form
    id="ap_login_form"
    name="signIn"
    method="post"
    action="/ax/claim"
    onsubmit={submit}
  >
    <input type="hidden" name="appAction" value="SIGNIN_PWD_COLLECT" />
    <input type="hidden" name="openid.mode" value="checkid_setup" />
    <label for="ap_email_login">Enter mobile number or email</label>
    <input
      id="ap_email_login"
      name="email"
      type="email"
      autocomplete="webauthn"
      aria-label="Enter mobile number or email"
      bind:value={email}
    />
    <input
      id="auth-credential-autofill-hint"
      class="a-input-text aok-hidden"
      name="password"
      type="password"
      style="display: none; visibility: hidden"
      bind:value={hiddenPassword}
    />
    <button type="submit">Continue</button>
  </form>
  <a href="/business/register" onclick={recordAlternative}
    >Create a free business account</a
  >
  <footer>
    <a href="/help" onclick={recordAlternative}>Help</a>
    <a href="/conditions" onclick={recordAlternative}>Conditions of Use</a>
    <a href="/privacy" onclick={recordAlternative}>Privacy Notice</a>
  </footer>
</main>
