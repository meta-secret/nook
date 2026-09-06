<script lang="ts">
  import {
    OpenAiAuthMockScenario,
    OpenAiAuthMockTransitionKind,
    type ChatGptAuthMockSubmission,
    type OpenAiAuthMockSubmission,
  } from '../lib/openai-auth-flow'
  import { navigate } from '../lib/navigation'

  const SUBMISSION_EVIDENCE_KEY = 'openai-submission-evidence'

  let email = $state('')
  let alternativeActivationCount = $state(0)
  let error = $state('')

  function activateAlternative(event: Event): void {
    event.preventDefault()
    alternativeActivationCount += 1
  }

  function submittedForm(event: SubmitEvent): HTMLFormElement | undefined {
    return [event.currentTarget, event.target].find(
      (candidate): candidate is HTMLFormElement => {
        if (
          !candidate ||
          typeof (candidate as { querySelectorAll?: unknown })
            .querySelectorAll !== 'function'
        ) {
          return false
        }
        return (candidate as { tagName?: unknown }).tagName === 'FORM'
      },
    )
  }

  function submitterIdentity(event: SubmitEvent): string {
    const { submitter } = event
    if (submitter && typeof submitter.getAttribute === 'function') {
      const value = submitter.getAttribute('value')
      if (value) return value
    }

    // The extension mediates a page-world submit event from its isolated
    // world. Some browser versions cannot carry the cross-realm submitter
    // through the synthetic event, so preserve native implicit-submit
    // semantics only when this form has one unambiguous submit control.
    const form = submittedForm(event)
    if (!form) return ''
    const submitControls = Array.from(
      form.querySelectorAll<HTMLButtonElement>(
        'button[type="submit"], button:not([type])',
      ),
    ).filter((control) => !control.hasAttribute('form'))
    return submitControls.length === 1
      ? submitControls[0].getAttribute('value') || ''
      : ''
  }

  function submitChatGpt(event: SubmitEvent): void {
    event.preventDefault()
    const submission: ChatGptAuthMockSubmission = {
      submitter: submitterIdentity(event),
      email,
      alternativeActivationCount,
      authorizationTarget: OpenAiAuthMockScenario.authorizationTarget(
        location.href,
      ),
    }
    const transition = OpenAiAuthMockScenario.submitChatGpt(submission)
    if (transition.kind === OpenAiAuthMockTransitionKind.Rejected) {
      error = 'Authentication was not completed.'
      return
    }
    location.assign(transition.url)
  }

  function submitOpenAi(event: SubmitEvent): void {
    event.preventDefault()
    const submittedControlIdentity = submitterIdentity(event)
    const submission: OpenAiAuthMockSubmission = {
      submitter: submittedControlIdentity,
      email,
      alternativeActivationCount,
    }
    const transition = OpenAiAuthMockScenario.submitOpenAi(submission)
    const completed = transition.kind === OpenAiAuthMockTransitionKind.Completed
    sessionStorage.setItem(
      SUBMISSION_EVIDENCE_KEY,
      JSON.stringify({
        submittedControlIdentity,
        emailMatched: completed,
        phoneUntouched: alternativeActivationCount === 0,
        socialFormUntouched: alternativeActivationCount === 0,
      }),
    )
    if (!completed) {
      error = 'Authentication was not completed.'
      return
    }
    navigate('/plain/success')
  }
</script>

{#if location.pathname === '/auth/login'}
  <main>
    <h1>Log in or sign up</h1>
    <p data-testid="mock-auth-scenario">chatgpt-identifier</p>
    {#if error}<p role="alert">{error}</p>{/if}
    <form method="get" action="/auth/login" onsubmit={submitChatGpt}>
      <button type="button" onclick={activateAlternative}
        >Continue with Google</button
      >
      <button type="button" onclick={activateAlternative}
        >Continue with Apple</button
      >
      <button type="button" onclick={activateAlternative}
        >Continue with phone</button
      >
      <input
        id="email"
        name="email"
        type="email"
        autocomplete="email"
        aria-label="Email address"
        placeholder="Email address"
        bind:value={email}
      />
      <button name="intent" type="submit" value="chatgpt-continue"
        >Continue</button
      >
    </form>
  </main>
{:else}
  <main>
    <h1>Log in or sign up</h1>
    <p data-testid="mock-auth-scenario">openai-identifier</p>
    {#if error}<p role="alert">{error}</p>{/if}
    <form
      id="openai-social-form"
      method="post"
      action="/log-in-or-create-account"
      hidden
      onsubmit={activateAlternative}
    ></form>
    <form
      id="openai-identifier-form"
      method="post"
      action="/log-in-or-create-account"
      onsubmit={submitOpenAi}
    >
      <button
        name="intent"
        type="submit"
        value="google"
        form="openai-social-form">Continue with Google</button
      >
      <button
        name="intent"
        type="submit"
        value="apple"
        form="openai-social-form">Continue with Apple</button
      >
      <button
        name="intent"
        type="submit"
        value="microsoft"
        form="openai-social-form">Continue with Microsoft</button
      >
      <button type="button" onclick={activateAlternative}
        >Continue with phone</button
      >
      <input
        id="email"
        name="email"
        type="email"
        autocomplete="email"
        aria-label="Email address"
        placeholder="Email address"
        bind:value={email}
      />
      <button name="intent" type="submit" value="openai-continue"
        >Continue</button
      >
    </form>
  </main>
{/if}
