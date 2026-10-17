import type {
  SignInAttemptLoginReference,
  WebsiteLoginAccountOption,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type SignInAttemptLoginAccount = Pick<
  WebsiteLoginAccountOption,
  'vaultStoreId' | 'secretId'
>
type SignInAttemptLoginMatch = {
  readonly login: SignInAttemptLoginReference
  readonly account: SignInAttemptLoginAccount
}

/** The opaque vault item identity a sign-in attempt carries for Try again. */
export class SignInAttemptLogin {
  static readonly SEPARATOR = '/'

  static reference(
    account: SignInAttemptLoginAccount,
  ): SignInAttemptLoginReference {
    return `${account.vaultStoreId}${SignInAttemptLogin.SEPARATOR}${account.secretId}`
  }

  static matches(match: SignInAttemptLoginMatch): boolean {
    return SignInAttemptLogin.reference(match.account) === match.login
  }
}
