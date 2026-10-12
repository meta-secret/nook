<script lang="ts">
  import {
    AMAZON_METADATA_IDENTITY,
    AMAZON_MOCK_EMAIL,
    AmazonAuthMockScenario,
    AmazonAuthTransitionKind,
  } from '../lib/amazon-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'amazon-submission-evidence'
  const AMAZON_AUTOCOMPLETE = 'webauthn'
  let email = $state('')
  let hiddenPassword = $state('')
  let backdetectSubmissionCount = $state(0)
  let alternativeActivationCount = $state(0)
  let error = $state('')

  function submittedControlLabel(submitter: HTMLElement): string {
    const labelledBy = submitter.getAttribute('aria-labelledby') || ''
    return labelledBy
      .split(/\s+/u)
      .filter(Boolean)
      .flatMap((id) => {
        const label = submitter.ownerDocument.getElementById(id)
        return label ? [label.textContent || ''] : []
      })
      .join(' ')
      .trim()
  }

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
      event.submitter instanceof HTMLElement
        ? submittedControlLabel(event.submitter)
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

<form name="ue_backdetect" action="get" onsubmit={recordBackdetect}>
  <input type="hidden" name="ue_back" value="2" />
</form>

<main>
  <h1>Sign in or create account</h1>
  <p data-testid="mock-auth-scenario">amazon-identifier</p>
  {#if error}<p role="alert">{error}</p>{/if}
  <form
    id="ap_login_form"
    name="signIn"
    method="post"
    action="/ax/claim?openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&amp;openid.return_to=https%3A%2F%2Fwww.amazon.com%2F%3Fref_%3Dnav_ya_signin&amp;policy_handle=Retail-Checkout&amp;openid.mode=checkid_setup&amp;openid.assoc_handle=usflex&amp;arb=mock-arb"
    onsubmit={submit}
  >
    <input type="hidden" name="appAction" value="SIGNIN_CLAIM_COLLECT" />
    <input
      type="hidden"
      name="subPageType"
      value="FullPageUnifiedClaimCollect"
    />
    <input type="hidden" name="claimCollectionWorkflow" value="unified" />
    <input type="hidden" name="metadata1" value="true" />
    <input type="hidden" name="claimType" value="" />
    <input type="hidden" name="countryCode" value="" />
    <input type="hidden" name="isServerSideRouting" value="true" />
    <input type="hidden" name="emailOnlyClaim" value="false" />
    <input
      type="hidden"
      name="webAuthnGetArbForAutofill"
      value="mock-webauthn-arb"
    />
    <input
      type="hidden"
      name="webAuthnGetParametersForAutofill"
      value="mock-webauthn-parameters"
    />
    <input
      type="hidden"
      name="webAuthnChallengeIdForAutofill"
      value="mock-webauthn-challenge"
    />
    <input
      type="hidden"
      name="openid.ns"
      value="http://specs.openid.net/auth/2.0"
    />
    <input type="hidden" name="openid.mode" value="checkid_setup" />
    <input
      type="hidden"
      name="openid.return_to"
      value="https://www.amazon.com/?ref_=nav_ya_signin"
    />
    <input type="hidden" name="openid.assoc_handle" value="usflex" />
    <input
      type="hidden"
      name="openid.identity"
      value="http://specs.openid.net/auth/2.0/identifier_select"
    />
    <input
      type="hidden"
      name="openid.claimed_id"
      value="http://specs.openid.net/auth/2.0/identifier_select"
    />
    <input
      type="hidden"
      name="signalUnknownCredentialUnifiedAuthWeblabActive"
      value="true"
    />
    <input type="hidden" name="anti-csrftoken-a2z" value="mock-csrf" />
    <label for="ap_email_login">Enter mobile number or email</label>
    <input
      id="ap_email_login"
      name="email"
      type="text"
      autocomplete={AMAZON_AUTOCOMPLETE}
      aria-label="Enter mobile number or email"
      inputmode="email"
      bind:value={email}
    />
    <input
      id="auth-credential-autofill-hint"
      class="a-input-text aok-hidden"
      name="password"
      type="password"
      bind:value={hiddenPassword}
    />
    <span
      id="continue"
      class="a-button a-button-span12 a-button-primary aok-relative"
    >
      <span class="a-button-inner">
        <input
          class="a-button-input"
          type="submit"
          aria-labelledby="continue-announce"
        />
        <span id="continue-announce" class="a-button-text" aria-hidden="true"
          >Continue</span
        >
      </span>
    </span>
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

<style>
  .aok-hidden {
    display: none;
  }

  .a-button {
    display: inline-block;
    position: relative;
  }

  .a-button-input {
    cursor: pointer;
    inset: 0;
    opacity: 0;
    position: absolute;
  }
</style>
