import type { Component } from "svelte";
import {
  Braces,
  CreditCard,
  Globe,
  KeyRound,
  Paperclip,
  ShieldCheck,
  Sprout,
  StickyNote,
} from "@lucide/svelte";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { NookSecretListItem } from "$lib/nook";
import { SecretType } from "$lib/nook";
import type { VaultState } from "$lib/vault.svelte";

export type SecretItemViewSubject = {
  readonly item: NookSecretListItem;
  readonly vault: VaultState;
};

const MASK = "••••";

/** Titles, subtitles and the type glyph for one secret in the vault list. */
export class SecretItemView {
  constructor(private readonly subject: SecretItemViewSubject) {}

  private t(key: string): string {
    return this.subject.vault.t(key);
  }

  get icon(): Component {
    switch (this.subject.item.type) {
      case SecretType.Login:
        return Globe;
      case SecretType.ApiKey:
        return Braces;
      case SecretType.SeedPhrase:
        return Sprout;
      case SecretType.Authenticator:
        return ShieldCheck;
      case SecretType.Passkey:
        return KeyRound;
      case SecretType.CreditCard:
        return CreditCard;
      case SecretType.FileAttachment:
        return Paperclip;
      case SecretType.SecureNote:
        return StickyNote;
    }
  }

  get typeLabelKey(): string {
    switch (this.subject.item.type) {
      case SecretType.Login:
        return I18N_KEYS.VaultTypesLogin;
      case SecretType.ApiKey:
        return I18N_KEYS.VaultTypesApiKey;
      case SecretType.SeedPhrase:
        return I18N_KEYS.VaultTypesSeedPhrase;
      case SecretType.Authenticator:
        return I18N_KEYS.VaultTypesAuthenticator;
      case SecretType.Passkey:
        return I18N_KEYS.VaultTypesPasskey;
      case SecretType.CreditCard:
        return I18N_KEYS.VaultTypesCreditCard;
      case SecretType.FileAttachment:
        return I18N_KEYS.VaultTypesFileAttachment;
      case SecretType.SecureNote:
        return I18N_KEYS.VaultTypesSecureNote;
    }
  }

  /** Short description used when the item has no better title. */
  get summary(): string {
    const { item, vault } = this.subject;
    switch (item.type) {
      case SecretType.Login:
        return (
          item.username.trim() ||
          item.websiteUrl.trim() ||
          this.t(I18N_KEYS.VaultTypesLogin)
        );
      case SecretType.ApiKey:
        return item.websiteUrl.trim() || this.t(I18N_KEYS.VaultTypesApiKey);
      case SecretType.SeedPhrase: {
        const label =
          item.name.trim() || this.t(I18N_KEYS.VaultFieldsUnnamedSeedPhrase);
        const words = item.seedWordCount;
        if (words !== 12 && words !== 24) return label;
        const wordsArgs: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.VaultFieldsWordsCount,
          replacements: { count: String(words) },
        };
        return `${label} · ${vault.t(wordsArgs)}`;
      }
      case SecretType.Authenticator:
        return item.account.trim() || item.issuer.trim();
      case SecretType.Passkey:
        return (
          item.passkeyUserDisplayName.trim() ||
          item.passkeyUserName.trim() ||
          item.rpId.trim() ||
          this.t(I18N_KEYS.VaultTypesPasskey)
        );
      case SecretType.CreditCard: {
        const last4 = item.last4.trim();
        if (last4) return `${MASK} ${last4}`;
        return item.title.trim() || this.t(I18N_KEYS.VaultFieldsUnnamedCard);
      }
      case SecretType.FileAttachment:
        return (
          item.fileName.trim() ||
          item.title.trim() ||
          this.t(I18N_KEYS.VaultFieldsNoTitle)
        );
      case SecretType.SecureNote:
        return item.title.trim() || this.t(I18N_KEYS.VaultFieldsNoTitle);
    }
  }

  get title(): string {
    const { item } = this.subject;
    switch (item.type) {
      case SecretType.Login:
        return item.websiteHost || this.t(I18N_KEYS.VaultFieldsNoWebsite);
      case SecretType.CreditCard:
        return (
          item.title.trim() ||
          this.summary ||
          this.t(I18N_KEYS.VaultFieldsUnnamedCard)
        );
      case SecretType.FileAttachment:
        return (
          item.title.trim() ||
          item.fileName.trim() ||
          this.t(I18N_KEYS.VaultFieldsNoTitle)
        );
      case SecretType.Authenticator:
        return item.issuer.trim() || this.summary;
      case SecretType.Passkey:
        return item.rpId.trim() || this.summary;
      case SecretType.ApiKey:
      case SecretType.SeedPhrase:
      case SecretType.SecureNote:
        return this.summary;
    }
  }

  /** Second line in the list: the account, or what distinguishes the item. */
  get subtitle(): string {
    const { item } = this.subject;
    switch (item.type) {
      case SecretType.Login:
        return item.username.trim();
      case SecretType.CreditCard:
        return item.title.trim() && item.last4.trim()
          ? `${MASK} ${item.last4.trim()}`
          : "";
      case SecretType.Authenticator:
        return item.issuer.trim() ? item.account.trim() : "";
      case SecretType.Passkey:
        return item.rpId.trim() ? this.summary : "";
      case SecretType.ApiKey:
      case SecretType.SeedPhrase:
      case SecretType.SecureNote:
      case SecretType.FileAttachment:
        return "";
    }
  }
}
