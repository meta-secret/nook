export enum OpenCompanionLauncherMessageType {
  NookOpenCompanionLauncher = 'nook:open-companion-launcher',
}

export type OpenCompanionLauncherMessage = {
  type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
  payload?: {
    intent: 'pair'
  }
}
