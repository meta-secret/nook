<script lang="ts">
  import {
    DetectionFixtureRenderKind,
    type DetectionFixtureRenderState,
  } from '../lib/detection-fixture-state'
  import { completePlainLogin, PlainLoginResult } from '../lib/plain-login'
  import {
    getSiteFixture,
    getTemplateFixture,
    SiteFixtureLookupKind,
    type SiteFixtureField,
  } from '../lib/site-fixtures'

  let {
    siteId,
    templateId,
  }: {
    siteId?: string
    templateId?: string
  } = $props()

  let stepIndex = $state(0)
  let error = $state('')

  const renderState: DetectionFixtureRenderState = $derived.by(() => {
    const selectedFixture = templateId
      ? getTemplateFixture(templateId)
      : siteId
        ? getSiteFixture(siteId)
        : { kind: SiteFixtureLookupKind.Missing }
    if (selectedFixture.kind === SiteFixtureLookupKind.Missing) {
      return { kind: DetectionFixtureRenderKind.Missing }
    }
    const selectedStep = selectedFixture.fixture.steps.find(
      (_candidate, index) => index === stepIndex,
    )
    return selectedStep
      ? {
          kind: DetectionFixtureRenderKind.Ready,
          fixture: selectedFixture.fixture,
          step: selectedStep,
        }
      : { kind: DetectionFixtureRenderKind.Missing }
  })
  const label = $derived(templateId ?? siteId ?? 'unknown')
  const wrapAriaHidden = $derived(
    renderState.kind === DetectionFixtureRenderKind.Ready &&
      renderState.fixture.quirks.includes('aria-hidden-ancestor'),
  )

  function fieldSelector(field: SiteFixtureField): string {
    if (field.id) return `#${CSS.escape(field.id)}`
    if (field.name) return `[name="${CSS.escape(field.name)}"]`
    if (field['data-qa']) return `[data-qa="${CSS.escape(field['data-qa'])}"]`
    if (field['data-testid']) {
      return `[data-testid="${CSS.escape(field['data-testid'])}"]`
    }
    return 'input'
  }

  function readUsername(form: HTMLFormElement): string {
    if (renderState.kind === DetectionFixtureRenderKind.Missing) return ''
    const identity = renderState.step.fields.find(
      (field) => field.type !== 'password',
    )
    if (!identity) return ''
    return (
      form.querySelector<HTMLInputElement>(fieldSelector(identity))?.value ?? ''
    )
  }

  function readPassword(form: HTMLFormElement): string {
    if (renderState.kind === DetectionFixtureRenderKind.Missing) return ''
    const password = renderState.step.fields.find(
      (field) => field.type === 'password',
    )
    if (!password) return ''
    return (
      form.querySelector<HTMLInputElement>(fieldSelector(password))?.value ?? ''
    )
  }

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    if (renderState.kind === DetectionFixtureRenderKind.Missing) return
    const { fixture, step } = renderState
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const hasPassword = step.fields.some((field) => field.type === 'password')
    if (!hasPassword && stepIndex < fixture.steps.length - 1) {
      stepIndex += 1
      error = ''
      return
    }
    if (!hasPassword) {
      error = 'Password step required for fixture login.'
      return
    }
    const username = readUsername(form)
    const password = readPassword(form)
    if (completePlainLogin(username, password) === PlainLoginResult.Invalid) {
      error = 'Invalid username or password.'
    }
  }

  function onButtonAdvance() {
    if (renderState.kind === DetectionFixtureRenderKind.Missing) return
    const { fixture } = renderState
    if (stepIndex < fixture.steps.length - 1) {
      stepIndex += 1
      error = ''
    }
  }
</script>

{#if renderState.kind === DetectionFixtureRenderKind.Missing}
  <main>
    <h1>Unknown site fixture</h1>
    <p data-testid="mock-auth-scenario">missing-fixture</p>
    <p class="error" role="alert">No fixture for {label}</p>
  </main>
{:else if wrapAriaHidden}
  {@const fixture = renderState.fixture}
  {@const step = renderState.step}
  <div aria-hidden="true">
    <main>
      <h1>{label}</h1>
      <p data-testid="mock-auth-scenario">{label}-login</p>
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}
      <form id="login_form" {onsubmit}>
        {#each step.fields as field (field.id ?? field.name ?? field.placeholder)}
          <input
            type={field.type ?? 'text'}
            name={field.name}
            id={field.id}
            autocomplete={field.autocomplete}
            placeholder={field.placeholder}
            aria-label={field['aria-label']}
            data-qa={field['data-qa']}
            data-testid={field['data-testid']}
          />
        {/each}
        {#if step.submit.type === 'button'}
          <button
            type="button"
            name={step.submit.name}
            id={step.submit.id}
            data-qa={step.submit['data-qa']}
            onclick={onButtonAdvance}
          >
            {step.submit.label}
          </button>
        {:else}
          <button
            type="submit"
            name={step.submit.name}
            id={step.submit.id}
            data-qa={step.submit['data-qa']}
          >
            {step.submit.label}
          </button>
        {/if}
      </form>
    </main>
  </div>
{:else}
  {@const fixture = renderState.fixture}
  {@const step = renderState.step}
  <main>
    <h1>{label}</h1>
    <p data-testid="mock-auth-scenario">{label}-login</p>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    <form id="login_form" {onsubmit}>
      {#each step.fields as field (field.id ?? field.name ?? field.placeholder)}
        <input
          type={field.type ?? 'text'}
          name={field.name}
          id={field.id}
          autocomplete={field.autocomplete}
          placeholder={field.placeholder}
          aria-label={field['aria-label']}
          data-qa={field['data-qa']}
          data-testid={field['data-testid']}
        />
      {/each}
      {#if step.submit.type === 'button'}
        <button
          type="button"
          name={step.submit.name}
          id={step.submit.id}
          data-qa={step.submit['data-qa']}
          onclick={onButtonAdvance}
        >
          {step.submit.label}
        </button>
      {:else}
        <button
          type="submit"
          name={step.submit.name}
          id={step.submit.id}
          data-qa={step.submit['data-qa']}
        >
          {step.submit.label}
        </button>
      {/if}
    </form>
  </main>
{/if}
