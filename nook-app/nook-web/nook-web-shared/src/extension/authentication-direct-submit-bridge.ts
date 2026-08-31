export const AUTHENTICATION_DIRECT_SUBMIT_EVENT =
  "nook-authentication-direct-submit-v1";

type AuthenticationDirectSubmitHandler = (
  form: HTMLFormElement,
) => boolean;

type AuthenticationDirectSubmitBridgeState = {
  handler?: AuthenticationDirectSubmitHandler;
};

const ISOLATED_BRIDGE_STATE = "__nookAuthenticationDirectSubmitBridgeV1";

function isolatedBridgeState(): AuthenticationDirectSubmitBridgeState {
  const existing = Reflect.get(globalThis, ISOLATED_BRIDGE_STATE);
  if (typeof existing === "object" && existing) {
    return existing as AuthenticationDirectSubmitBridgeState;
  }
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
    if (
      event.type !== AUTHENTICATION_DIRECT_SUBMIT_EVENT ||
      !(event.target instanceof HTMLFormElement)
    ) {
      return;
    }
    const handler = isolatedBridgeState().handler;
    if (handler && !handler(event.target)) event.preventDefault();
  };
  window.addEventListener(AUTHENTICATION_DIRECT_SUBMIT_EVENT, receive, true);
  return () => {
    window.removeEventListener(
      AUTHENTICATION_DIRECT_SUBMIT_EVENT,
      receive,
      true,
    );
  };
}

export function installPageAuthenticationDirectSubmitBridge(): () => void {
  const prototype = HTMLFormElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "submit");
  const nativeSubmit = prototype.submit;
  const bridgedSubmit = function (this: HTMLFormElement): void {
    const eventInit: EventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const event = new Event(AUTHENTICATION_DIRECT_SUBMIT_EVENT, eventInit);
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
