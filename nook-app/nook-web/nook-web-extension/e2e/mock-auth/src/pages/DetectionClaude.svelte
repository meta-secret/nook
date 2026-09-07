<script lang="ts">
  import {
    ClaudeAuthControl,
    ClaudeAuthInteractionState,
    ClaudeAuthMockScenario,
    ClaudeAuthPresentationState,
    ClaudeAuthTransitionKind,
  } from '../lib/claude-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'claude-submission-evidence'

  let email = $state('')
  let googleInteraction = $state(ClaudeAuthInteractionState.Untouched)
  let ssoInteraction = $state(ClaudeAuthInteractionState.Untouched)
  let disclosureInteraction = $state(ClaudeAuthInteractionState.Untouched)
  let marketingInteraction = $state(ClaudeAuthInteractionState.Untouched)
  let presentationState = $state(ClaudeAuthPresentationState.Ready)

  function recordGoogle(event: Event): void {
    event.preventDefault()
    googleInteraction = ClaudeAuthInteractionState.Activated
  }

  function recordSso(event: Event): void {
    event.preventDefault()
    ssoInteraction = ClaudeAuthInteractionState.Activated
  }

  function recordDisclosure(event: Event): void {
    event.preventDefault()
    disclosureInteraction = ClaudeAuthInteractionState.Activated
  }

  function recordMarketing(event: Event): void {
    event.preventDefault()
    marketingInteraction = ClaudeAuthInteractionState.Activated
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const submittedControl =
      event.submitter instanceof HTMLButtonElement
        ? ClaudeAuthMockScenario.submittedControl(event.submitter.innerText)
        : ClaudeAuthControl.Unrecognized
    const formMethod = ClaudeAuthMockScenario.formMethod(form)
    const formAction = ClaudeAuthMockScenario.formAction(form)
    const transition = ClaudeAuthMockScenario.transition({
      email,
      submittedControl,
      formMethod,
      formAction,
      googleInteraction,
      ssoInteraction,
      disclosureInteraction,
      marketingInteraction,
    })
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        emailMatch: ClaudeAuthMockScenario.emailMatch(email),
        formMethod,
        formAction,
        googleInteraction,
        ssoInteraction,
        disclosureInteraction,
        marketingInteraction,
      }),
    )
    if (transition === ClaudeAuthTransitionKind.Rejected) {
      presentationState = ClaudeAuthPresentationState.Rejected
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
  {#if presentationState === ClaudeAuthPresentationState.Rejected}
    <p role="alert">Authentication was not completed.</p>
  {/if}

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
