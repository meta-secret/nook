<script lang="ts">
  import { recordLoginSubmission } from '../lib/navigation'

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const email = new FormData(form).get('email')
    const password = new FormData(form).get('password')
    if (typeof email !== 'string' || typeof password !== 'string') return
    recordLoginSubmission(email, password)
  }
</script>

<main>
  <h1>Sign in</h1>
  <form id="login-form" {onsubmit}>
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
