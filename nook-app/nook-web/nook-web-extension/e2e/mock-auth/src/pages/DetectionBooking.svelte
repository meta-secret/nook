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
  let hiddenPassword = $state('')
  let primaryActivation = $state(BookingAuthPrimaryActivationState.Untouched)
  let googleInteraction = $state(BookingAuthInteractionState.Untouched)
  let appleInteraction = $state(BookingAuthInteractionState.Untouched)
  let facebookInteraction = $state(BookingAuthInteractionState.Untouched)
  let recoveryInteraction = $state(BookingAuthInteractionState.Untouched)
  let brandInteraction = $state(BookingAuthInteractionState.Untouched)
  let disclosureInteraction = $state(BookingAuthInteractionState.Untouched)
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
      hiddenPasswordUntouched: hiddenPassword === '',
      submittedControl,
      primaryActivation,
      googleInteraction,
      appleInteraction,
      facebookInteraction,
      recoveryInteraction,
      brandInteraction,
      disclosureInteraction,
      languageInteraction,
    })
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        emailMatch: BookingAuthMockScenario.emailMatch(email),
        hiddenPasswordUntouched: hiddenPassword === '',
        primaryActivation,
        googleInteraction,
        appleInteraction,
        facebookInteraction,
        recoveryInteraction,
        brandInteraction,
        disclosureInteraction,
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
</header>
<main>
  <h1>Sign in or create an account</h1>
  <p>You can sign in using your Booking.com account to access our services.</p>
  <p data-testid="mock-auth-scenario">booking-email-first</p>
  {#if presentationState === BookingAuthPresentationState.Rejected}
    <p role="alert">Authentication was not completed.</p>
  {/if}

  <form
    class="nw-signin"
    novalidate
    data-testid="booking-auth-form"
    onsubmit={activateEmail}
  >
    <div
      class="hidden-password-input-container"
      style="width: 0; height: 0; overflow: hidden"
      data-testid="booking-hidden-password-container"
    >
      <input
        id="hidden-password"
        type="password"
        name="password"
        autocomplete="current-password"
        aria-hidden="true"
        tabindex="-1"
        bind:value={hiddenPassword}
      />
    </div>
    <section data-testid="booking-email-surface">
      <label for="username">Email address</label>
      <input
        id="username"
        type="email"
        name="username"
        autocomplete="username webauthn"
        placeholder="Enter your email address"
        bind:value={email}
      />
      <button type="submit">Continue with email</button>
    </section>

    <p>or use one of these options</p>
    <nav aria-label="Alternative sign-in options">
      <a
        href="/social/consent/google?op_token=fixture&as_token=fixture"
        onclick={recordGoogle}>Sign in with Google</a
      >
      <a
        href="/social/consent/apple?op_token=fixture&as_token=fixture"
        onclick={recordApple}>Sign in with Apple</a
      >
      <a
        href="/social/consent/facebook?op_token=fixture&as_token=fixture"
        onclick={recordFacebook}>Sign in with Facebook</a
      >
    </nav>
    <p>
      Lost access to your email?
      <a href="/sign-in/recovery?op_token=fixture" onclick={recordRecovery}
        >Recover your account</a
      >
    </p>
  </form>
  <p data-testid="booking-disclosure">
    By signing in or creating an account, you agree to our
    <a href="/terms" onclick={recordDisclosure}>Terms and conditions</a> and
    <a href="/privacy" onclick={recordDisclosure}>Privacy notice</a>.
  </p>
</main>
