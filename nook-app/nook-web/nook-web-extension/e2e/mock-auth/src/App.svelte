<script lang="ts">
  import DetectionCombined from './pages/DetectionCombined.svelte'
  import DetectionApple from './pages/DetectionApple.svelte'
  import DetectionAppleShell from './pages/DetectionAppleShell.svelte'
  import DetectionAmazon from './pages/DetectionAmazon.svelte'
  import DetectionFromFixture from './pages/DetectionFromFixture.svelte'
  import DetectionGoogle from './pages/DetectionGoogle.svelte'
  import DetectionGithub from './pages/DetectionGithub.svelte'
  import DetectionHiddenHeaderLogin from './pages/DetectionHiddenHeaderLogin.svelte'
  import DetectionHiddenOtp from './pages/DetectionHiddenOtp.svelte'
  import DetectionLogin from './pages/DetectionLogin.svelte'
  import DetectionMicrosoftConsumer from './pages/DetectionMicrosoftConsumer.svelte'
  import DetectionLinkedIn from './pages/DetectionLinkedIn.svelte'
  import DetectionNetflix from './pages/DetectionNetflix.svelte'
  import DetectionOtp from './pages/DetectionOtp.svelte'
  import DetectionOpenAi from './pages/DetectionOpenAi.svelte'
  import DetectionPasswordChange from './pages/DetectionPasswordChange.svelte'
  import DetectionSignup from './pages/DetectionSignup.svelte'
  import DetectionSpa from './pages/DetectionSpa.svelte'
  import DetectionX from './pages/DetectionX.svelte'
  import DetectionXRedirect from './pages/DetectionXRedirect.svelte'
  import NotFound from './pages/NotFound.svelte'
  import PlainLogin from './pages/PlainLogin.svelte'
  import Success from './pages/Success.svelte'
  import TotpBackupCodes from './pages/TotpBackupCodes.svelte'
  import TotpEnrollQr from './pages/TotpEnrollQr.svelte'
  import TotpEnrollSuccess from './pages/TotpEnrollSuccess.svelte'
  import TotpEnrollVerify from './pages/TotpEnrollVerify.svelte'
  import TotpLogin from './pages/TotpLogin.svelte'
  import TotpVerify from './pages/TotpVerify.svelte'

  let pathname = $state(location.pathname)

  function syncPath() {
    pathname = location.pathname
  }

  const siteMatch = $derived(pathname.match(/^\/site\/([a-z0-9-]+)$/u))
  const templateMatch = $derived(pathname.match(/^\/template\/([a-z0-9-]+)$/u))
  const legacySiteId = $derived(
    (
      {
        '/microsoft': 'microsoft',
        '/slack': 'slack',
        '/facebook': 'facebook',
        '/google': 'google',
        '/apple': 'apple',
        '/amazon': 'amazon',
        '/github': 'github',
        '/linkedin': 'linkedin',
        '/x': 'x',
      } as Record<string, string>
    )[pathname],
  )
  const isNetflixLogin = $derived(
    location.hostname === 'www.netflix.com' && pathname === '/login',
  )
</script>

<svelte:window onpopstate={syncPath} />

{#if pathname === '/plain/login'}
  <PlainLogin />
{:else if pathname === '/plain/success'}
  <Success flow="plain-login" />
{:else if pathname === '/totp/login'}
  <TotpLogin />
{:else if pathname === '/totp/verify'}
  <TotpVerify />
{:else if pathname === '/totp/success'}
  <Success flow="login-then-totp" />
{:else if pathname === '/totp/enroll'}
  <TotpEnrollQr />
{:else if pathname === '/totp/enroll/verify'}
  <TotpEnrollVerify />
{:else if pathname === '/totp/enroll/success'}
  <TotpEnrollSuccess />
{:else if pathname === '/totp/backup-codes'}
  <TotpBackupCodes />
{:else if pathname === '/login/'}
  <DetectionLinkedIn />
{:else if isNetflixLogin}
  <DetectionNetflix />
{:else if pathname === '/login' || pathname === '/linkedin'}
  <DetectionLogin />
{:else if pathname === '/signup'}
  <DetectionSignup />
{:else if pathname === '/signup/success'}
  <Success flow="signup" />
{:else if pathname === '/password-change'}
  <DetectionPasswordChange />
{:else if pathname === '/password-change/success'}
  <Success flow="password-change" />
{:else if pathname === '/otp'}
  <DetectionOtp />
{:else if pathname === '/otp-hidden'}
  <DetectionHiddenOtp />
{:else if pathname === '/combined'}
  <DetectionCombined />
{:else if pathname === '/spa'}
  <DetectionSpa />
{:else if pathname === '/login-with-hidden-header'}
  <DetectionHiddenHeaderLogin />
{:else if pathname === '/' || pathname === '/microsoft-consumer'}
  <DetectionMicrosoftConsumer />
{:else if pathname === '/account/sign-in'}
  <DetectionAppleShell />
{:else if pathname === '/ap/signin'}
  <DetectionAmazon />
{:else if pathname === '/appleauth/auth/authorize/signin'}
  <DetectionApple />
{:else if pathname === '/v3/signin/identifier' || pathname === '/v3/signin/challenge/pwd'}
  <DetectionGoogle />
{:else if pathname === '/github' || pathname === '/github/login'}
  <DetectionGithub />
{:else if pathname === '/auth/login' || pathname === '/log-in-or-create-account'}
  <DetectionOpenAi />
{:else if pathname === '/i/jf/onboarding/web'}
  <DetectionX />
{:else if pathname === '/i/flow/login'}
  <DetectionXRedirect />
{:else if templateMatch?.[1]}
  <DetectionFromFixture templateId={templateMatch[1]} />
{:else if siteMatch?.[1]}
  <DetectionFromFixture siteId={siteMatch[1]} />
{:else if legacySiteId}
  <DetectionFromFixture siteId={legacySiteId} />
{:else}
  <NotFound />
{/if}
