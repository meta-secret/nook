export enum WebsitePasskeyCeremony {
  Create = 'create',
  Get = 'get',
}

export enum WebsitePasskeyOptionsMessageType {
  NookWebsitePasskeyOptions = 'nook:website-passkey-options',
}

export enum WebsitePasskeyPerformMessageType {
  NookWebsitePasskeyPerform = 'nook:website-passkey-perform',
}

export enum WebsitePasskeyCancelMessageType {
  NookWebsitePasskeyCancel = 'nook:website-passkey-cancel',
}

export enum WebsitePasskeyOptionsStatus {
  Unavailable = 'unavailable',
  Locked = 'locked',
  Invalid = 'invalid',
  Ready = 'ready',
}
