import {
  pageControlBelongsToFormScope,
  PasswordFormScopeKind,
} from "./password-form-fields";
import type { PasswordFormScope } from "./password-form-fields";

export enum PasswordFormQueryKind {
  Root = "root",
  Scoped = "scoped",
}

export type PasswordFormScopeQuery =
  | { kind: PasswordFormQueryKind.Root; root: ParentNode }
  | {
      kind: PasswordFormQueryKind.Scoped;
      root: ParentNode;
      formScope: PasswordFormScope;
    };

export function isSemanticSubmitControl(control: HTMLElement): boolean {
  return (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    (control.type === "submit" || control.type === "image")
  );
}

export function isResetControl(control: HTMLElement): boolean {
  return (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    control.type === "reset"
  );
}

export function isPlainNavigationControl(control: HTMLElement): boolean {
  return control instanceof HTMLAnchorElement && control.hasAttribute("href");
}

export function hasAssociatedForm(control: HTMLElement): boolean {
  if (
    control instanceof HTMLButtonElement ||
    control instanceof HTMLInputElement
  ) {
    return Boolean(control.form);
  }
  return Boolean(control.closest("form"));
}

export const authenticationAdvanceControlSelector =
  'button, input[type="submit"], input[type="button"], input[type="image"], a[href], [role="button"]';

export function authenticationAdvanceControls(
  request: PasswordFormScopeQuery,
): HTMLElement[] {
  const queryRoot =
    request.kind === PasswordFormQueryKind.Scoped &&
    request.formScope.kind === PasswordFormScopeKind.Owned
      ? request.formScope.owner.ownerDocument
      : request.root;
  const controls = Array.from(
    queryRoot.querySelectorAll<HTMLElement>(
      authenticationAdvanceControlSelector,
    ),
  );
  if (request.kind !== PasswordFormQueryKind.Scoped) return controls;
  return controls.filter((control) => {
    const scopeQuery: Parameters<typeof pageControlBelongsToFormScope>[0] = {
      control,
      formScope: request.formScope,
    };
    return pageControlBelongsToFormScope(scopeQuery);
  });
}
