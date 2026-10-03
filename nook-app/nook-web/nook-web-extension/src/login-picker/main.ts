import { Effect, Schema } from 'effect'
import { mount, type ComponentProps, type MountOptions } from 'svelte'
import LoginPicker from '../popup/LoginPicker.svelte'
import { extensionLocaleCatalog } from '../lib/i18n'
import { InlineLoginPickerInitialization } from '../lib/inline-login-picker'
import '../popup/popup.css'

/** Receives one request directly from the parent and renders only the login chooser. */
enum InlineLoginPickerDocumentPhase {
  Waiting = 'waiting',
  Mounted = 'mounted',
}

class InlineLoginPickerDocument {
  private state = InlineLoginPickerDocumentPhase.Waiting

  receive(event: MessageEvent<unknown>): void {
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
    const admission = Schema.decodeUnknownEither(InlineLoginPickerInitialization)(event.data)
    switch (admission._tag) {
      case 'Left':
        return
      case 'Right':
        switch (admission.right.origin === event.origin) {
          case false:
            return
          case true:
            this.state = InlineLoginPickerDocumentPhase.Mounted
            void Effect.runPromise(this.render(admission.right))
        }
    }
  }

  private render(initialization: InlineLoginPickerInitialization) {
    return Effect.promise(async () => {
      const target = document.getElementById('app')
      switch (target instanceof HTMLElement) {
        case false:
          return
        case true: {
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
      }
    })
  }
}

// The document owns one listener for its entire lifetime; pagehide releases it.
const picker = new InlineLoginPickerDocument()
const receive = picker.receive.bind(picker)
window.addEventListener('message', receive)
window.addEventListener('pagehide', () => window.removeEventListener('message', receive), { once: true })
