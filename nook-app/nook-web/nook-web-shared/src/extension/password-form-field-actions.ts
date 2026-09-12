import {
  PasswordFormScopeKind,
  type PasswordFieldQuery,
  passwordFieldDiscovery,
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

type TrackedLoginCredentialField = NativeInputValueMutation & {
  request: PasswordFormScopeQuery;
};

/** Owns the browser runtime resources shared by these interactions. */
class PasswordFormCredentialInteraction {
  readLoginCredentials(
    request: PasswordFormScopeQuery,
  ): LoginCredentialsLookup {
    const nookTypedArgs0_25 = this.passwordFieldQuery(request);
    const passwordFields =
      passwordFieldDiscovery.findPasswordFields(nookTypedArgs0_25);
    if (passwordFields.length === 0) {
      return { kind: LoginCredentialsLookupKind.Absent };
    }

    const newPasswordFields = passwordFields.filter((field) => {
      const nookArrowArgs4: Parameters<
        typeof passwordFieldDiscovery.hasAutocompleteToken
      >[0] = {
        field,
        expected: "new-password",
      };
      return passwordFieldDiscovery.hasAutocompleteToken(nookArrowArgs4);
    });
    let passwordField = passwordFields.find((field) => {
      const nookArrowArgs5: Parameters<
        typeof passwordFieldDiscovery.hasAutocompleteToken
      >[0] = {
        field,
        expected: "current-password",
      };
      return passwordFieldDiscovery.hasAutocompleteToken(nookArrowArgs5);
    });
    if (!passwordField) [passwordField] = newPasswordFields;
    if (!passwordField) [passwordField] = passwordFields;
    if (!passwordField) return { kind: LoginCredentialsLookupKind.Absent };
    const password = passwordField.value.trim();
    const nookNamedArgs0_3 = this.passwordFieldQuery(request);
    const username = ((v) => (v ? v : ""))(
      passwordFieldDiscovery
        .findUsernameFields(nookNamedArgs0_3)[0]
        ?.value.trim(),
    );
    if (!username || !password) {
      return { kind: LoginCredentialsLookupKind.Absent };
    }
    return {
      kind: LoginCredentialsLookupKind.Found,
      credentials: { username, password },
    };
  }

  private filledLoginCredentialFields = new WeakMap<
    ParentNode,
    Set<HTMLInputElement>
  >();
  private loginCredentialFieldKey(request: PasswordFormScopeQuery): ParentNode {
    if (
      request.kind === PasswordFormQueryKind.Scoped &&
      request.formScope.kind === PasswordFormScopeKind.Owned
    ) {
      return request.formScope.owner;
    }
    return request.root;
  }

  trackLoginCredentialField({
    request,
    input,
  }: TrackedLoginCredentialField): void {
    const key = this.loginCredentialFieldKey(request);
    const tracked = ((v) => (v ? v : new Set<HTMLInputElement>()))(
      this.filledLoginCredentialFields.get(key),
    );
    tracked.add(input);
    this.filledLoginCredentialFields.set(key, tracked);
  }

  beginLoginCredentialFill(request: PasswordFormScopeQuery): void {
    this.filledLoginCredentialFields.delete(
      this.loginCredentialFieldKey(request),
    );
  }

  private passwordFieldQuery(
    request: PasswordFormScopeQuery,
  ): PasswordFieldQuery {
    if (request.kind === PasswordFormQueryKind.Root) {
      return { root: request.root };
    }
    return { root: request.root, formScope: request.formScope };
  }

  setNativeInputValue({ input, value }: NativeInputValueMutation): void {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
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

  fillOneTimeCode(request: OneTimeCodeFillRequest): boolean {
    const field = passwordFieldDiscovery.preferredOneTimeCodeFillField(
      passwordFieldDiscovery.findOneTimeCodeFields(
        this.passwordFieldQuery(request),
      ),
    );
    if (!field) return false;
    const mutation: Parameters<typeof this.setNativeInputValue>[0] = {
      input: field,
      value: request.code,
    };
    this.setNativeInputValue(mutation);
    field.focus();
    return true;
  }

  fillGeneratedPassword(request: GeneratedPasswordFillRequest): boolean {
    const passwordFields = passwordFieldDiscovery
      .findPasswordFields(this.passwordFieldQuery(request))
      .filter((field) => !field.readOnly);
    const newPasswordFields = passwordFields.filter((field) => {
      const tokenRequest: Parameters<
        typeof passwordFieldDiscovery.hasAutocompleteToken
      >[0] = {
        field,
        expected: "new-password",
      };
      return passwordFieldDiscovery.hasAutocompleteToken(tokenRequest);
    });
    if (newPasswordFields.length === 0) return false;
    for (const field of newPasswordFields) {
      const mutation: Parameters<typeof this.setNativeInputValue>[0] = {
        input: field,
        value: request.password,
      };
      this.setNativeInputValue(mutation);
    }
    newPasswordFields[0]?.focus();
    return true;
  }

  clearLoginCredentials(request: PasswordFormScopeQuery): void {
    const clearField = (input: HTMLInputElement): void => {
      const mutation: Parameters<typeof this.setNativeInputValue>[0] = {
        input,
        value: "",
      };
      this.setNativeInputValue(mutation);
    };
    const key = this.loginCredentialFieldKey(request);
    const fields = ((v) => (v ? v : new Set<HTMLInputElement>()))(
      this.filledLoginCredentialFields.get(key),
    );
    fields.forEach(clearField);
    this.filledLoginCredentialFields.delete(key);
  }
}

export const passwordFormCredentialInteraction =
  new PasswordFormCredentialInteraction();
