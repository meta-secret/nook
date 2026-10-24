import { Effect } from 'effect'
import { mount, type ComponentProps, type MountOptions } from 'svelte'
import PersonalPicker from './PersonalPicker.svelte'
import { extensionLocaleCatalog } from '../lib/i18n'
import {
  PersonalPickerInitializationCodec,
  type PersonalPickerInitialization,
} from '../lib/personal-fill-messages'
import type { BrowserRuntimeMessageValue } from '../lib/browser-runtime-message'
import '../popup/popup.css'

type PersonalPickerMount = {
  readonly target: HTMLElement
  readonly initialization: PersonalPickerInitialization
}

enum PersonalPickerDocumentPhase {
  Waiting = 'waiting',
  Mounted = 'mounted',
}

/** Receives one request directly from the parent page and renders only the record chooser. */
class PersonalPickerDocument {
  private phase = PersonalPickerDocumentPhase.Waiting

  receive(event: MessageEvent<BrowserRuntimeMessageValue>): void {
    switch (event.source === window.parent && window.parent !== window) {
      case false:
        return
      case true:
        break
    }
    switch (this.phase) {
      case PersonalPickerDocumentPhase.Mounted:
        return
      case PersonalPickerDocumentPhase.Waiting:
        break
    }
    const admission = PersonalPickerInitializationCodec.decode(event.data)
    switch (admission._tag) {
      case 'Failure':
        return
      case 'Success':
        break
    }
    switch (admission.success.origin === event.origin) {
      case false:
        return
      case true:
        this.phase = PersonalPickerDocumentPhase.Mounted
        void Effect.runPromise(this.render(admission.success))
    }
  }

  private render(initialization: PersonalPickerInitialization) {
    return Effect.promise(async () => {
      const target = document.getElementById('app')
      switch (true) {
        case target instanceof HTMLElement: {
          const mountRequest: PersonalPickerMount = { target, initialization }
          return this.mount(mountRequest)
        }
        case true:
          return
      }
    })
  }

  private async mount(request: PersonalPickerMount): Promise<void> {
    const i18n = await extensionLocaleCatalog.initializeExtensionI18n()
    const options: MountOptions<ComponentProps<typeof PersonalPicker>> = {
      target: request.target,
      props: {
        i18n,
        requestId: request.initialization.requestId,
        parentOrigin: request.initialization.origin,
      },
    }
    mount(PersonalPicker, options)
  }
}

// The document owns one listener for its entire lifetime; pagehide releases it.
const picker = new PersonalPickerDocument()
const receive = picker.receive.bind(picker)
window.addEventListener('message', receive)
const pageHideOptions: AddEventListenerOptions = { once: true }
window.addEventListener(
  'pagehide',
  () => window.removeEventListener('message', receive),
  pageHideOptions,
)
