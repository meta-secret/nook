<main>
  <form id="signup-form">
    <input
      autocomplete="section-signup username"
      name="signup-email"
      type="email"
    />
    <input
      autocomplete="section-signup new-password"
      name="signup-password"
      type="password"
    />
    <button type="submit">Create account</button>
  </form>
  <form id="login-form">
    <input autocomplete="section-login username" name="email" type="email" />
    <input
      autocomplete="section-login current-password webauthn"
      name="password"
      type="password"
    />
    <button type="submit">Sign in</button>
  </form>
</main>
