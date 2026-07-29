export type SentinelDashboard = "card-stack" | "terminal";

type SentinelDashboardPortalParameters = {
  active: boolean;
  dashboard: SentinelDashboard | void;
};

export function sentinelDashboardPortal(
  node: HTMLElement,
  parameters: SentinelDashboardPortalParameters,
) {
  const anchor = document.createComment("sentinel-dashboard-home");
  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");
  const siblingInertState: Array<[HTMLElement, boolean]> = [];
  let active = false;
  let previousFocus: ValueState<HTMLElement> = EMPTY_VALUE;
  let returnFocusTestId = "sentinel-dashboard-card-stack";
  node.before(anchor);

  function focusableElements() {
    return Array.from(
      node.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => Boolean(element.offsetParent));
  }

  function trapFocus(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const elements = focusableElements();
    if (elements.length === 0) {
      event.preventDefault();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    const focused = document.activeElement;
    if (event.shiftKey && (focused === first || !node.contains(focused))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && focused === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function setBackgroundInert(inert: boolean) {
    for (const sibling of Array.from(document.body.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === node) continue;
      if (inert) {
        siblingInertState.push([sibling, sibling.inert]);
        sibling.inert = true;
      }
    }
    if (!inert) {
      for (const [sibling, wasInert] of siblingInertState) {
        sibling.inert = wasInert;
      }
      siblingInertState.length = 0;
    }
  }

  function activate(dashboard: SentinelDashboard | void) {
    returnFocusTestId =
      dashboard === "terminal"
        ? "sentinel-dashboard-terminal"
        : "sentinel-dashboard-card-stack";
    previousFocus =
      document.activeElement instanceof HTMLElement
        ? presentValue(document.activeElement)
        : EMPTY_VALUE;
    document.body.appendChild(node);
    setBackgroundInert(true);
    node.addEventListener("keydown", trapFocus);
    requestAnimationFrame(() => {
      node
        .querySelector<HTMLElement>("[data-sentinel-dashboard-focus]")
        ?.focus();
    });
    active = true;
  }

  function deactivate() {
    node.removeEventListener("keydown", trapFocus);
    setBackgroundInert(false);
    anchor.parentNode?.insertBefore(node, anchor.nextSibling);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (
          previousFocus.kind === "present" &&
          previousFocus.value.isConnected
        ) {
          previousFocus.value.focus();
        } else {
          node
            .querySelector<HTMLElement>(`[data-testid="${returnFocusTestId}"]`)
            ?.focus();
        }
        previousFocus = EMPTY_VALUE;
      });
    });
    active = false;
  }

  function update(next: SentinelDashboardPortalParameters) {
    if (next.active === active) return;
    if (next.active) {
      activate(next.dashboard);
    } else {
      deactivate();
    }
  }

  update(parameters);
  return {
    update,
    destroy() {
      if (active) {
        node.removeEventListener("keydown", trapFocus);
        setBackgroundInert(false);
        if (previousFocus.kind === "present") previousFocus.value.focus();
      }
      node.remove();
      anchor.remove();
    },
  };
}
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from "../../../../explicit-state";
