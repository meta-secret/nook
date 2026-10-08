import { Effect, Schema } from 'effect'
import { mount, type ComponentProps, type MountOptions } from 'svelte'
import LoginPicker from '../popup/LoginPicker.svelte'
import { extensionLocaleCatalog } from '../lib/i18n'
import { InlineLoginPickerInitialization } from '../lib/inline-login-picker'
import type { BrowserRuntimeMessageValue } from '../lib/browser-runtime-message'
import '../popup/popup.css'

/** Receives one request directly from the parent and renders only the login chooser. */
enum InlineLoginPickerDocumentPhase {
  Waiting = 'waiting',
  Mounted = 'mounted',
}

class InlineLoginPickerDocument {
  private state = InlineLoginPickerDocumentPhase.Waiting

  receive(event: MessageEvent<BrowserRuntimeMessageValue>): void {
    switch (event.source === window.parent && window.parent !== window) {
      case false:
        return
      case true:
        break
    }
    switch (this.state) {
      case InlineLoginPickerDocumentPhase.Mounted:
        return
      case InlineLoginPickerDocumentPhase.Waiting:
        break
    }
    const admission = Schema.decodeUnknownResult(
      InlineLoginPickerInitialization,
    )(event.data)
    switch (admission._tag) {
      case 'Failure':
        return
      case 'Success':
        switch (admission.success.origin === event.origin) {
          case false:
            return
          case true:
            this.state = InlineLoginPickerDocumentPhase.Mounted
            void Effect.runPromise(this.render(admission.success))
        }
    }
  }

  private render(initialization: InlineLoginPickerInitialization) {
    return Effect.promise(async () => {
      const target = document.getElementById('app')
      if (target instanceof HTMLElement) {
        const i18n = await extensionLocaleCatalog.initializeExtensionI18n()
        const options: MountOptions<ComponentProps<typeof LoginPicker>> = {
          target,
          props: {
            i18n,
            requestId: initialization.requestId,
            parentOrigin: initialization.origin,
          },
        }
        mount(LoginPicker, options)
      }
    })
  }
}

// The document owns one listener for its entire lifetime; pagehide releases it.
const picker = new InlineLoginPickerDocument()
const receive = picker.receive.bind(picker)
window.addEventListener('message', receive)
const pageHideOptions: AddEventListenerOptions = { once: true }
window.addEventListener(
  'pagehide',
  () => window.removeEventListener('message', receive),
  pageHideOptions,
)
