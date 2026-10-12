<script lang="ts">
  import type { MockAuthAccount } from '../../accounts'

  type Props = {
    account: MockAuthAccount
    note?: string
  }

  let { account, note }: Props = $props()
</script>

<aside class="fixture-creds" data-testid="mock-auth-fixture-credentials">
  <p class="fixture-creds__title">Fixture login</p>
  <p>
    Email: <code>{account.username}</code><br />
    Password: <code>{account.password}</code>
    {#if account.totpSecret}
      <br />TOTP seed: <code>{account.totpSecret}</code>
    {/if}
  </p>
  {#if note}
    <p class="fixture-creds__note">{note}</p>
  {/if}
</aside>
