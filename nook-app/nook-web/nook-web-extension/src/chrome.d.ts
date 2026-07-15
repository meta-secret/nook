declare namespace chrome {
  namespace runtime {
    type MessageSender = {
      tab?: tabs.Tab
      id?: string
      url?: string
    }

    type InstalledDetails = {
      reason: 'install' | 'update' | 'chrome_update' | 'shared_module_update'
      previousVersion?: string
    }

    const lastError: { message?: string } | undefined
    const id: string

    function getURL(path: string): string

    function sendMessage<TResponse = unknown>(
      message: unknown,
      callback?: (response: TResponse) => void,
    ): void

    const onInstalled: {
      addListener(listener: (details: InstalledDetails) => void): void
    }

    const onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void
    }

    const onMessageExternal: {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void
    }
  }

  namespace offscreen {
    function createDocument(options: {
      url: string
      reasons: Array<'WORKERS'>
      justification: string
    }): Promise<void>

    function closeDocument(): Promise<void>
  }

  namespace i18n {
    function getUILanguage(): string
    function getMessage(messageName: string): string
  }

  namespace action {
    const onClicked: {
      addListener(listener: (tab: tabs.Tab) => void): void
    }
  }

  namespace windows {
    type CreateData = {
      url: string
      type?: 'normal' | 'popup' | 'panel' | 'detached_panel'
      width?: number
      height?: number
      focused?: boolean
    }

    function create(createData: CreateData, callback?: () => void): void
  }

  namespace tabs {
    type Tab = {
      id?: number
      url?: string
      title?: string
    }

    function query(
      queryInfo: { active?: boolean; currentWindow?: boolean },
      callback: (tabs: Tab[]) => void,
    ): void

    function create(createProperties: { url: string }): void

    function sendMessage<TResponse = unknown>(
      tabId: number,
      message: unknown,
      callback?: (response: TResponse) => void,
    ): void
  }

  namespace storage {
    const local: {
      get(
        keys?: string | string[] | Record<string, unknown> | null,
        callback?: (items: Record<string, unknown>) => void,
      ): void
      set(items: Record<string, unknown>, callback?: () => void): void
      remove(keys: string | string[], callback?: () => void): void
    }
  }
}
