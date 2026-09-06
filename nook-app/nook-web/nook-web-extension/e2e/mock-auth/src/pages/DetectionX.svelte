<script lang="ts">
  import {
    XAuthMockScenario,
    XAuthMockTransitionKind,
  } from '../lib/x-auth-flow'
  import { navigate } from '../lib/navigation'

  const SUBMISSION_EVIDENCE_KEY = 'x-submission-evidence'

  let activeForm: HTMLFormElement
  let username = $state('')
  let hiddenPassword = $state('')
  let alternativeActivationCount = $state(0)
  let continueActivationCount = $state(0)
  let error = $state('')

  function activateAlternative(): void {
    alternativeActivationCount += 1
  }

  function activateContinue(): void {
    continueActivationCount += 1
    activeForm.requestSubmit()
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const transition = XAuthMockScenario.transition({
      username,
      hiddenPassword,
      alternativeActivationCount,
      continueActivationCount,
      submitterPresent: Boolean(event.submitter),
    })
    const completed = transition === XAuthMockTransitionKind.Completed
    sessionStorage.setItem(
      SUBMISSION_EVIDENCE_KEY,
      JSON.stringify({
        credentialsMatched: completed,
        hiddenPasswordUntouched: hiddenPassword === '',
        alternativesUntouched: alternativeActivationCount === 0,
        nonSemanticContinueUntouched: continueActivationCount === 0,
        implicitFormSubmission: !event.submitter,
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
  <h1>Sign in to X</h1>
  <p data-testid="mock-auth-scenario">x-identifier</p>
  {#if error}<p role="alert">{error}</p>{/if}

  <section data-testid="x-responsive-copy" style="display: none">
    <form>
      <label>
        Email or username
        <input
          name="username_or_email"
          type="text"
          autocomplete="username webauthn"
        />
      </label>
      <div><input name="password" type="password" /></div>
      <div>Continue</div>
    </form>
  </section>

  <form bind:this={activeForm} data-testid="x-active-form" onsubmit={submit}>
    <iframe
      title="Continue with Google"
      sandbox=""
      srcdoc="<button type='button'>Continue with Google</button>"
    ></iframe>
    <button type="button" onclick={activateAlternative}
      >Continue with Apple</button
    >
    <button type="button" onclick={activateAlternative}
      >Continue with phone</button
    >
    <label for="x-username">Email or username</label>
    <input
      id="x-username"
      name="username_or_email"
      type="text"
      autocomplete="username webauthn"
      bind:value={username}
    />
    <div data-testid="x-hidden-password" style="display: none">
      <input name="password" type="password" bind:value={hiddenPassword} />
    </div>
    <div data-testid="x-continue" onclick={activateContinue}>Continue</div>
  </form>
</main>
