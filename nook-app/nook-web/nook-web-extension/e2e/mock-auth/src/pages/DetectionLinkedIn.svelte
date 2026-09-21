<script lang="ts">
  import {
    LINKEDIN_MOCK_PASSWORD,
    LINKEDIN_MOCK_USERNAME,
    LinkedInAuthMockScenario,
    LinkedInAuthTransitionKind,
  } from '../lib/linkedin-auth-flow'
  import { navigate } from '../lib/navigation'

  const EVIDENCE_KEY = 'linkedin-submission-evidence'
  let username = $state('')
  let password = $state('')
  let keepSignedInChecked = $state(true)
  let signInActivationCount = $state(0)
  let hiddenSignInActivationCount = $state(0)
  let alternativeActivationCount = $state(0)
  let error = $state('')

  function recordAlternative(event: Event): void {
    event.preventDefault()
    alternativeActivationCount += 1
  }

  function activateSignIn(): void {
    signInActivationCount += 1
    const completed =
      LinkedInAuthMockScenario.transition({
        username,
        password,
        hiddenUsername: username,
        hiddenPassword: password,
        signInActivationCount,
        hiddenSignInActivationCount,
        alternativeActivationCount,
        keepSignedInChecked,
      }) === LinkedInAuthTransitionKind.Completed
    sessionStorage.setItem(
      EVIDENCE_KEY,
      JSON.stringify({
        visibleCredentialsMatched:
          username === LINKEDIN_MOCK_USERNAME &&
          password === LINKEDIN_MOCK_PASSWORD,
        hiddenCredentialsMirrored:
          username === LINKEDIN_MOCK_USERNAME &&
          password === LINKEDIN_MOCK_PASSWORD,
        signInActivated: signInActivationCount === 1,
        hiddenSignInUntouched: hiddenSignInActivationCount === 0,
        alternativesUntouched: alternativeActivationCount === 0,
        keepSignedInUnchanged: keepSignedInChecked,
      }),
    )
    if (!completed) {
      error = 'Authentication was not completed.'
      return
    }
    navigate('/plain/success')
  }

  function activateHiddenSignIn(): void {
    hiddenSignInActivationCount += 1
  }
</script>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">linkedin-combined</p>
  {#if error}<p role="alert">{error}</p>{/if}
  <section
    class="linkedin-responsive-hidden"
    data-testid="linkedin-responsive-duplicate"
  >
    <button type="button" onclick={recordAlternative}>Sign in with Apple</button
    >
    <div
      class="e5616576 _1957d19a _3ff5f032 _3e0ed175 d73e1ea3 _09ab8b1b _991ffcd1 d1901be7"
    >
      <div class="_649b9f0b d1901be7">
        <div class="_6f6ba678 _1957d19a _3ff5f032 d1901be7">
          <label for="«r1»"><span>Email or phone</span></label>
          <div class="dfaf4f38 d1901be7">
            <input
              id="«r1»"
              type="email"
              autocomplete="username"
              bind:value={username}
            />
          </div>
        </div>
      </div>
      <div class="dcd57938 _1957d19a d1901be7">
        <div class="_6f6ba678 _1957d19a _3ff5f032 d1901be7">
          <label for="«r2»"><span>Password</span></label>
          <div class="dfaf4f38 d1901be7">
            <input
              id="«r2»"
              type="password"
              autocomplete="current-password"
              bind:value={password}
            />
            <div class="c0d882ed dabfd919 _42ca2b07 _6b579e31">
              <button
                type="button"
                aria-label="Show password"
                onclick={recordAlternative}
              ></button>
            </div>
          </div>
        </div>
      </div>
      <a
        href="/checkpoint/rp/request-password-reset"
        onclick={recordAlternative}>Forgot password?</a
      >
      <label for="linkedin-hidden-keep-signed-in">Keep me signed in</label>
      <input
        id="linkedin-hidden-keep-signed-in"
        type="checkbox"
        tabindex="-1"
        bind:checked={keepSignedInChecked}
      />
      <button type="button" onclick={activateHiddenSignIn}>Sign in</button>
    </div>
  </section>

  <section data-testid="linkedin-active-surface">
    <button type="button" onclick={recordAlternative}>Sign in with Apple</button
    >
    <div
      class="e5616576 _1957d19a _3ff5f032 _3e0ed175 d73e1ea3 _09ab8b1b _991ffcd1 d1901be7"
    >
      <div class="_649b9f0b d1901be7">
        <div class="_6f6ba678 _1957d19a _3ff5f032 d1901be7">
          <label for="«r3»"><span>Email or phone</span></label>
          <div class="dfaf4f38 d1901be7">
            <input
              id="«r3»"
              type="email"
              autocomplete="username webauthn"
              bind:value={username}
            />
          </div>
        </div>
      </div>
      <div class="dcd57938 _1957d19a d1901be7">
        <div class="_6f6ba678 _1957d19a _3ff5f032 d1901be7">
          <label for="«r4»"><span>Password</span></label>
          <div class="dfaf4f38 d1901be7">
            <input
              id="«r4»"
              type="password"
              autocomplete="current-password"
              bind:value={password}
            />
            <div class="c0d882ed dabfd919 _42ca2b07 _6b579e31">
              <button
                type="button"
                aria-label="Show password"
                onclick={recordAlternative}
              ></button>
            </div>
          </div>
        </div>
      </div>
      <a
        href="/checkpoint/rp/request-password-reset"
        onclick={recordAlternative}>Forgot password?</a
      >
      <label for="linkedin-active-keep-signed-in">Keep me signed in</label>
      <input
        id="linkedin-active-keep-signed-in"
        type="checkbox"
        tabindex="-1"
        bind:checked={keepSignedInChecked}
      />
      <button
        type="button"
        data-testid="linkedin-sign-in"
        onclick={activateSignIn}>Sign in</button
      >
    </div>
  </section>

  <a href="/signup" onclick={recordAlternative}>Join now</a>
  <nav aria-label="Legal and help">
    <a href="/legal/user-agreement" onclick={recordAlternative}
      >User Agreement</a
    >
    <a href="/legal/privacy-policy" onclick={recordAlternative}
      >Privacy Policy</a
    >
    <a href="/legal/cookie-policy" onclick={recordAlternative}>Cookie Policy</a>
    <a href="/help" onclick={recordAlternative}>Help Center</a>
  </nav>
  <label
    >Language<select onchange={recordAlternative}
      ><option>English</option></select
    ></label
  >
</main>

<style>
  .linkedin-responsive-hidden {
    display: none;
  }
</style>
