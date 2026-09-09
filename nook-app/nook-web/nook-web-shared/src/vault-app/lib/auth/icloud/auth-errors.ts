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

type ErrorTokenSearch = {
  readonly details: CloudKitAuthErrorDetails;
  readonly predicate: (value: string) => boolean;
};

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

export class CloudKitFailureDiagnostic {
  constructor(private readonly request: unknown) {}
  get details(): CloudKitAuthErrorDetails {
    const error = this.request;
    if (error instanceof Error) {
      const code: CloudKitDiagnosticString =
        error.name && error.name !== "Error"
          ? {
              kind: CloudKitDiagnosticValueKind.Available,
              value: error.name,
            }
          : { kind: CloudKitDiagnosticValueKind.Unavailable };
      const message = CloudKitFailureDiagnostic.stringValue(error.message);
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
      const redirectURL = CloudKitFailureDiagnostic.stringValue(
        authError.redirectURL,
      );
      const redirect =
        CloudKitFailureDiagnostic.cloudKitRedirectDetails(redirectURL);
      const code = CloudKitFailureDiagnostic.firstDiagnosticString([
        CloudKitFailureDiagnostic.stringValue(authError.code),
        CloudKitFailureDiagnostic.stringValue(authError.errorCode),
        CloudKitFailureDiagnostic.stringValue(authError.serverErrorCode),
        CloudKitFailureDiagnostic.stringValue(authError.name),
      ]);
      const message = CloudKitFailureDiagnostic.stringValue(authError.message);
      const reason = CloudKitFailureDiagnostic.firstDiagnosticString([
        CloudKitFailureDiagnostic.stringValue(authError.reason),
        CloudKitFailureDiagnostic.stringValue(authError._reason),
      ]);
      const statusCandidates = [
        CloudKitFailureDiagnostic.numericStatus(authError.status),
        CloudKitFailureDiagnostic.numericStatus(authError.statusCode),
      ];
      const status: CloudKitDiagnosticNumber = ((v) =>
        v ? v : { kind: CloudKitDiagnosticValueKind.Unavailable })(
        statusCandidates.find(
          (value) => value.kind === CloudKitDiagnosticValueKind.Available,
        ),
      );
      const statusText = CloudKitFailureDiagnostic.stringValue(
        authError.statusText,
      );
      const uuid = CloudKitFailureDiagnostic.stringValue(authError.uuid);
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
  static stringValue(value: unknown): CloudKitDiagnosticString {
    if (typeof value !== "string" && typeof value !== "number") {
      return { kind: CloudKitDiagnosticValueKind.Unavailable };
    }
    const text = String(value).trim();
    return text
      ? { kind: CloudKitDiagnosticValueKind.Available, value: text }
      : { kind: CloudKitDiagnosticValueKind.Unavailable };
  }
  static numericStatus(value: unknown): CloudKitDiagnosticNumber {
    const text = CloudKitFailureDiagnostic.stringValue(value);
    if (text.kind === CloudKitDiagnosticValueKind.Unavailable) {
      return { kind: CloudKitDiagnosticValueKind.Unavailable };
    }
    const status = Number(text.value);
    return Number.isInteger(status)
      ? { kind: CloudKitDiagnosticValueKind.Available, value: status }
      : { kind: CloudKitDiagnosticValueKind.Unavailable };
  }
  static cloudKitRedirectDetails(
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
  static firstDiagnosticString(
    values: CloudKitDiagnosticStrings,
  ): CloudKitDiagnosticString {
    return ((v) => (v ? v : { kind: CloudKitDiagnosticValueKind.Unavailable }))(
      values.find(
        (value) => value.kind === CloudKitDiagnosticValueKind.Available,
      ),
    );
  }
  static hasErrorToken({ details, predicate }: ErrorTokenSearch): boolean {
    return [details.code, details.message, details.reason, details.statusText]
      .filter((value): value is string => Boolean(value))
      .some((value) => predicate(value.toUpperCase()));
  }
  static isAuthRequiredCloudKitError(
    details: CloudKitAuthErrorDetails,
  ): boolean {
    if (details.status === 421) return true;
    const hasErrorTokenArgs: Parameters<
      typeof CloudKitFailureDiagnostic.hasErrorToken
    >[0] = {
      details,
      predicate: (value) =>
        [
          "AUTHENTICATION_REQUIRED",
          "REQUEST NEEDS AUTHORIZATION",
          "NEEDS AUTHORIZATION",
        ].some((token) => value.includes(token)),
    };
    return CloudKitFailureDiagnostic.hasErrorToken(hasErrorTokenArgs);
  }
}
export class CloudKitSetupFailure {
  constructor(private readonly request: ExpectedCloudKitSignInFailureCheck) {}
  get expected(): boolean {
    const { error, hasSignInControl } = this.request;
    const details = new CloudKitFailureDiagnostic(error).details;
    if (CloudKitFailureDiagnostic.isAuthRequiredCloudKitError(details))
      return hasSignInControl;
    const hasErrorTokenArgs2: Parameters<
      typeof CloudKitFailureDiagnostic.hasErrorToken
    >[0] = {
      details,
      predicate: (value) => value.includes("UNKNOWN_ERROR"),
    };
    const isOpaqueUnknown =
      CloudKitFailureDiagnostic.hasErrorToken(hasErrorTokenArgs2);
    return isOpaqueUnknown && hasSignInControl;
  }
}
export class CloudKitFailurePresentation {
  constructor(private readonly request: unknown) {}
  get translationKey(): CloudKitAuthErrorTranslationKey {
    const error = this.request;
    const details = new CloudKitFailureDiagnostic(error).details;
    if (CloudKitFailureDiagnostic.isAuthRequiredCloudKitError(details)) {
      return CloudKitAuthErrorTranslationKey.SignInRequired;
    }
    const isMisdirectedRequest =
      details.status === 421 ||
      (() => {
        const hasErrorTokenArgs3: Parameters<
          typeof CloudKitFailureDiagnostic.hasErrorToken
        >[0] = {
          details,
          predicate: (value) =>
            value.includes("421") || value.includes("MISDIRECTED"),
        };
        return CloudKitFailureDiagnostic.hasErrorToken(hasErrorTokenArgs3);
      })();
    if (isMisdirectedRequest) {
      return CloudKitAuthErrorTranslationKey.SignInRequired;
    }
    // AUTHENTICATION_FAILED means a bad API token or a disallowed browser Origin.
    if (
      (() => {
        const hasErrorTokenArgs4: Parameters<
          typeof CloudKitFailureDiagnostic.hasErrorToken
        >[0] = {
          details,
          predicate: (value) => value.includes("AUTHENTICATION_FAILED"),
        };
        return CloudKitFailureDiagnostic.hasErrorToken(hasErrorTokenArgs4);
      })() ||
      (() => {
        const hasErrorTokenArgs5: Parameters<
          typeof CloudKitFailureDiagnostic.hasErrorToken
        >[0] = {
          details,
          predicate: (value) => value.includes("UNKNOWN_ERROR"),
        };
        return CloudKitFailureDiagnostic.hasErrorToken(hasErrorTokenArgs5);
      })()
    ) {
      return CloudKitAuthErrorTranslationKey.UnknownError;
    }
    return CloudKitAuthErrorTranslationKey.SignInFailed;
  }
}
