import {
  PersonalPickerFrameMessageType,
  type PersonalPickerInitialization,
} from '../../lib/personal-fill-messages'

export interface PersonalPickerFrameMount {
  readonly requestId: string
  readonly continueButton: HTMLButtonElement
  readonly description: HTMLParagraphElement
  readonly title: string
  readonly cancelLabel: string
  readonly cancel: () => void
}

export interface PersonalPickerFrameSurface {
  close(): void
}

enum PersonalPickerFrameWindow {
  Child = 'child',
  Missing = 'missing',
}

/**
 * Embeds the extension-origin personal picker in the Pilot panel. Record
 * titles render only inside that document; the page keeps the frame element
 * and sends the request nonce to the retained child window alone.
 */
export class PersonalPickerFrame implements PersonalPickerFrameSurface {
  static readonly PAGE_PATH = 'personal-picker/index.html'

  private constructor(private readonly release: () => void) {}

  private static childWindow(
    frame: HTMLIFrameElement,
  ): PersonalPickerFrameWindow {
    switch (
      frame.contentWindow !== window &&
      typeof frame.contentWindow?.postMessage === 'function'
    ) {
      case true:
        return PersonalPickerFrameWindow.Child
      case false:
        return PersonalPickerFrameWindow.Missing
    }
  }

  static mount(request: PersonalPickerFrameMount): PersonalPickerFrame {
    const frame = document.createElement('iframe')
    frame.className = 'inline-login-picker'
    frame.setAttribute('data-testid', 'nook-personal-picker')
    frame.title = request.title
    frame.src = chrome.runtime.getURL(PersonalPickerFrame.PAGE_PATH)
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
      switch (PersonalPickerFrame.childWindow(frame)) {
        case PersonalPickerFrameWindow.Missing:
          return
        case PersonalPickerFrameWindow.Child: {
          const initialization: PersonalPickerInitialization = {
            type: PersonalPickerFrameMessageType.Initialize,
            requestId: request.requestId,
            origin: location.origin,
          }
          targetWindow?.postMessage(initialization, targetOrigin)
        }
      }
    }
    const loadOptions: AddEventListenerOptions = { once: true }
    frame.addEventListener('load', initialize, loadOptions)
    return new PersonalPickerFrame(() => {
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
