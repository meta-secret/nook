export enum PasskeyEntryPointKind {
  SiteControl = 'site-control',
  Unavailable = 'unavailable',
}

type PasskeyEntryPointKindArgs = {
  siteControlPresent: boolean
}

export function passkeyEntryPointKind({
  siteControlPresent,
}: PasskeyEntryPointKindArgs): PasskeyEntryPointKind {
  return siteControlPresent
    ? PasskeyEntryPointKind.SiteControl
    : PasskeyEntryPointKind.Unavailable
}
