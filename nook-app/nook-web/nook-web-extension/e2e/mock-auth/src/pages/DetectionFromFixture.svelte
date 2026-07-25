<script lang="ts">
  import { completePlainLogin } from '../lib/plain-login'
  import { getSiteFixture, type SiteFixtureField } from '../lib/site-fixtures'

  let {
    siteId,
  }: {
    siteId: string
  } = $props()

  let stepIndex = $state(0)
  let error = $state('')

  const fixture = $derived(getSiteFixture(siteId))
  const step = $derived(fixture?.steps[stepIndex])
  const wrapAriaHidden = $derived(
    Boolean(fixture?.quirks.includes('aria-hidden-ancestor')),
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
    const current = step
    if (!current) return ''
    const identity = current.fields.find((field) => field.type !== 'password')
    if (!identity) return ''
    return (
      form.querySelector<HTMLInputElement>(fieldSelector(identity))?.value ?? ''
    )
  }

  function readPassword(form: HTMLFormElement): string {
    const current = step
    if (!current) return ''
    const password = current.fields.find((field) => field.type === 'password')
    if (!password) return ''
    return (
      form.querySelector<HTMLInputElement>(fieldSelector(password))?.value ?? ''
    )
  }

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!fixture || !step) return
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
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }

  function onButtonAdvance() {
    if (!fixture) return
    if (stepIndex < fixture.steps.length - 1) {
      stepIndex += 1
      error = ''
    }
  }
</script>

{#if !fixture || !step}
  <main>
    <h1>Unknown site fixture</h1>
    <p data-testid="mock-auth-scenario">missing-fixture</p>
    <p class="error" role="alert">No fixture for {siteId}</p>
  </main>
{:else if wrapAriaHidden}
  <div aria-hidden="true">
    <main>
      <h1>{siteId}</h1>
      <p data-testid="mock-auth-scenario">{siteId}-login</p>
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
  <main>
    <h1>{siteId}</h1>
    <p data-testid="mock-auth-scenario">{siteId}-login</p>
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
