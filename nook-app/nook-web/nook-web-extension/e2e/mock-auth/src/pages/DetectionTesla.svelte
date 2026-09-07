<script lang="ts">
  import {
    TeslaAuthInteractionState,
    TeslaAuthMockScenario,
    TeslaAuthPresentationState,
    TeslaAuthPrimaryActivationState,
    TeslaAuthTransitionKind,
  } from '../lib/tesla-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'tesla-submission-evidence'

  let email = $state('')
  let primaryActivation = $state(TeslaAuthPrimaryActivationState.Untouched)
  let troubleInteraction = $state(TeslaAuthInteractionState.Untouched)
  let createAccountInteraction = $state(TeslaAuthInteractionState.Untouched)
  let languageInteraction = $state(TeslaAuthInteractionState.Untouched)
  let homeInteraction = $state(TeslaAuthInteractionState.Untouched)
  let privacyInteraction = $state(TeslaAuthInteractionState.Untouched)
  let contactInteraction = $state(TeslaAuthInteractionState.Untouched)
  let presentationState = $state(TeslaAuthPresentationState.Ready)

  function recordTrouble(event: MouseEvent): void {
    event.preventDefault()
    troubleInteraction = TeslaAuthInteractionState.Activated
  }

  function recordCreateAccount(): void {
    createAccountInteraction = TeslaAuthInteractionState.Activated
  }

  function recordLanguage(): void {
    languageInteraction = TeslaAuthInteractionState.Activated
  }

  function recordHome(event: MouseEvent): void {
    event.preventDefault()
    homeInteraction = TeslaAuthInteractionState.Activated
  }

  function recordPrivacy(event: MouseEvent): void {
    event.preventDefault()
    privacyInteraction = TeslaAuthInteractionState.Activated
  }

  function recordContact(event: MouseEvent): void {
    event.preventDefault()
    contactInteraction = TeslaAuthInteractionState.Activated
  }

  function activateNext(event: SubmitEvent): void {
    event.preventDefault()
    const control = event.submitter
    if (!(control instanceof HTMLButtonElement)) return
    primaryActivation =
      TeslaAuthMockScenario.nextPrimaryActivation(primaryActivation)
    const submittedControl = TeslaAuthMockScenario.submittedControl(
      control.innerText,
    )
    const transition = TeslaAuthMockScenario.transition({
      email,
      submittedControl,
      primaryActivation,
      troubleInteraction,
      createAccountInteraction,
      languageInteraction,
      homeInteraction,
      privacyInteraction,
      contactInteraction,
    })
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        emailMatch: TeslaAuthMockScenario.emailMatch(email),
        primaryActivation,
        troubleInteraction,
        createAccountInteraction,
        languageInteraction,
        homeInteraction,
        privacyInteraction,
        contactInteraction,
      }),
    )
    if (transition === TeslaAuthTransitionKind.Rejected) {
      presentationState = TeslaAuthPresentationState.Rejected
      return
    }
    navigate('/plain/success')
  }
</script>

<svelte:head><title>Tesla Auth - Sign In</title></svelte:head>

<header>
  <a href="https://www.tesla.com/" aria-label="Tesla home" onclick={recordHome}
    >Tesla</a
  >
</header>
<main>
  <h1>Sign In</h1>
  <p data-testid="mock-auth-scenario">tesla-email-first</p>
  {#if presentationState === TeslaAuthPresentationState.Rejected}
    <p role="alert">Authentication was not completed.</p>
  {/if}

  <form data-testid="tesla-auth-form" onsubmit={activateNext}>
    <label
      >Email<input
        name="identity"
        autocomplete="email webauthn"
        aria-label="Email"
        bind:value={email}
      /></label
    >
    <button type="submit" disabled={email.trim().length === 0}>Next</button>
  </form>

  <a href="/forgot" onclick={recordTrouble}>Trouble Signing In?</a>
  <p>Or</p>
  <button type="button" onclick={recordCreateAccount}>Create Account</button>
  <button type="button" onclick={recordLanguage}>Select Language</button>
</main>
<footer>
  <a href="/privacy" onclick={recordPrivacy}>Privacy</a>
  <a href="/contact" onclick={recordContact}>Contact</a>
</footer>
