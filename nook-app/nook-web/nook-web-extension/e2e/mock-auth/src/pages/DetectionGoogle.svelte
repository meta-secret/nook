<script lang="ts">
  import {
    GoogleAuthMockScenario,
    GoogleAuthMockStep,
    GoogleAuthMockTransitionKind,
    type GoogleAuthMockState,
  } from '../lib/google-auth-flow'
  import { navigate, softNavigate } from '../lib/navigation'

  let flowState: GoogleAuthMockState = $state(
    GoogleAuthMockScenario.initialState(),
  )
  let identifier = $state('')
  let password = $state('')
  let hiddenPassword = $state('')
  let error = $state('')

  function submit(submitter: string): void {
    const transition = GoogleAuthMockScenario.transition({
      state: flowState,
      submitter,
      identifier,
      password,
      hiddenPassword,
    })
    if (transition.kind === GoogleAuthMockTransitionKind.Rejected) {
      error = 'Authentication was not completed.'
      return
    }
    error = ''
    flowState = transition.state
    if (transition.kind === GoogleAuthMockTransitionKind.Advanced) {
      softNavigate('/v3/signin/challenge/pwd')
      return
    }
    if (transition.kind === GoogleAuthMockTransitionKind.Completed) {
      navigate('/plain/success')
    }
  }

  function submitPassword(event: SubmitEvent): void {
    event.preventDefault()
    submit('password-next')
  }
</script>

<main>
  <h1>Sign in</h1>
  <p>Use your Google Account</p>
  <p data-testid="mock-auth-scenario">google-identifier-first</p>
  <p data-testid="google-auth-step">{flowState.step}</p>
  {#if error}
    <p role="alert">{error}</p>
  {/if}

  {#if flowState.step === GoogleAuthMockStep.Identifier}
    <label for="identifierId">Email or phone</label>
    <input
      id="identifierId"
      name="identifier"
      type="text"
      autocomplete="username webauthn"
      aria-label="Email or phone"
      spellcheck="false"
      autocapitalize="none"
      bind:value={identifier}
    />
    <input
      name="hiddenPassword"
      type="password"
      tabindex="-1"
      aria-hidden="true"
      spellcheck="false"
      hidden
      bind:value={hiddenPassword}
    />
    <button type="button">Create account</button>
    <div id="identifierNext">
      <button type="button" onclick={() => submit('identifier-next')}
        >Next</button
      >
    </div>
  {:else}
    <p data-testid="google-selected-account">{flowState.identifier}</p>
    <form
      id="login_form"
      method="post"
      action="/auth/login"
      onsubmit={submitPassword}
    >
      <label for="identifierId">Email or phone</label>
      <input
        id="identifierId"
        name="identifier"
        type="email"
        autocomplete="username"
        placeholder="Email or phone"
        aria-label="Email or phone"
        bind:value={identifier}
      />
      <label for="password-input">Enter your password</label>
      <input
        id="password-input"
        name="Passwd"
        type="password"
        autocomplete="current-password"
        aria-label="Enter your password"
        bind:value={password}
      />
      <div id="passwordNext">
        <button type="submit">Next</button>
      </div>
    </form>
  {/if}
</main>
