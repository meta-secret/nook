<script lang="ts">
  import {
    BookingAuthInteractionState,
    BookingAuthMockScenario,
    BookingAuthPresentationState,
    BookingAuthPrimaryActivationState,
    BookingAuthTransitionKind,
  } from '../lib/booking-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'booking-submission-evidence'

  let email = $state('')
  let primaryActivation = $state(BookingAuthPrimaryActivationState.Untouched)
  let googleInteraction = $state(BookingAuthInteractionState.Untouched)
  let appleInteraction = $state(BookingAuthInteractionState.Untouched)
  let facebookInteraction = $state(BookingAuthInteractionState.Untouched)
  let recoveryInteraction = $state(BookingAuthInteractionState.Untouched)
  let brandInteraction = $state(BookingAuthInteractionState.Untouched)
  let disclosureInteraction = $state(BookingAuthInteractionState.Untouched)
  let helpInteraction = $state(BookingAuthInteractionState.Untouched)
  let languageInteraction = $state(BookingAuthInteractionState.Untouched)
  let presentationState = $state(BookingAuthPresentationState.Ready)

  function recordGoogle(event: MouseEvent): void {
    event.preventDefault()
    googleInteraction = BookingAuthInteractionState.Activated
  }

  function recordApple(event: MouseEvent): void {
    event.preventDefault()
    appleInteraction = BookingAuthInteractionState.Activated
  }

  function recordFacebook(event: MouseEvent): void {
    event.preventDefault()
    facebookInteraction = BookingAuthInteractionState.Activated
  }

  function recordRecovery(event: MouseEvent): void {
    event.preventDefault()
    recoveryInteraction = BookingAuthInteractionState.Activated
  }

  function recordBrand(event: MouseEvent): void {
    event.preventDefault()
    brandInteraction = BookingAuthInteractionState.Activated
  }

  function recordDisclosure(event: MouseEvent): void {
    event.preventDefault()
    disclosureInteraction = BookingAuthInteractionState.Activated
  }

  function recordHelp(event: MouseEvent): void {
    event.preventDefault()
    helpInteraction = BookingAuthInteractionState.Activated
  }

  function recordLanguage(): void {
    languageInteraction = BookingAuthInteractionState.Activated
  }

  function activateEmail(event: SubmitEvent): void {
    event.preventDefault()
    const control = event.submitter
    if (!(control instanceof HTMLButtonElement)) return
    primaryActivation =
      BookingAuthMockScenario.nextPrimaryActivation(primaryActivation)
    const submittedControl = BookingAuthMockScenario.submittedControl(
      control.innerText,
    )
    const transition = BookingAuthMockScenario.transition({
      email,
      submittedControl,
      primaryActivation,
      googleInteraction,
      appleInteraction,
      facebookInteraction,
      recoveryInteraction,
      brandInteraction,
      disclosureInteraction,
      helpInteraction,
      languageInteraction,
    })
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        emailMatch: BookingAuthMockScenario.emailMatch(email),
        primaryActivation,
        googleInteraction,
        appleInteraction,
        facebookInteraction,
        recoveryInteraction,
        brandInteraction,
        disclosureInteraction,
        helpInteraction,
        languageInteraction,
      }),
    )
    if (transition === BookingAuthTransitionKind.Rejected) {
      presentationState = BookingAuthPresentationState.Rejected
      return
    }
    navigate('/plain/success')
  }
</script>

<svelte:head
  ><title>Sign in or create an account | Booking.com</title></svelte:head
>

<header>
  <a href="/" onclick={recordBrand}>Booking.com</a>
  <button aria-label="Select your language" onclick={recordLanguage}
    >English</button
  >
  <a href="/help" aria-label="Help and support" onclick={recordHelp}>Help</a>
</header>
<main>
  <h1>Sign in or create an account</h1>
  <p>You can sign in using your Booking.com account to access our services.</p>
  <p data-testid="mock-auth-scenario">booking-email-first</p>
  {#if presentationState === BookingAuthPresentationState.Rejected}
    <p role="alert">Authentication was not completed.</p>
  {/if}

  <form data-testid="booking-auth-form" onsubmit={activateEmail}>
    <section data-testid="booking-email-surface">
      <label
        >Email address<input
          type="email"
          name="username"
          autocomplete="username webauthn"
          aria-label="Email address"
          placeholder="Enter your email address"
          bind:value={email}
        /></label
      >
      <button type="submit">Continue with email</button>
    </section>

    <p>or use one of these options</p>
    <nav aria-label="Alternative sign-in options">
      <a href="/social/consent/google" onclick={recordGoogle}
        >Sign in with Google</a
      >
      <a href="/social/consent/apple" onclick={recordApple}
        >Sign in with Apple</a
      >
      <a href="/social/consent/facebook" onclick={recordFacebook}
        >Sign in with Facebook</a
      >
    </nav>
    <p>
      Lost access to your email?
      <a href="/recover" onclick={recordRecovery}>Recover your account</a>
    </p>
  </form>
  <p data-testid="booking-disclosure">
    By signing in or creating an account, you agree with our
    <a href="/terms" onclick={recordDisclosure}>Terms & Conditions</a> and
    <a href="/privacy" onclick={recordDisclosure}>Privacy Statement</a>.
  </p>
</main>
