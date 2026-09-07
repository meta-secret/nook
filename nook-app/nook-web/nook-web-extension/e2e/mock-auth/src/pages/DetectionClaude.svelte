<script lang="ts">
  import {
    CLAUDE_MOCK_EMAIL,
    ClaudeAuthMockScenario,
    ClaudeAuthTransitionKind,
  } from '../lib/claude-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'claude-submission-evidence'
  let email = $state('')
  let googleActivationCount = $state(0)
  let ssoActivationCount = $state(0)
  let disclosureActivationCount = $state(0)
  let marketingActivationCount = $state(0)
  let error = $state('')

  function recordGoogle(event: Event): void {
    event.preventDefault()
    googleActivationCount += 1
  }

  function recordSso(event: Event): void {
    event.preventDefault()
    ssoActivationCount += 1
  }

  function recordDisclosure(event: Event): void {
    event.preventDefault()
    disclosureActivationCount += 1
  }

  function recordMarketing(event: Event): void {
    event.preventDefault()
    marketingActivationCount += 1
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
      ClaudeAuthMockScenario.transition({
        email,
        submittedControl,
        formMethod: form.method,
        formHasAction: form.hasAttribute('action'),
        googleActivationCount,
        ssoActivationCount,
        disclosureActivationCount,
        marketingActivationCount,
      }) === ClaudeAuthTransitionKind.Completed
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        emailMatched: email === CLAUDE_MOCK_EMAIL,
        postWithoutAction:
          form.method === 'post' && !form.hasAttribute('action'),
        googleUntouched: googleActivationCount === 0,
        ssoUntouched: ssoActivationCount === 0,
        disclosureUntouched: disclosureActivationCount === 0,
        marketingUntouched: marketingActivationCount === 0,
      }),
    )
    if (!completed) {
      error = 'Authentication was not completed.'
      return
    }
    navigate('/plain/success')
  }
</script>

<svelte:head><title>Sign in - Claude</title></svelte:head>

<header>
  <nav aria-label="Claude">
    <a href="/" onclick={recordMarketing}>Claude</a>
    <a href="/product" onclick={recordMarketing}>Product</a>
    <a href="/work" onclick={recordMarketing}>For work</a>
  </nav>
</header>
<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">claude-email-first</p>
  {#if error}<p role="alert">{error}</p>{/if}

  <button type="button" onclick={recordGoogle}>Continue with Google</button>
  <p aria-label="Authentication method separator">or</p>
  <form method="post" data-testid="claude-email-form" onsubmit={submit}>
    <label
      >Email<input
        name="email"
        type="email"
        autocomplete="email"
        aria-label="Email"
        bind:value={email}
      /></label
    >
    <button type="submit">Continue with email</button>
  </form>
  <button type="button" onclick={recordSso}>Continue with SSO</button>

  <p data-testid="claude-disclosure">
    By continuing, you acknowledge our
    <a href="/privacy" onclick={recordDisclosure}>privacy policy</a> and product update
    disclosure.
  </p>
</main>
