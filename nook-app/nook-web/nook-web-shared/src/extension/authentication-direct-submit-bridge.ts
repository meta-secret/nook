const DIRECT_SUBMIT_EVENT = "nook-authentication-direct-submit-v1";
type AuthenticationDirectSubmitHandler = (
  form: HTMLFormElement,
) => boolean;

type AuthenticationDirectSubmitBridgeState = {
  handler?: AuthenticationDirectSubmitHandler;
};

export type FormSubmissionApproval = {
  isApproved: () => boolean;
  reject: () => void;
};

export enum FormSubmissionResult {
  NotObserved = "not-observed",
  Submitted = "submitted",
  Rejected = "rejected",
}

export type AuthenticationSubmissionObservation = {
  form: HTMLFormElement;
  action: () => void;
  approval: FormSubmissionApproval | false;
  expectedSubmitter: HTMLElement | false;
  directRouteApproved: () => boolean;
};

const ISOLATED_BRIDGE_STATE = "__nookAuthenticationDirectSubmitBridgeV1";

function isolatedBridgeState(): AuthenticationDirectSubmitBridgeState {
  const existing = Reflect.get(globalThis, ISOLATED_BRIDGE_STATE);
  if (typeof existing === "object" && existing)
    return existing as AuthenticationDirectSubmitBridgeState;
  const state: AuthenticationDirectSubmitBridgeState = {};
  Reflect.set(globalThis, ISOLATED_BRIDGE_STATE, state);
  return state;
}

export function observeAuthenticationDirectSubmits(
  handler: AuthenticationDirectSubmitHandler,
): () => void {
  const state = isolatedBridgeState();
  const previous = state.handler;
  state.handler = handler;
  return () => {
    state.handler = previous;
  };
}

export function installIsolatedAuthenticationDirectSubmitBridge(): () => void {
  const receive = (event: Event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    const handler = isolatedBridgeState().handler;
    if (handler && !handler(event.target)) event.preventDefault();
  };
  window.addEventListener(DIRECT_SUBMIT_EVENT, receive, true);
  return () => {
    window.removeEventListener(DIRECT_SUBMIT_EVENT, receive, true);
  };
}

export function installPageAuthenticationDirectSubmitBridge(): () => void {
  const prototype = HTMLFormElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "submit");
  const nativeSubmit = prototype.submit;
  const bridgedSubmit = function (this: HTMLFormElement): void {
    const eventInit: EventInit = { bubbles: true, cancelable: true, composed: true };
    const event = new Event(DIRECT_SUBMIT_EVENT, eventInit);
    if (this.dispatchEvent(event)) nativeSubmit.call(this);
  };
  const submitDescriptor: PropertyDescriptor = {
    configurable: true,
    writable: true,
    value: bridgedSubmit,
  };
  Object.defineProperty(prototype, "submit", submitDescriptor);
  return () => {
    if (prototype.submit !== bridgedSubmit) return;
    if (descriptor) Object.defineProperty(prototype, "submit", descriptor);
  };
}

export function observeAuthenticationSubmission({
  form,
  action,
  approval,
  expectedSubmitter,
  directRouteApproved,
}: AuthenticationSubmissionObservation): FormSubmissionResult {
  let result = FormSubmissionResult.NotObserved;
  let replaying = false;
  let pageEvent: SubmitEvent | false = false;
  let pagePrevented = false;
  let directSubmitted = false;
  const reject = () => {
    result = FormSubmissionResult.Rejected;
    if (approval) approval.reject();
  };
  const mediate = (event: SubmitEvent) => {
    if (event.target !== form || event === pageEvent) return;
    if (replaying) {
      event.stopImmediatePropagation();
      if (!directRouteApproved() || !approval || !approval.isApproved()) {
        event.preventDefault();
        reject();
        return;
      }
      result = FormSubmissionResult.Submitted;
      return;
    }
    const submitter = event.submitter === form ? false : event.submitter;
    const submitterChanged = submitter
      ? submitter !== expectedSubmitter
      : expectedSubmitter !== false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (submitterChanged || (approval && !approval.isApproved())) {
      reject();
      return;
    }
    if (pageEvent) return;
    const pageEventInit: SubmitEventInit = { bubbles: true, cancelable: true };
    if (submitter !== false) pageEventInit.submitter = submitter;
    pageEvent = new SubmitEvent("submit", pageEventInit);
    form.dispatchEvent(pageEvent);
    pagePrevented = pageEvent.defaultPrevented;
    pageEvent = false;
    if (result === FormSubmissionResult.Rejected) return;
    if (approval && !approval.isApproved()) {
      reject();
      return;
    }
    result = FormSubmissionResult.Submitted;
  };
  const stopDirectObservation = observeAuthenticationDirectSubmits(
    (submittedForm) => {
      if (submittedForm !== form) return true;
      if (!approval || !directRouteApproved() || !approval.isApproved()) {
        reject();
        return false;
      }
      result = FormSubmissionResult.Submitted;
      directSubmitted = true;
      return true;
    },
  );
  form.addEventListener("submit", mediate, true);
  try {
    action();
    if (approval && Object.is(result, FormSubmissionResult.Submitted)) {
      if (!approval.isApproved()) reject();
      else if (!directSubmitted && !pagePrevented) {
        try {
          replaying = true;
          if (expectedSubmitter) form.requestSubmit(expectedSubmitter);
          else form.requestSubmit();
        } catch {
          reject();
        }
        replaying = false;
      }
    }
  } finally {
    stopDirectObservation();
    form.removeEventListener("submit", mediate, true);
  }
  return result;
}
