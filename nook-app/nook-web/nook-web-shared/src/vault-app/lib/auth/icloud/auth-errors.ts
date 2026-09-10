import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type {
  CloudKitAuthError,
  CloudKitAuthErrorDetails,
} from "$lib/auth/icloud/cloudkit-runtime";

enum CloudKitDiagnosticValueKind {
  Unavailable = "unavailable",
  Available = "available",
}

type CloudKitDiagnosticString =
  | { kind: CloudKitDiagnosticValueKind.Unavailable }
  | { kind: CloudKitDiagnosticValueKind.Available; value: string };

type CloudKitDiagnosticNumber =
  | { kind: CloudKitDiagnosticValueKind.Unavailable }
  | { kind: CloudKitDiagnosticValueKind.Available; value: number };

enum CloudKitRedirectDetailsKind {
  Unavailable = "unavailable",
  Parsed = "parsed",
}

type CloudKitRedirectDetails =
  | { kind: CloudKitRedirectDetailsKind.Unavailable }
  | {
      kind: CloudKitRedirectDetailsKind.Parsed;
      origin: string;
      pathname: string;
    };

type CloudKitDiagnosticStrings = CloudKitDiagnosticString[];

type ExpectedCloudKitSignInFailureCheck = {
  readonly error: unknown;
  readonly hasSignInControl: boolean;
};

export const CloudKitAuthErrorTranslationKey = {
  SignInRequired: I18N_KEYS.ProviderSetupIcloudSignInRequired,
  UnknownError: I18N_KEYS.ProviderSetupIcloudUnknownError,
  SignInFailed: I18N_KEYS.ProviderSetupIcloudSignInFailed,
} as const;

export type CloudKitAuthErrorTranslationKey =
  (typeof CloudKitAuthErrorTranslationKey)[keyof typeof CloudKitAuthErrorTranslationKey];

enum CloudKitAuthenticationRequirement {
  Required = "required",
  Other = "other",
}

enum CloudKitFailureToken {
  AuthenticationRequired = "AUTHENTICATION_REQUIRED",
  RequestNeedsAuthorization = "REQUEST NEEDS AUTHORIZATION",
  NeedsAuthorization = "NEEDS AUTHORIZATION",
  UnknownError = "UNKNOWN_ERROR",
  AuthenticationFailed = "AUTHENTICATION_FAILED",
  MisdirectedStatus = "421",
  Misdirected = "MISDIRECTED",
}

enum CloudKitSignInFailureExpectation {
  Expected = "expected",
  Unexpected = "unexpected",
}

export class CloudKitFailureDiagnostic {
  readonly details: CloudKitAuthErrorDetails;

  constructor(error: unknown) {
    this.details = this.decodeDetails(error);
  }

  private decodeDetails(error: unknown): CloudKitAuthErrorDetails {
    if (error instanceof Error) {
      const code: CloudKitDiagnosticString =
        error.name && error.name !== "Error"
          ? {
              kind: CloudKitDiagnosticValueKind.Available,
              value: error.name,
            }
          : { kind: CloudKitDiagnosticValueKind.Unavailable };
      const message = this.stringValue(error.message);
      return {
        ...(code.kind === CloudKitDiagnosticValueKind.Available
          ? { code: code.value }
          : {}),
        ...(message.kind === CloudKitDiagnosticValueKind.Available
          ? { message: message.value }
          : {}),
      };
    }
    if (error && typeof error === "object") {
      const authError = error as CloudKitAuthError;
      const redirectURL = this.stringValue(authError.redirectURL);
      const redirect = this.cloudKitRedirectDetails(redirectURL);
      const code = this.firstDiagnosticString([
        this.stringValue(authError.code),
        this.stringValue(authError.errorCode),
        this.stringValue(authError.serverErrorCode),
        this.stringValue(authError.name),
      ]);
      const message = this.stringValue(authError.message);
      const reason = this.firstDiagnosticString([
        this.stringValue(authError.reason),
        this.stringValue(authError._reason),
      ]);
      const statusCandidates = [
        this.numericStatus(authError.status),
        this.numericStatus(authError.statusCode),
      ];
      const status: CloudKitDiagnosticNumber = ((v) =>
        v ? v : { kind: CloudKitDiagnosticValueKind.Unavailable })(
        statusCandidates.find(
          (value) => value.kind === CloudKitDiagnosticValueKind.Available,
        ),
      );
      const statusText = this.stringValue(authError.statusText);
      const uuid = this.stringValue(authError.uuid);
      return {
        ...(code.kind === CloudKitDiagnosticValueKind.Available
          ? { code: code.value }
          : {}),
        ...(message.kind === CloudKitDiagnosticValueKind.Available
          ? { message: message.value }
          : {}),
        redirectURLPresent:
          redirectURL.kind === CloudKitDiagnosticValueKind.Available,
        ...(redirect.kind === CloudKitRedirectDetailsKind.Parsed
          ? {
              redirectURLOrigin: redirect.origin,
              redirectURLPathname: redirect.pathname,
            }
          : {}),
        ...(reason.kind === CloudKitDiagnosticValueKind.Available
          ? { reason: reason.value }
          : {}),
        ...(status.kind === CloudKitDiagnosticValueKind.Available
          ? { status: status.value }
          : {}),
        ...(statusText.kind === CloudKitDiagnosticValueKind.Available
          ? { statusText: statusText.value }
          : {}),
        uuidPresent: uuid.kind === CloudKitDiagnosticValueKind.Available,
      };
    }
    return {};
  }
  private stringValue(value: unknown): CloudKitDiagnosticString {
    if (typeof value !== "string" && typeof value !== "number") {
      return { kind: CloudKitDiagnosticValueKind.Unavailable };
    }
    const text = String(value).trim();
    return text
      ? { kind: CloudKitDiagnosticValueKind.Available, value: text }
      : { kind: CloudKitDiagnosticValueKind.Unavailable };
  }
  private numericStatus(value: unknown): CloudKitDiagnosticNumber {
    const text = this.stringValue(value);
    if (text.kind === CloudKitDiagnosticValueKind.Unavailable) {
      return { kind: CloudKitDiagnosticValueKind.Unavailable };
    }
    const status = Number(text.value);
    return Number.isInteger(status)
      ? { kind: CloudKitDiagnosticValueKind.Available, value: status }
      : { kind: CloudKitDiagnosticValueKind.Unavailable };
  }
  private cloudKitRedirectDetails(
    redirectURL: CloudKitDiagnosticString,
  ): CloudKitRedirectDetails {
    if (redirectURL.kind === CloudKitDiagnosticValueKind.Unavailable) {
      return { kind: CloudKitRedirectDetailsKind.Unavailable };
    }
    try {
      const parsed = new URL(redirectURL.value);
      return {
        kind: CloudKitRedirectDetailsKind.Parsed,
        origin: parsed.origin,
        pathname: parsed.pathname,
      };
    } catch {
      return { kind: CloudKitRedirectDetailsKind.Unavailable };
    }
  }
  private firstDiagnosticString(
    values: CloudKitDiagnosticStrings,
  ): CloudKitDiagnosticString {
    return ((v) => (v ? v : { kind: CloudKitDiagnosticValueKind.Unavailable }))(
      values.find(
        (value) => value.kind === CloudKitDiagnosticValueKind.Available,
      ),
    );
  }
  private containsToken(token: CloudKitFailureToken): boolean {
    const { code, message, reason, statusText } = this.details;
    return [code, message, reason, statusText].some(
      (value) => value !== undefined && value.toUpperCase().includes(token),
    );
  }

  private authenticationRequirement(): CloudKitAuthenticationRequirement {
    if (
      this.details.status === 421 ||
      this.containsToken(CloudKitFailureToken.AuthenticationRequired) ||
      this.containsToken(CloudKitFailureToken.RequestNeedsAuthorization) ||
      this.containsToken(CloudKitFailureToken.NeedsAuthorization)
    )
      return CloudKitAuthenticationRequirement.Required;
    return CloudKitAuthenticationRequirement.Other;
  }

  signInFailureExpectation(): CloudKitSignInFailureExpectation {
    return this.authenticationRequirement() ===
      CloudKitAuthenticationRequirement.Required ||
      this.containsToken(CloudKitFailureToken.UnknownError)
      ? CloudKitSignInFailureExpectation.Expected
      : CloudKitSignInFailureExpectation.Unexpected;
  }

  translationKey(): CloudKitAuthErrorTranslationKey {
    if (
      this.authenticationRequirement() ===
        CloudKitAuthenticationRequirement.Required ||
      this.containsToken(CloudKitFailureToken.MisdirectedStatus) ||
      this.containsToken(CloudKitFailureToken.Misdirected)
    )
      return CloudKitAuthErrorTranslationKey.SignInRequired;
    // AUTHENTICATION_FAILED means a bad API token or a disallowed browser Origin.
    if (
      this.containsToken(CloudKitFailureToken.AuthenticationFailed) ||
      this.containsToken(CloudKitFailureToken.UnknownError)
    )
      return CloudKitAuthErrorTranslationKey.UnknownError;
    return CloudKitAuthErrorTranslationKey.SignInFailed;
  }
}

export class CloudKitSetupFailure {
  constructor(private readonly request: ExpectedCloudKitSignInFailureCheck) {}
  get expected(): boolean {
    const { error, hasSignInControl } = this.request;
    return (
      new CloudKitFailureDiagnostic(error).signInFailureExpectation() ===
        CloudKitSignInFailureExpectation.Expected && hasSignInControl
    );
  }
}

export class CloudKitFailurePresentation {
  constructor(private readonly request: unknown) {}
  get translationKey(): CloudKitAuthErrorTranslationKey {
    return new CloudKitFailureDiagnostic(this.request).translationKey();
  }
}
