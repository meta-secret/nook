export enum AirbnbLoginModalRouteKind {
  Absent = "absent",
  Present = "present",
}

export type AirbnbLoginModalRouteObservation =
  | { kind: AirbnbLoginModalRouteKind.Absent }
  | {
      kind: AirbnbLoginModalRouteKind.Present;
      destinationIdentity: string;
    };

export type AirbnbLoginModalRouteRequest = {
  form: HTMLFormElement;
};

export type AirbnbLoginModalContinueControlRequest = {
  form: HTMLFormElement;
  control: HTMLElement;
};

type AirbnbLoginModalHomepageActionRequest = {
  form: HTMLFormElement;
  pageUrl: string;
};

const AIRBNB_HOSTNAME = "www.airbnb.com";
const AIRBNB_HOME_PATH = "/";
const AIRBNB_LOGIN_PATH = "/login";
const AIRBNB_IDENTITY_FIELD_ID = "phone-or-email";
const AIRBNB_IDENTITY_LABEL = "phone number or email";
const AIRBNB_CONTINUE_LABEL = "continue";

/** Owns the narrow browser-only route adapter for Airbnb's homepage modal. */
class AirbnbLoginModalRouteDetector {
  constructor(private readonly request: AirbnbLoginModalRouteRequest) {}

  observe(): AirbnbLoginModalRouteObservation {
    const form = this.request.form;
    const page = form.ownerDocument.defaultView;
    if (!page || page.location.hostname !== AIRBNB_HOSTNAME) {
      return { kind: AirbnbLoginModalRouteKind.Absent };
    }
    if (page.location.pathname !== AIRBNB_HOME_PATH) {
      return { kind: AirbnbLoginModalRouteKind.Absent };
    }
    const homepageActionRequest: AirbnbLoginModalHomepageActionRequest = {
      form,
      pageUrl: page.location.href,
    };
    if (
      !this.formHasHomepageAction(homepageActionRequest) &&
      !this.formHasOmittedHomepageAction(homepageActionRequest)
    ) {
      return { kind: AirbnbLoginModalRouteKind.Absent };
    }
    if (!this.hasStrictAirbnbModalEvidence(form)) {
      return { kind: AirbnbLoginModalRouteKind.Absent };
    }
    return {
      kind: AirbnbLoginModalRouteKind.Present,
      destinationIdentity: `${page.location.origin}${AIRBNB_LOGIN_PATH}`,
    };
  }

  private formHasHomepageAction({
    form,
    pageUrl,
  }: AirbnbLoginModalHomepageActionRequest): boolean {
    if (!form.hasAttribute("action")) return false;
    const request: AirbnbLoginModalHomepageActionRequest = { form, pageUrl };
    return this.formResolvesToHomepage(request);
  }

  private formHasOmittedHomepageAction({
    form,
    pageUrl,
  }: AirbnbLoginModalHomepageActionRequest): boolean {
    if (form.hasAttribute("action")) return false;
    const request: AirbnbLoginModalHomepageActionRequest = { form, pageUrl };
    return this.formResolvesToHomepage(request);
  }

  private formResolvesToHomepage({
    form,
    pageUrl,
  }: AirbnbLoginModalHomepageActionRequest): boolean {
    try {
      const action = new URL(form.action, pageUrl);
      const page = form.ownerDocument.defaultView;
      if (!page) return false;
      return (
        action.origin === page.location.origin &&
        action.pathname === AIRBNB_HOME_PATH &&
        action.search === "" &&
        action.hash === ""
      );
    } catch {
      return false;
    }
  }

  private hasStrictAirbnbModalEvidence(form: HTMLFormElement): boolean {
    if (!this.formHasEmptyIdentity(form)) return false;
    const dialog = form.closest('[role="dialog"]');
    return (
      dialog instanceof HTMLElement &&
      this.dialogIsRendered(dialog) &&
      this.hasAirbnbIdentityField(form) &&
      this.hasAirbnbContinueControl(form)
    );
  }

  private formHasEmptyIdentity(form: HTMLFormElement): boolean {
    return [
      form.id,
      form.getAttribute("name"),
      form.getAttribute("class"),
      form.getAttribute("aria-label"),
    ].every((value) => !value);
  }

  private dialogIsRendered(dialog: HTMLElement): boolean {
    return (
      !dialog.hidden &&
      !dialog.hasAttribute("inert") &&
      dialog.getAttribute("aria-hidden") !== "true" &&
      dialog.getAttribute("aria-disabled") !== "true"
    );
  }

  private hasAirbnbIdentityField(form: HTMLFormElement): boolean {
    const fields = Array.from(form.querySelectorAll<HTMLInputElement>("input"));
    if (fields.length !== 1) return false;
    const field = fields[0];
    if (!field) return false;
    if (
      field.id !== AIRBNB_IDENTITY_FIELD_ID ||
      field.type !== "text" ||
      field.getAttribute("inputmode") !== "email" ||
      field.getAttribute("autocomplete") !== "tel-national"
    ) {
      return false;
    }
    const labels = field.labels;
    if (!labels || labels.length !== 1) return false;
    const label = labels[0];
    if (!(label instanceof HTMLLabelElement)) return false;
    return this.normalizedText(label) === AIRBNB_IDENTITY_LABEL;
  }

  private hasAirbnbContinueControl(form: HTMLFormElement): boolean {
    const controls = Array.from(
      form.querySelectorAll<HTMLButtonElement>("button[type=submit]"),
    );
    if (controls.length !== 1) return false;
    const control = controls[0];
    if (!control || control.hasAttribute("formaction")) return false;
    return this.normalizedText(control) === AIRBNB_CONTINUE_LABEL;
  }

  private normalizedText(element: Element): string {
    const text = element.textContent;
    return (typeof text === "string" ? text : "")
      .replace(/\s+/gu, " ")
      .trim()
      .toLowerCase();
  }
}

export function observeAirbnbLoginModalRoute(
  request: AirbnbLoginModalRouteRequest,
): AirbnbLoginModalRouteObservation {
  return new AirbnbLoginModalRouteDetector(request).observe();
}

export function isAirbnbLoginModalContinueControl({
  form,
  control,
}: AirbnbLoginModalContinueControlRequest): boolean {
  const routeRequest: AirbnbLoginModalRouteRequest = { form };
  if (
    observeAirbnbLoginModalRoute(routeRequest).kind !==
    AirbnbLoginModalRouteKind.Present
  ) {
    return false;
  }
  const controls = Array.from(
    form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
  );
  return controls.length === 1 && controls[0] === control;
}
