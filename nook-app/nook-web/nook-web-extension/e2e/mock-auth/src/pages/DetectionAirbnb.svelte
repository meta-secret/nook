<script lang="ts">
  import {
    AirbnbAuthInteractionState,
    AirbnbAuthMockScenario,
    AirbnbAuthPresentationState,
    AirbnbAuthTransitionKind,
  } from '../lib/airbnb-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'airbnb-submission-evidence'

  let identity = $state('')
  let primaryActivation = $state(AirbnbAuthInteractionState.Untouched)
  let alternativeActivationCount = $state(0)
  let presentationState = $state(AirbnbAuthPresentationState.Ready)

  function recordAlternative(): void {
    alternativeActivationCount += 1
  }

  function activateContinue(event: SubmitEvent): void {
    event.preventDefault()
    const control = event.submitter
    if (!(control instanceof HTMLButtonElement)) return
    primaryActivation = AirbnbAuthMockScenario.nextActivation(primaryActivation)
    const submittedControl = AirbnbAuthMockScenario.submittedControl(
      control.innerText,
    )
    const transition = AirbnbAuthMockScenario.transition({
      identity,
      submittedControl,
      primaryActivation,
      alternativeActivationCount,
    })
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        submittedControl,
        identityMatch: AirbnbAuthMockScenario.identityMatch(identity),
        primaryActivation,
        alternativeActivationCount,
      }),
    )
    if (transition === AirbnbAuthTransitionKind.Rejected) {
      presentationState = AirbnbAuthPresentationState.Rejected
      return
    }
    navigate('/plain/success')
  }
</script>

<main>
  <p data-testid="mock-auth-scenario">airbnb-identity-first</p>
  {#if presentationState === AirbnbAuthPresentationState.Rejected}
    <p role="alert">Authentication was not completed.</p>
  {/if}
  <form data-testid="airbnb-auth-form" onsubmit={activateContinue}>
    <label
      >Phone number or email<input
        type="text"
        inputmode="email"
        autocomplete="tel-national"
        bind:value={identity}
      /></label
    >
    <button type="submit">Continue</button>
  </form>
  <button
    type="button"
    aria-label="Continue with Google"
    onclick={recordAlternative}
  ></button>
  <button
    type="button"
    aria-label="Continue with Apple"
    onclick={recordAlternative}
  ></button>
</main>
