import {
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  hasAutocompleteToken,
  preferredOneTimeCodeFillField,
  type PasswordFieldQuery,
} from "./password-form-fields";
import {
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";

export type OneTimeCodeFillRequest = PasswordFormScopeQuery & { code: string };

export type LoginCredentials = {
  username: string;
  password: string;
};

export type LoginCredentialsFillRequest = PasswordFormScopeQuery & {
  credentials: LoginCredentials;
};

export enum LoginCredentialsLookupKind {
  Absent = "absent",
  Found = "found",
}

export type LoginCredentialsLookup =
  | { kind: LoginCredentialsLookupKind.Absent }
  | {
      kind: LoginCredentialsLookupKind.Found;
      credentials: LoginCredentials;
    };

export type GeneratedPasswordFillRequest = PasswordFormScopeQuery & {
  password: string;
};

type NativeInputValueMutation = { input: HTMLInputElement; value: string };

function passwordFieldQuery(
  request: PasswordFormScopeQuery,
): PasswordFieldQuery {
  if (request.kind === PasswordFormQueryKind.Root) {
    return { root: request.root };
  }
  return { root: request.root, formScope: request.formScope };
}

export function setNativeInputValue({
  input,
  value,
}: NativeInputValueMutation): void {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  const inputEventOptions: ConstructorParameters<typeof Event>[1] = {
    bubbles: true,
  };
  input.dispatchEvent(new Event("input", inputEventOptions));
  const changeEventOptions: ConstructorParameters<typeof Event>[1] = {
    bubbles: true,
  };
  input.dispatchEvent(new Event("change", changeEventOptions));
}

export function fillOneTimeCode(request: OneTimeCodeFillRequest): boolean {
  const field = preferredOneTimeCodeFillField(
    findOneTimeCodeFields(passwordFieldQuery(request)),
  );
  if (!field) return false;
  const mutation: Parameters<typeof setNativeInputValue>[0] = {
    input: field,
    value: request.code,
  };
  setNativeInputValue(mutation);
  field.focus();
  return true;
}

export function fillGeneratedPassword(
  request: GeneratedPasswordFillRequest,
): boolean {
  const passwordFields = findPasswordFields(passwordFieldQuery(request)).filter(
    (field) => !field.readOnly,
  );
  const newPasswordFields = passwordFields.filter((field) => {
    const tokenRequest: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(tokenRequest);
  });
  if (newPasswordFields.length === 0) return false;
  for (const field of newPasswordFields) {
    const mutation: Parameters<typeof setNativeInputValue>[0] = {
      input: field,
      value: request.password,
    };
    setNativeInputValue(mutation);
  }
  newPasswordFields[0]?.focus();
  return true;
}

export function clearLoginCredentials(
  request: PasswordFormScopeQuery,
): void {
  const clearField = (input: HTMLInputElement): void => {
    const mutation: Parameters<typeof setNativeInputValue>[0] = {
      input,
      value: "",
    };
    setNativeInputValue(mutation);
  };
  findUsernameFields(passwordFieldQuery(request)).forEach(clearField);
  findPasswordFields(passwordFieldQuery(request)).forEach(clearField);
}
