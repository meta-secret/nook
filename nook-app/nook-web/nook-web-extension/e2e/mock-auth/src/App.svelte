<script lang="ts">
  import DetectionCombined from './pages/DetectionCombined.svelte'
  import DetectionHiddenHeaderLogin from './pages/DetectionHiddenHeaderLogin.svelte'
  import DetectionHiddenOtp from './pages/DetectionHiddenOtp.svelte'
  import DetectionLogin from './pages/DetectionLogin.svelte'
  import DetectionMicrosoft from './pages/DetectionMicrosoft.svelte'
  import DetectionOtp from './pages/DetectionOtp.svelte'
  import DetectionPasswordChange from './pages/DetectionPasswordChange.svelte'
  import DetectionSignup from './pages/DetectionSignup.svelte'
  import DetectionSlack from './pages/DetectionSlack.svelte'
  import DetectionSpa from './pages/DetectionSpa.svelte'
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
{:else if pathname === '/login'}
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
{:else if pathname === '/microsoft'}
  <DetectionMicrosoft />
{:else if pathname === '/slack'}
  <DetectionSlack />
{:else if pathname === '/login-with-hidden-header'}
  <DetectionHiddenHeaderLogin />
{:else}
  <NotFound />
{/if}
