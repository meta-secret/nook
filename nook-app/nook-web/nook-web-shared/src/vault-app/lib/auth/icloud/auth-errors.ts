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

function stringValue(value: unknown): CloudKitDiagnosticString {
  if (typeof value !== "string" && typeof value !== "number") {
    return { kind: CloudKitDiagnosticValueKind.Unavailable };
  }
  const text = String(value).trim();
  return text
    ? { kind: CloudKitDiagnosticValueKind.Available, value: text }
    : { kind: CloudKitDiagnosticValueKind.Unavailable };
}

function numericStatus(value: unknown): CloudKitDiagnosticNumber {
  const text = stringValue(value);
  if (text.kind === CloudKitDiagnosticValueKind.Unavailable) {
    return { kind: CloudKitDiagnosticValueKind.Unavailable };
  }
  const status = Number(text.value);
  return Number.isInteger(status)
    ? { kind: CloudKitDiagnosticValueKind.Available, value: status }
    : { kind: CloudKitDiagnosticValueKind.Unavailable };
}

function cloudKitRedirectDetails(
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

function firstDiagnosticString(
  values: CloudKitDiagnosticString[],
): CloudKitDiagnosticString {
  return (
    values.find(
      (value) => value.kind === CloudKitDiagnosticValueKind.Available,
    ) ?? { kind: CloudKitDiagnosticValueKind.Unavailable }
  );
}

export function cloudKitAuthErrorDetails(
  error: unknown,
): CloudKitAuthErrorDetails {
  if (error instanceof Error) {
    const code: CloudKitDiagnosticString =
      error.name && error.name !== "Error"
        ? {
            kind: CloudKitDiagnosticValueKind.Available,
            value: error.name,
          }
        : { kind: CloudKitDiagnosticValueKind.Unavailable };
    const message = stringValue(error.message);
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
    const redirectURL = stringValue(authError.redirectURL);
    const redirect = cloudKitRedirectDetails(redirectURL);
    const code = firstDiagnosticString([
      stringValue(authError.code),
      stringValue(authError.errorCode),
      stringValue(authError.serverErrorCode),
      stringValue(authError.name),
    ]);
    const message = stringValue(authError.message);
    const reason = firstDiagnosticString([
      stringValue(authError.reason),
      stringValue(authError._reason),
    ]);
    const statusCandidates = [
      numericStatus(authError.status),
      numericStatus(authError.statusCode),
    ];
    const status: CloudKitDiagnosticNumber = statusCandidates.find(
      (value) => value.kind === CloudKitDiagnosticValueKind.Available,
    ) ?? { kind: CloudKitDiagnosticValueKind.Unavailable };
    const statusText = stringValue(authError.statusText);
    const uuid = stringValue(authError.uuid);
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

function hasErrorToken({
  details,
  predicate,
}: {
  readonly details: CloudKitAuthErrorDetails;
  readonly predicate: (value: string) => boolean;
}): boolean {
  return [details.code, details.message, details.reason, details.statusText]
    .filter((value): value is string => Boolean(value))
    .some((value) => predicate(value.toUpperCase()));
}

function isAuthRequiredCloudKitError(
  details: CloudKitAuthErrorDetails,
): boolean {
  if (details.status === 421) return true;
  const hasErrorTokenArgs: Parameters<typeof hasErrorToken>[0] = {
    details,
    predicate: (value) =>
      [
        "AUTHENTICATION_REQUIRED",
        "REQUEST NEEDS AUTHORIZATION",
        "NEEDS AUTHORIZATION",
      ].some((token) => value.includes(token)),
  };
  return hasErrorToken(hasErrorTokenArgs);
}

export function isExpectedCloudKitSignInSetupFailure({
  error,
  hasSignInControl,
}: {
  readonly error: unknown;
  readonly hasSignInControl: boolean;
}): boolean {
  const details = cloudKitAuthErrorDetails(error);
  if (isAuthRequiredCloudKitError(details)) return hasSignInControl;
  const hasErrorTokenArgs2: Parameters<typeof hasErrorToken>[0] = {
    details,
    predicate: (value) => value.includes("UNKNOWN_ERROR"),
  };
  const isOpaqueUnknown = hasErrorToken(hasErrorTokenArgs2);
  return isOpaqueUnknown && hasSignInControl;
}

export const CloudKitAuthErrorTranslationKey = {
  SignInRequired: I18N_KEYS.ProviderSetupIcloudSignInRequired,
  UnknownError: I18N_KEYS.ProviderSetupIcloudUnknownError,
  SignInFailed: I18N_KEYS.ProviderSetupIcloudSignInFailed,
} as const;

export type CloudKitAuthErrorTranslationKey =
  (typeof CloudKitAuthErrorTranslationKey)[keyof typeof CloudKitAuthErrorTranslationKey];

export function cloudKitAuthErrorTranslationKey(
  error: unknown,
): CloudKitAuthErrorTranslationKey {
  const details = cloudKitAuthErrorDetails(error);
  if (isAuthRequiredCloudKitError(details)) {
    return CloudKitAuthErrorTranslationKey.SignInRequired;
  }
  const isMisdirectedRequest =
    details.status === 421 ||
    (() => {
      const hasErrorTokenArgs3: Parameters<typeof hasErrorToken>[0] = {
        details,
        predicate: (value) =>
          value.includes("421") || value.includes("MISDIRECTED"),
      };
      return hasErrorToken(hasErrorTokenArgs3);
    })();
  if (isMisdirectedRequest) {
    return CloudKitAuthErrorTranslationKey.SignInRequired;
  }
  // AUTHENTICATION_FAILED means a bad API token or a disallowed browser Origin.
  if (
    (() => {
      const hasErrorTokenArgs4: Parameters<typeof hasErrorToken>[0] = {
        details,
        predicate: (value) => value.includes("AUTHENTICATION_FAILED"),
      };
      return hasErrorToken(hasErrorTokenArgs4);
    })() ||
    (() => {
      const hasErrorTokenArgs5: Parameters<typeof hasErrorToken>[0] = {
        details,
        predicate: (value) => value.includes("UNKNOWN_ERROR"),
      };
      return hasErrorToken(hasErrorTokenArgs5);
    })()
  ) {
    return CloudKitAuthErrorTranslationKey.UnknownError;
  }
  return CloudKitAuthErrorTranslationKey.SignInFailed;
}
