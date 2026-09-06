<script lang="ts">
  import {
    APPLE_AUTH_MOCK_PASSWORD,
    APPLE_AUTH_MOCK_USERNAME,
    AppleAuthMockScenario,
    AppleAuthMockStep,
    AppleAuthMockTransitionKind,
    type AppleAuthMockState,
  } from '../lib/apple-auth-flow'
  import { navigate } from '../lib/navigation'

  let flowState: AppleAuthMockState = $state(
    AppleAuthMockScenario.initialState(),
  )
  let identifier = $state('')
  let password = $state('')
  let decoyPassword = $state('')
  let error = $state('')
  let identifierContinueSubmitted = $state(false)

  const submissionEvidenceKey = 'apple-submission-evidence'

  function submit(submitter: string): void {
    const submission: Parameters<typeof AppleAuthMockScenario.transition>[0] = {
      state: flowState,
      submitter,
      identifier,
      password,
      decoyPassword,
    }
    const transition = AppleAuthMockScenario.transition(submission)
    if (transition.kind === AppleAuthMockTransitionKind.Rejected) {
      error = 'Authentication was not completed.'
      return
    }
    error = ''
    flowState = transition.state
    if (transition.kind === AppleAuthMockTransitionKind.Advanced) {
      identifierContinueSubmitted = submitter === 'continue'
    }
    if (transition.kind === AppleAuthMockTransitionKind.Completed) {
      sessionStorage.setItem(
        submissionEvidenceKey,
        JSON.stringify({
          identifierContinueSubmitted,
          passwordSignInSubmitted: submitter === 'sign-in',
          loginCredentialsMatched:
            identifier === APPLE_AUTH_MOCK_USERNAME &&
            password === APPLE_AUTH_MOCK_PASSWORD,
          decoyPasswordUnchanged: decoyPassword === '',
        }),
      )
      navigate('/plain/success')
    }
  }

  function submitterIdentity(event: SubmitEvent): string {
    const { submitter } = event
    return submitter instanceof HTMLElement ? submitter.id : ''
  }

  function submitIdentifier(event: SubmitEvent): void {
    event.preventDefault()
    submit(submitterIdentity(event))
  }

  function submitPassword(event: SubmitEvent): void {
    event.preventDefault()
    submit(submitterIdentity(event))
  }
</script>

<main>
  <h1>Sign in to Apple Account</h1>
  <p data-testid="mock-auth-scenario">apple-staged-login</p>
  <p data-testid="apple-auth-step">{flowState.step}</p>
  {#if error}
    <p role="alert">{error}</p>
  {/if}

  {#if flowState.step === AppleAuthMockStep.Identifier}
    <form
      id="sign-in-form"
      method="post"
      action="/appleauth/auth/authorize/signin"
      onsubmit={submitIdentifier}
    >
      <fieldset aria-label="Sign in to Apple Account">
        <label for="account_name_text_field">Email or Phone Number</label>
        <input
          id="account_name_text_field"
          name="accountName"
          type="text"
          autocomplete="username webauthn"
          aria-label="Email or Phone Number"
          bind:value={identifier}
        />
        <input
          name="decoyPassword"
          type="password"
          tabindex="-1"
          aria-hidden="true"
          hidden
          bind:value={decoyPassword}
        />
        <button type="button" onclick={() => submit('passkey')}
          >Sign in with Passkey</button
        >
        <button id="continue" type="submit" disabled={identifier === ''}
          >Continue</button
        >
      </fieldset>
    </form>
  {:else}
    <form
      id="sign-in-form"
      method="post"
      action="/appleauth/auth/authorize/signin"
      onsubmit={submitPassword}
    >
      <fieldset aria-label="Sign in to Apple Account">
        <label for="account_name_text_field">Email or Phone Number</label>
        <input
          id="account_name_text_field"
          name="accountName"
          type="text"
          autocomplete="username webauthn"
          aria-label="Email or Phone Number"
          bind:value={identifier}
        />
        <label for="password_text_field">Password</label>
        <input
          id="password_text_field"
          name="password"
          type="password"
          autocomplete="current-password"
          aria-label="Password"
          bind:value={password}
        />
        <input
          name="decoyPassword"
          type="password"
          tabindex="-1"
          aria-hidden="true"
          hidden
          bind:value={decoyPassword}
        />
        <button type="button" onclick={() => submit('passkey')}
          >Sign in with Passkey</button
        >
        <button id="sign-in" type="submit">Sign In</button>
      </fieldset>
    </form>
  {/if}
</main>
