const CAPABILITY_MINT_AUTHORITY_TOKEN = Symbol(
  'module-integration-capability-mint-authority',
);
const CAPABILITY_MINT_AUTHORITIES = new WeakSet<object>();
declare const MINT_AUTHORITY_BRAND: unique symbol;
export type ModuleIntegrationCapabilityMintAuthority = Readonly<{
  readonly [MINT_AUTHORITY_BRAND]: true;
}>;

class MintAuthorityPrimitive {
  private constructor(token: symbol) {
    if (token !== CAPABILITY_MINT_AUTHORITY_TOKEN)
      throw new Error('Module integration capability mint authority is invalid.');
    CAPABILITY_MINT_AUTHORITIES.add(this);
  }

  static create(): ModuleIntegrationCapabilityMintAuthority {
    return Object.freeze(
      new MintAuthorityPrimitive(CAPABILITY_MINT_AUTHORITY_TOKEN),
    ) as ModuleIntegrationCapabilityMintAuthority;
  }
}

/** Owns the private authority primitive used to register integration capabilities. */
export function createModuleIntegrationCapabilityMintAuthority(): ModuleIntegrationCapabilityMintAuthority {
  return MintAuthorityPrimitive.create();
}

/** Validates an integration capability registration authority by object identity. */
export function isModuleIntegrationCapabilityMintAuthority(
  authority: object,
): boolean {
  return CAPABILITY_MINT_AUTHORITIES.has(authority);
}
