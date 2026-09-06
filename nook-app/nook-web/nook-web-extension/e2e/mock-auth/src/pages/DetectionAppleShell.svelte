<script lang="ts">
  import { AppleAuthMockScenario } from '../lib/apple-auth-flow'

  const authorizationFrameSource =
    AppleAuthMockScenario.authorizationFrameSource(location.href)
</script>

<main>
  <h1>Apple Account</h1>
  <p data-testid="mock-auth-scenario">apple-account-shell</p>
  <iframe
    data-testid="apple-auth-frame"
    title="Sign in to Apple Account"
    src={authorizationFrameSource}
    width="480"
    height="620"
  ></iframe>
</main>
