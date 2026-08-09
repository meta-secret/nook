declare namespace chrome {
  namespace runtime {
    type MessageSender = {
      tab?: tabs.Tab
      frameId?: number
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

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function sendMessage<TResponse = unknown>(
      message: unknown,
      callback: (response: TResponse) => void,
    ): void
    function sendMessage<TResponse = unknown>(
      message: unknown,
    ): Promise<TResponse>

    const onInstalled: {
      addListener(listener: (details: InstalledDetails) => void): void
    }

    const onMessage: {
      addListener(
        // eslint-disable-next-line max-params -- Chrome owns the runtime listener signature.
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void
    }

    const onMessageExternal: {
      addListener(
        // eslint-disable-next-line max-params -- Chrome owns the external listener signature.
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
    // eslint-disable-next-line max-params -- Chrome owns this localization signature.
    function getMessage(
      messageName: string,
      substitutions?: string | string[],
    ): string
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

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function create(createData: CreateData, callback: () => void): void
    function create(createData: CreateData): Promise<unknown>
  }

  namespace tabs {
    type Tab = {
      id?: number
      url?: string
      title?: string
    }

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function query(
      queryInfo: { active?: boolean; currentWindow?: boolean },
      callback: (tabs: Tab[]) => void,
    ): void

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function create(
      createProperties: { url: string },
      callback: (tab: Tab) => void,
    ): void
    function create(createProperties: { url: string }): Promise<Tab>

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function sendMessage<TResponse = unknown>(
      tabId: number,
      message: unknown,
      callback: (response: TResponse) => void,
    ): void
    // eslint-disable-next-line max-params -- Chrome owns this Promise overload.
    function sendMessage<TResponse = unknown>(
      tabId: number,
      message: unknown,
    ): Promise<TResponse>
  }

  namespace storage {
    type StorageArea = {
      get(callback: (items: Record<string, unknown>) => void): void
      get(
        keys?: string | string[] | Record<string, unknown> | null,
        callback?: (items: Record<string, unknown>) => void,
      ): void
      set(items: Record<string, unknown>, callback?: () => void): void
      remove(keys: string | string[], callback?: () => void): void
    }
    const local: StorageArea
    const session: StorageArea
  }
}
