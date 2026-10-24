import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import {
  PersonalFillMessages,
  PersonalFillPageResponseKind,
  type PersonalFillPageMessage,
  type PersonalFillPageResponse,
} from '../../lib/personal-fill-messages'
import {
  PersonalFillPickerOwnership,
  type PersonalFillInteraction,
} from './personal-fill-interaction'

export enum PersonalFillReception {
  Ignored = 'ignored',
  Responded = 'responded',
}

export interface PersonalFillPageDelivery {
  readonly message: BrowserRuntimeMessageValue
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: (response: PersonalFillPageResponse) => void
}

/** The interaction capabilities the page notices reach. */
export type PersonalFillPageInteraction = Pick<
  PersonalFillInteraction,
  'ownsPicker' | 'selected' | 'canceled'
>

enum PersonalFillPageSender {
  Extension = 'extension',
  Other = 'other',
}

type PersonalFillPageAdmission = {
  readonly delivery: PersonalFillPageDelivery
  readonly message: PersonalFillPageMessage
}

/**
 * Receives the worker's selection and cancellation notices for the page's own
 * personal picker. Only this extension's runtime messages for this origin and
 * an owned request reach the interaction; the notices carry no record data.
 */
export class PersonalFillPageReceiver {
  constructor(private readonly interaction: PersonalFillPageInteraction) {}

  private sender(delivery: PersonalFillPageDelivery): PersonalFillPageSender {
    switch (delivery.sender.id === chrome.runtime.id) {
      case true:
        return PersonalFillPageSender.Extension
      case false:
        return PersonalFillPageSender.Other
    }
  }

  private admitted(
    admission: PersonalFillPageAdmission,
  ): PersonalFillPickerOwnership {
    switch (
      this.sender(admission.delivery) === PersonalFillPageSender.Extension &&
      admission.message.payload.origin === location.origin
    ) {
      case true:
        return this.interaction.ownsPicker(admission.message.payload.requestId)
      case false:
        return PersonalFillPickerOwnership.Unowned
    }
  }

  private acknowledge(
    delivery: PersonalFillPageDelivery,
  ): PersonalFillReception {
    const response: PersonalFillPageResponse = {
      kind: PersonalFillPageResponseKind.Acknowledged,
    }
    delivery.sendResponse(response)
    return PersonalFillReception.Responded
  }

  private receiveSelected(
    delivery: PersonalFillPageDelivery,
  ): PersonalFillReception {
    const selected = PersonalFillMessages.decodeSelected(delivery.message)
    switch (selected._tag) {
      case 'Failure':
        return PersonalFillReception.Ignored
      case 'Success':
        break
    }
    const admission: PersonalFillPageAdmission = {
      delivery,
      message: selected.success,
    }
    switch (this.admitted(admission)) {
      case PersonalFillPickerOwnership.Unowned:
        return PersonalFillReception.Ignored
      case PersonalFillPickerOwnership.Owned:
        void this.interaction.selected(selected.success)
        return this.acknowledge(delivery)
    }
  }

  receive(delivery: PersonalFillPageDelivery): PersonalFillReception {
    const canceled = PersonalFillMessages.decodeCanceled(delivery.message)
    switch (canceled._tag) {
      case 'Failure':
        return this.receiveSelected(delivery)
      case 'Success':
        break
    }
    const admission: PersonalFillPageAdmission = {
      delivery,
      message: canceled.success,
    }
    switch (this.admitted(admission)) {
      case PersonalFillPickerOwnership.Unowned:
        return PersonalFillReception.Ignored
      case PersonalFillPickerOwnership.Owned:
        this.interaction.canceled(canceled.success)
        return this.acknowledge(delivery)
    }
  }
}
