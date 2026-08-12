export enum OpenCompanionLauncherMessageType {
  NookOpenCompanionLauncher = 'nook:open-companion-launcher',
}

export enum OpenCompanionLauncherIntent {
  Default = 'default',
  Pair = 'pair',
}

export type OpenCompanionLauncherMessage = {
  type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
  payload?: {
    intent: OpenCompanionLauncherIntent.Pair
  }
}

export type NormalizedOpenCompanionLauncherMessage = {
  type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
  intent: OpenCompanionLauncherIntent
}
