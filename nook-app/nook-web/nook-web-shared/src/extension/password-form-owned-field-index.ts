export type OwnedAuthenticationFields = {
  passwordFields: readonly HTMLInputElement[];
  usernameFields: readonly HTMLInputElement[];
  oneTimeCodeFields: readonly HTMLInputElement[];
};

type MutableOwnedAuthenticationFields = {
  passwordFields: HTMLInputElement[];
  usernameFields: HTMLInputElement[];
  oneTimeCodeFields: HTMLInputElement[];
};

export type OwnedAuthenticationFieldsRequest = OwnedAuthenticationFields & {
  owner: HTMLFormElement;
};

const EMPTY_OWNED_AUTHENTICATION_FIELDS: OwnedAuthenticationFields = {
  passwordFields: [],
  usernameFields: [],
  oneTimeCodeFields: [],
};

class OwnedAuthenticationFieldIndex {
  readonly passwordFieldsSource: readonly HTMLInputElement[];
  readonly usernameFieldsSource: readonly HTMLInputElement[];
  readonly oneTimeCodeFieldsSource: readonly HTMLInputElement[];
  private readonly fieldsByOwner = new Map<
    HTMLFormElement,
    MutableOwnedAuthenticationFields
  >();

  constructor(fields: OwnedAuthenticationFields) {
    this.passwordFieldsSource = fields.passwordFields;
    this.usernameFieldsSource = fields.usernameFields;
    this.oneTimeCodeFieldsSource = fields.oneTimeCodeFields;
    for (const field of fields.passwordFields) this.addPassword(field);
    for (const field of fields.usernameFields) this.addUsername(field);
    for (const field of fields.oneTimeCodeFields) this.addOneTimeCode(field);
  }

  matches(fields: OwnedAuthenticationFields): boolean {
    return (
      this.passwordFieldsSource === fields.passwordFields &&
      this.usernameFieldsSource === fields.usernameFields &&
      this.oneTimeCodeFieldsSource === fields.oneTimeCodeFields
    );
  }

  fieldsFor(owner: HTMLFormElement): OwnedAuthenticationFields {
    const fields = this.fieldsByOwner.get(owner);
    return fields ? fields : EMPTY_OWNED_AUTHENTICATION_FIELDS;
  }

  private mutableFieldsFor(
    owner: HTMLFormElement,
  ): MutableOwnedAuthenticationFields {
    const existing = this.fieldsByOwner.get(owner);
    if (existing) return existing;
    const created: MutableOwnedAuthenticationFields = {
      passwordFields: [],
      usernameFields: [],
      oneTimeCodeFields: [],
    };
    this.fieldsByOwner.set(owner, created);
    return created;
  }

  private addPassword(field: HTMLInputElement): void {
    if (field.form)
      this.mutableFieldsFor(field.form).passwordFields.push(field);
  }

  private addUsername(field: HTMLInputElement): void {
    if (field.form)
      this.mutableFieldsFor(field.form).usernameFields.push(field);
  }

  private addOneTimeCode(field: HTMLInputElement): void {
    if (field.form)
      this.mutableFieldsFor(field.form).oneTimeCodeFields.push(field);
  }
}

const indexesByPasswordFieldSource = new WeakMap<
  readonly HTMLInputElement[],
  OwnedAuthenticationFieldIndex
>();

export function ownedAuthenticationFields({
  owner,
  passwordFields,
  usernameFields,
  oneTimeCodeFields,
}: OwnedAuthenticationFieldsRequest): OwnedAuthenticationFields {
  const fields: OwnedAuthenticationFields = {
    passwordFields,
    usernameFields,
    oneTimeCodeFields,
  };
  let index = indexesByPasswordFieldSource.get(passwordFields);
  if (!index || !index.matches(fields)) {
    index = new OwnedAuthenticationFieldIndex(fields);
    indexesByPasswordFieldSource.set(passwordFields, index);
  }
  return index.fieldsFor(owner);
}
