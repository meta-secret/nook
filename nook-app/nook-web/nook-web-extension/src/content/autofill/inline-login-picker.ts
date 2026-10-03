import {
  InlineLoginPickerMessageType,
  type InlineLoginPickerInitialization,
} from '../../lib/inline-login-picker'

interface InlineLoginPickerMount {
  readonly requestId: string
  readonly continueButton: HTMLButtonElement
  readonly description: HTMLParagraphElement
  readonly title: string
  readonly cancelLabel: string
  readonly cancel: () => void
}

export interface InlineLoginPickerSurface {
  close(): void
}

/** Owns the mounted chooser and the exact window that receives its request nonce. */
export class InlineLoginPicker implements InlineLoginPickerSurface {
  private constructor(
    private readonly release: () => void,
  ) {}

  static mount(request: InlineLoginPickerMount): InlineLoginPicker {
    const frame = document.createElement('iframe')
    frame.className = 'inline-login-picker'
    frame.setAttribute('data-testid', 'nook-inline-login-picker')
    frame.title = request.title
    frame.src = chrome.runtime.getURL('login-picker/index.html')
    const targetOrigin = new URL(frame.src).origin
    const previousContinueHidden = request.continueButton.hidden
    const previousDescriptionHidden = request.description.hidden
    request.continueButton.hidden = true
    request.description.hidden = true
    request.description.after(frame)
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'text-button inline-login-picker-cancel'
    cancel.textContent = request.cancelLabel
    cancel.addEventListener('click', request.cancel)
    frame.after(cancel)
    const targetWindow = frame.contentWindow
    const initialize = (): void => {
      switch (targetWindow !== window && typeof targetWindow?.postMessage === 'function') {
        case false:
          return
        case true: {
          const initialization: InlineLoginPickerInitialization = {
            type: InlineLoginPickerMessageType.Initialize,
            requestId: request.requestId,
            origin: location.origin,
          }
          targetWindow?.postMessage(initialization, targetOrigin)
        }
      }
    }
    frame.addEventListener('load', initialize, { once: true })
    return new InlineLoginPicker(() => {
      frame.removeEventListener('load', initialize)
      frame.remove()
      cancel.removeEventListener('click', request.cancel)
      cancel.remove()
      request.continueButton.hidden = previousContinueHidden
      request.description.hidden = previousDescriptionHidden
    })
  }

  close(): void {
    this.release()
  }
}
