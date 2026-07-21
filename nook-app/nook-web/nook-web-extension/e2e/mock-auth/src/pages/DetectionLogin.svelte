<script lang="ts">
  import { onMount } from 'svelte'
  import { recordLoginSubmission } from '../lib/navigation'

  onMount(() => {
    ;(
      window as Window & {
        __nookLoginSubmitted?: { email: string; password: string } | null
      }
    ).__nookLoginSubmitted = null

    const form = document.getElementById('login-form')
    if (!(form instanceof HTMLFormElement)) return

    const onsubmit = (event: Event) => {
      event.preventDefault()
      const current = event.currentTarget
      if (!(current instanceof HTMLFormElement)) return
      const email =
        current.querySelector<HTMLInputElement>('[name="email"]')?.value
      const password =
        current.querySelector<HTMLInputElement>('[name="password"]')?.value
      if (typeof email !== 'string' || typeof password !== 'string') return
      recordLoginSubmission(email, password)
    }

    form.addEventListener('submit', onsubmit)
    return () => form.removeEventListener('submit', onsubmit)
  })
</script>

<main>
  <h1>Sign in</h1>
  <form id="login-form">
    <label
      >Email <input autocomplete="username" name="email" type="email" /></label
    >
    <label
      >Password <input
        autocomplete="current-password"
        name="password"
        type="password"
      /></label
    >
    <button type="submit">Sign in</button>
  </form>
</main>
