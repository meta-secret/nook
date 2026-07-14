# Privacy Policy

**Last updated:** June 27, 2026

## 1. Introduction

Nook is an open-source, client-side password and secrets manager ([meta-secret/nook](https://github.com/meta-secret/nook)). This policy describes how the Nook **web application** handles information when you use it in your browser.

Nook is designed as a **zero-knowledge, local-first** vault. We do not operate a central Nook account service, and we do not receive or store your decrypted secrets on our servers.

## 2. Summary

- Your vault is **encrypted in your browser** before it is saved or synced.
- **Plaintext secrets exist only in your browser's memory** while the vault is unlocked.
- Sync providers (GitHub, Google Drive, and similar) receive **encrypted vault files only**, under credentials you choose.
- **We do not sell your data.** Nook does not include advertising or third-party analytics in the core open-source application described in this repository.

## 3. Information stored on your device

When you use Nook, data is stored **locally in your browser** (IndexedDB and related browser storage), including:

| Data | Purpose |
| --- | --- |
| **Encrypted vault** (`nook_db`) | Your secrets, device roster, and vault metadata, encrypted before storage |
| **Device identity key** | Cryptographic key for this browser/device to participate in the vault |
| **Sync provider settings** (`nook_auth`) | Labels and credentials you save (e.g. GitHub personal access token, Google OAuth access token) so Nook can read/write encrypted vault replicas |
| **Preferences** | e.g. locale, theme |
| **Session flags** | e.g. vault locked state, UI preferences |

You can remove this data by clearing site data for Nook in your browser or uninstalling/clearing the browser profile. **If you clear local data without a sync provider replica, you may lose access to your vault.**

## 4. Information we do not collect

Nook (as open-source client software) **does not**:

- Create or manage a Nook user account on our servers
- Upload decrypted passwords, notes, seed phrases, or API keys to Nook-operated servers
- Host or recover your vault on your behalf
- Have access to your encryption keys in plaintext

If you self-host or deploy Nook, **you** control the hosting environment. This policy describes the application behavior, not your own infrastructure logs.

## 5. Google Drive (optional sync)

If you choose **Sign in with Google**, Nook uses Google Identity Services in the browser to obtain an **OAuth access token**. You choose the provider's storage mode independently of the vault type:

- **Private** provider mode: `https://www.googleapis.com/auth/drive.appdata` — encrypted vault data in a **hidden Google Drive application data folder** associated with your Google account (not in your normal visible Drive files).
- **Shared** provider mode: `https://www.googleapis.com/auth/drive.file` and `https://www.googleapis.com/auth/drive.readonly` — Nook creates or connects a dedicated **My Drive folder**, grants another Google account writer access when requested, and syncs encrypted event files under that folder. Read-only Drive access is required because Google authorizes `drive.file` per user, so a collaborator cannot otherwise read files created by the other account. Nook writes only app-created files in the selected folder. Google may email the invited account about the shared folder.

- The OAuth token is stored **only in your browser** (like a saved GitHub token).
- Nook may read your **Google account email address** from Google's API to show "Signed in as …" in the UI.
- In shared mode, Nook sends the Google account email you enter to Google only to grant that account access to the selected folder.
- Google's handling of your account is governed by [Google's Privacy Policy](https://policies.google.com/privacy).
- Nook sends **ciphertext only** to Google Drive, not plaintext secrets.

You can revoke Nook's access anytime in your [Google Account permissions](https://myaccount.google.com/permissions).

## 6. GitHub (optional sync)

If you connect GitHub, you provide a **personal access token** and repository name. Nook stores the token **in your browser** and uses GitHub's API to read/write an **encrypted vault file** in a repository you control.

- GitHub's handling of your account is governed by [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement).
- Nook sends **ciphertext only** to GitHub, not plaintext secrets.

## 7. Multi-device and backup passwords

Nook supports optional **backup passwords** and **device enrollment** so other browsers can join your vault. Enrollment flows may use QR codes or links that carry **provider connection details and password-entry identifiers**—you should share these only with devices and people you trust.

## 8. Security

Nook uses modern encryption for vault contents (including age-compatible secret encryption). **Lock vault** clears decrypted data from memory but leaves encrypted data and saved provider tokens on disk until you remove them.

Nook is **early-stage software**. Do not use it as your only copy of important credentials unless you also maintain independent backups (e.g. via sync providers you control).

## 9. Children's privacy

Nook is not directed at children under 13 (or the minimum age in your jurisdiction). We do not knowingly collect personal information from children.

## 10. Changes

We may update this policy as Nook evolves. The "Last updated" date will change when we do. Material changes should be reflected in the copy hosted at the URL registered in Google Cloud Console.

## 11. Open source

Nook's source code is available under the MIT License. Security researchers and users can inspect how data is handled in the repository.

## 12. Contact

For privacy questions about the Nook project:

- GitHub: [https://github.com/meta-secret/nook/issues](https://github.com/meta-secret/nook/issues)
- Project site: [https://nokey.sh](https://nokey.sh)
