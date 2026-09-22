import { AuthenticationControlSurface } from "./authentication-control-surface";
import {
  authenticationAdvanceControlSelector,
  semanticSubmitControlSelector,
} from "./authentication-control-selectors";
import type { PageControlSubmissionMethod as PageControlSubmissionMethodValue } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  PasswordFormScopeKind,
  type PasswordFormScope,
} from "./password-form-unowned-scope";

export const PageControlSubmissionMethod = {
  Absent: "absent",
  Post: "post",
  Get: "get",
  Dialog: "dialog",
} as const satisfies Record<string, PageControlSubmissionMethodValue>;

type HtmlSubmissionMethodRequest = {
  element: Element;
  name: string;
};

type SelectedSubmitterDisclosureRequest = {
  form: HTMLFormElement;
  selectedSubmitter: HTMLElement | false;
  scriptedGetPasswordDisclosureApproved: boolean;
};

type SemanticSubmitControlList = HTMLElement[];

/** Owns native form method and credential-disclosure semantics. */
export class AuthenticationSubmissionSemantics extends AuthenticationControlSurface {
  static readonly MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT = 100;

  associatedAuthenticationForm(control: HTMLElement): PasswordFormScope {
    const buttonElement = control.ownerDocument.defaultView?.HTMLButtonElement;
    const inputElement = control.ownerDocument.defaultView?.HTMLInputElement;
    if (
      ((buttonElement && control instanceof buttonElement) ||
        (inputElement && control instanceof inputElement)) &&
      control.form
    ) {
      return { kind: PasswordFormScopeKind.Owned, owner: control.form };
    }
    const owner = control.closest("form");
    const formElement = owner?.ownerDocument.defaultView?.HTMLFormElement;
    return owner && formElement && owner instanceof formElement
      ? { kind: PasswordFormScopeKind.Owned, owner }
      : { kind: PasswordFormScopeKind.Unowned };
  }

  countedSemanticSubmitControls(controls: SemanticSubmitControlList): number {
    return Math.min(
      controls.filter(
        (control) =>
          control.matches(semanticSubmitControlSelector) &&
          !this.controlIsInert(control),
      ).length,
      AuthenticationSubmissionSemantics.MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    );
  }

  private htmlEnumeratedSubmissionMethod(
    token: string,
  ): PageControlSubmissionMethodValue {
    const normalized = token.toLowerCase();
    if (normalized === "post") return PageControlSubmissionMethod.Post;
    if (normalized === "dialog") return PageControlSubmissionMethod.Dialog;
    return PageControlSubmissionMethod.Get;
  }

  private presentHtmlSubmissionMethod({
    element,
    name,
  }: HtmlSubmissionMethodRequest): PageControlSubmissionMethodValue | false {
    if (!element.hasAttribute(name)) return false;
    const token = element.getAttribute(name);
    return this.htmlEnumeratedSubmissionMethod(token ? token : "");
  }

  controlHasNativeSubmitSemantics(control: HTMLElement): boolean {
    const buttonElement = control.ownerDocument.defaultView?.HTMLButtonElement;
    if (buttonElement && control instanceof buttonElement) {
      return control.type !== "button" && control.type !== "reset";
    }
    const inputElement = control.ownerDocument.defaultView?.HTMLInputElement;
    return Boolean(
      inputElement &&
      control instanceof inputElement &&
      (control.type === "submit" || control.type === "image"),
    );
  }

  controlSubmissionMethod(
    control: HTMLElement,
  ): PageControlSubmissionMethodValue {
    if (!this.controlHasNativeSubmitSemantics(control)) {
      return PageControlSubmissionMethod.Absent;
    }
    const formmethodRequest: HtmlSubmissionMethodRequest = {
      element: control,
      name: "formmethod",
    };
    const formmethod = this.presentHtmlSubmissionMethod(formmethodRequest);
    if (formmethod !== false) return formmethod;
    const owner = this.associatedAuthenticationForm(control);
    if (owner.kind !== PasswordFormScopeKind.Owned) {
      return PageControlSubmissionMethod.Absent;
    }
    const methodRequest: HtmlSubmissionMethodRequest = {
      element: owner.owner,
      name: "method",
    };
    const method = this.presentHtmlSubmissionMethod(methodRequest);
    return method === false ? PageControlSubmissionMethod.Get : method;
  }

  formSubmissionMethod(
    form: HTMLFormElement,
  ): PageControlSubmissionMethodValue {
    const methodRequest: HtmlSubmissionMethodRequest = {
      element: form,
      name: "method",
    };
    const method = this.presentHtmlSubmissionMethod(methodRequest);
    return method === false ? PageControlSubmissionMethod.Get : method;
  }

  formUsesGetSubmission(form: HTMLFormElement): boolean {
    return this.formSubmissionMethod(form) === PageControlSubmissionMethod.Get;
  }

  submissionMethodBlocksCredentialDisclosure(
    method: PageControlSubmissionMethodValue,
  ): boolean {
    return (
      method === PageControlSubmissionMethod.Get ||
      method === PageControlSubmissionMethod.Dialog
    );
  }

  formBlocksCredentialDisclosure(form: HTMLFormElement): boolean {
    return this.submissionMethodBlocksCredentialDisclosure(
      this.formSubmissionMethod(form),
    );
  }

  private controlIsNativelyDisabledOrInert(control: HTMLElement): boolean {
    const buttonElement = control.ownerDocument.defaultView?.HTMLButtonElement;
    const inputElement = control.ownerDocument.defaultView?.HTMLInputElement;
    if (
      (((buttonElement && control instanceof buttonElement) ||
        (inputElement && control instanceof inputElement)) &&
        control.disabled) ||
      this.isDisabledByAncestorFieldset(control)
    ) {
      return true;
    }
    let element: HTMLElement = control;
    for (;;) {
      if (element.hasAttribute("inert") || element.inert) return true;
      const parent = element.parentElement;
      if (!parent) return false;
      element = parent;
    }
  }

  formHasGetMethodSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        semanticSubmitControlSelector,
      ),
    ).some((control) => {
      if (this.controlIsNativelyDisabledOrInert(control)) return false;
      const owner = this.associatedAuthenticationForm(control);
      return (
        owner.kind === PasswordFormScopeKind.Owned &&
        owner.owner === form &&
        this.controlSubmissionMethod(control) ===
          PageControlSubmissionMethod.Get
      );
    });
  }

  formHasPostMethodSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        semanticSubmitControlSelector,
      ),
    ).some((control) => {
      if (this.controlIsInert(control)) return false;
      const owner = this.associatedAuthenticationForm(control);
      return (
        owner.kind === PasswordFormScopeKind.Owned &&
        owner.owner === form &&
        this.controlSubmissionMethod(control) ===
          PageControlSubmissionMethod.Post
      );
    });
  }

  formHasDialogSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        authenticationAdvanceControlSelector,
      ),
    ).some((control) => {
      if (this.controlIsInert(control)) return false;
      const owner = this.associatedAuthenticationForm(control);
      return (
        owner.kind === PasswordFormScopeKind.Owned &&
        owner.owner === form &&
        this.controlSubmissionMethod(control) ===
          PageControlSubmissionMethod.Dialog
      );
    });
  }

  selectedSubmitterBlocksCredentialDisclosure({
    form,
    selectedSubmitter,
    scriptedGetPasswordDisclosureApproved,
  }: SelectedSubmitterDisclosureRequest): boolean {
    if (
      scriptedGetPasswordDisclosureApproved &&
      selectedSubmitter &&
      this.controlHasNativeSubmitSemantics(selectedSubmitter) &&
      this.controlSubmissionMethod(selectedSubmitter) ===
        PageControlSubmissionMethod.Get
    ) {
      return false;
    }
    if (selectedSubmitter) {
      if (this.controlHasNativeSubmitSemantics(selectedSubmitter)) {
        const formmethodRequest: HtmlSubmissionMethodRequest = {
          element: selectedSubmitter,
          name: "formmethod",
        };
        const formmethod = this.presentHtmlSubmissionMethod(formmethodRequest);
        if (formmethod !== false) {
          return (
            this.submissionMethodBlocksCredentialDisclosure(formmethod) ||
            this.formHasGetMethodSubmitter(form)
          );
        }
        return (
          this.formBlocksCredentialDisclosure(form) ||
          this.formHasGetMethodSubmitter(form)
        );
      }
      return (
        this.formHasGetMethodSubmitter(form) ||
        this.formBlocksCredentialDisclosure(form)
      );
    }
    if (
      this.formHasSemanticSubmitter(form) &&
      this.formUsesGetSubmission(form) &&
      !this.formHasPostMethodSubmitter(form)
    ) {
      return true;
    }
    if (
      !this.formHasSemanticSubmitter(form) &&
      this.formBlocksCredentialDisclosure(form)
    ) {
      return true;
    }
    return (
      this.formHasGetMethodSubmitter(form) || this.formHasDialogSubmitter(form)
    );
  }

  protected formHasAriaDisabledSemanticSubmitter(
    form: HTMLFormElement,
  ): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        semanticSubmitControlSelector,
      ),
    ).some((control) => {
      const buttonElement =
        control.ownerDocument.defaultView?.HTMLButtonElement;
      const inputElement = control.ownerDocument.defaultView?.HTMLInputElement;
      if (!(
        (buttonElement && control instanceof buttonElement) ||
        (inputElement && control instanceof inputElement)
      )) {
        return false;
      }
      return (
        control.form === form &&
        (control.getAttribute("aria-disabled") === "true" ||
          this.isDisabledByAncestorAria(control))
      );
    });
  }

  formHasSemanticSubmitter(form: HTMLFormElement): boolean {
    return Array.from(
      form.ownerDocument.querySelectorAll<HTMLElement>(
        semanticSubmitControlSelector,
      ),
    ).some((control) => {
      const buttonElement =
        control.ownerDocument.defaultView?.HTMLButtonElement;
      const inputElement = control.ownerDocument.defaultView?.HTMLInputElement;
      if (!(
        (buttonElement && control instanceof buttonElement) ||
        (inputElement && control instanceof inputElement)
      )) {
        return false;
      }
      return control.form === form && !this.controlIsInert(control);
    });
  }
}
