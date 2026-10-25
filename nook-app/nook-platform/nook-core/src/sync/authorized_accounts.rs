//! Accounts authorized to reach a shared sync-provider target.
//!
//! Google Drive and iCloud providers are always shared. Their access list is
//! the provider's own sharing state — the vault folder's Drive permissions or
//! the `CloudKit` share's participants — so Nook keeps no second copy of it.
//! Adding a device names one account from this list; the new device signs in
//! with that account and the provider grants access, never an invite secret.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::{ValidationError, ValidationResult};
use nook_auth2::EnrollmentEmail;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// A plausible account email, compared case-insensitively. Values crossing the
/// web boundary are validated again when they are deserialized.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String", into = "String")]
pub struct AuthorizedAccountEmail(String);

impl TryFrom<String> for AuthorizedAccountEmail {
    type Error = ValidationError;
    fn try_from(value: String) -> ValidationResult<Self> {
        Self::parse(&value)
    }
}

impl From<AuthorizedAccountEmail> for String {
    fn from(email: AuthorizedAccountEmail) -> Self {
        email.0
    }
}

impl AuthorizedAccountEmail {
    pub fn parse(value: &str) -> ValidationResult<Self> {
        let value = value.trim();
        if value.is_empty() {
            return Err(ValidationError::SharedJoinerIdentityRequired);
        }
        EnrollmentEmail { value }
            .check_plausibility()
            .map_err(|_| ValidationError::SharedJoinerIdentityInvalid)?;
        Ok(Self(value.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn matches(&self, other: &str) -> bool {
        self.0.eq_ignore_ascii_case(other.trim())
    }
}

/// What an authorized account may do with the shared target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum AuthorizedAccountRole {
    Owner,
    Writer,
    Reader,
}

impl AuthorizedAccountRole {
    /// A device syncs by writing events, so only writers can join with it.
    #[must_use]
    pub const fn can_write(self) -> bool {
        matches!(self, Self::Owner | Self::Writer)
    }
}

/// Whether the account has taken up its access yet. Drive permissions are
/// active at once; a `CloudKit` participant must accept the share.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum AuthorizedAccountStatus {
    Active,
    Invited,
}

/// One account with access to the shared target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedAccount {
    pub email: AuthorizedAccountEmail,
    pub role: AuthorizedAccountRole,
    pub status: AuthorizedAccountStatus,
    /// The provider's handle for this access: the Drive permission id or the
    /// `CloudKit` participant id. It is not a credential.
    pub access_id: String,
}

/// The provider's access list in display order: the owner first, then by email.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedAccountList {
    pub accounts: Vec<AuthorizedAccount>,
}

impl AuthorizedAccountList {
    fn ordered(mut accounts: Vec<AuthorizedAccount>) -> Self {
        accounts.sort_by(|left, right| {
            left.role.cmp(&right.role).then_with(|| {
                left.email
                    .as_str()
                    .to_ascii_lowercase()
                    .cmp(&right.email.as_str().to_ascii_lowercase())
            })
        });
        accounts.dedup_by(|later, earlier| earlier.email.matches(later.email.as_str()));
        Self { accounts }
    }

    fn find(&self, email: &str) -> Option<&AuthorizedAccount> {
        self.accounts
            .iter()
            .find(|account| account.email.matches(email))
    }

    /// The account a device invite names. It must already be on the list with
    /// write access, so the new device can sync as soon as it signs in.
    pub fn invite_account(&self, email: &str) -> ValidationResult<&AuthorizedAccount> {
        let account = self
            .find(email)
            .ok_or(ValidationError::AuthorizedAccountMissing)?;
        if !account.role.can_write() {
            return Err(ValidationError::AuthorizedAccountReadOnly);
        }
        Ok(account)
    }

    /// The account to add. Adding one that already has access is rejected so
    /// the provider is not asked to share twice.
    pub fn addition(&self, email: &str) -> ValidationResult<AuthorizedAccountEmail> {
        let email = AuthorizedAccountEmail::parse(email)?;
        if self.find(email.as_str()).is_some() {
            return Err(ValidationError::AuthorizedAccountExists);
        }
        Ok(email)
    }

    /// The access to revoke. The owner's access belongs to the target itself
    /// and cannot be removed from Nook.
    pub fn removal(&self, email: &str) -> ValidationResult<&AuthorizedAccount> {
        let account = self
            .find(email)
            .ok_or(ValidationError::AuthorizedAccountMissing)?;
        if account.role == AuthorizedAccountRole::Owner {
            return Err(ValidationError::AuthorizedAccountOwner);
        }
        Ok(account)
    }
}

/// One entry of a Drive `permissions.list` response.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", default)]
pub struct DrivePermissionObservation {
    pub id: String,
    #[serde(rename = "type")]
    pub permission_type: String,
    pub role: String,
    pub email_address: String,
    pub deleted: bool,
}

impl DrivePermissionObservation {
    fn account(&self) -> Option<AuthorizedAccount> {
        if self.deleted || self.permission_type != "user" || self.id.trim().is_empty() {
            return None;
        }
        let role = match self.role.as_str() {
            "owner" | "organizer" => AuthorizedAccountRole::Owner,
            "writer" | "fileOrganizer" => AuthorizedAccountRole::Writer,
            "commenter" | "reader" => AuthorizedAccountRole::Reader,
            _ => return None,
        };
        Some(AuthorizedAccount {
            email: AuthorizedAccountEmail::parse(&self.email_address).ok()?,
            role,
            status: AuthorizedAccountStatus::Active,
            access_id: self.id.trim().to_owned(),
        })
    }
}

impl AuthorizedAccountList {
    /// Individual Google accounts with access to the vault folder. Domain,
    /// group, and link permissions do not name an account a device can use.
    #[must_use]
    pub fn from_drive_permissions(permissions: &[DrivePermissionObservation]) -> Self {
        Self::ordered(
            permissions
                .iter()
                .filter_map(DrivePermissionObservation::account)
                .collect(),
        )
    }
}

/// One participant of a `CloudKit` share as `CloudKit` JS reports it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", default)]
pub struct ICloudParticipantObservation {
    pub participant_id: String,
    /// `OWNER`, `ADMINISTRATOR`, `PRIVATE_USER`, or `PUBLIC_USER`.
    #[serde(rename = "type")]
    pub participant_type: String,
    /// `READ_WRITE` or `READ_ONLY`.
    pub permission: String,
    /// `ACCEPTED`, `INVITED`, `PENDING`, or `REMOVED`.
    pub acceptance_status: String,
    pub email_address: String,
}

impl ICloudParticipantObservation {
    fn account(&self) -> Option<AuthorizedAccount> {
        let status = match self.acceptance_status.as_str() {
            "ACCEPTED" => AuthorizedAccountStatus::Active,
            "INVITED" | "PENDING" => AuthorizedAccountStatus::Invited,
            _ => return None,
        };
        let role = match (self.participant_type.as_str(), self.permission.as_str()) {
            ("OWNER", _) => AuthorizedAccountRole::Owner,
            (_, "READ_WRITE") => AuthorizedAccountRole::Writer,
            (_, "READ_ONLY") => AuthorizedAccountRole::Reader,
            _ => return None,
        };
        Some(AuthorizedAccount {
            email: AuthorizedAccountEmail::parse(&self.email_address).ok()?,
            role,
            status,
            access_id: self.participant_id.trim().to_owned(),
        })
    }
}

/// The participants a fetched `CloudKit` share reports.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ICloudShareObservation {
    pub participants: Vec<ICloudParticipantObservation>,
}

impl AuthorizedAccountList {
    /// iCloud accounts the share names by email. A participant `CloudKit`
    /// reports without an email cannot be picked for a device invite.
    #[must_use]
    pub fn from_icloud_participants(participants: &[ICloudParticipantObservation]) -> Self {
        Self::ordered(
            participants
                .iter()
                .filter_map(ICloudParticipantObservation::account)
                .collect(),
        )
    }
}

/// The joining device must sign in with the account its invite names, or it
/// would sync under an account the owner never authorized.
pub struct JoinerAccountCheck<'a> {
    pub invited: &'a str,
    pub signed_in: &'a str,
}

impl JoinerAccountCheck<'_> {
    pub fn verify(self) -> ValidationResult<()> {
        let invited = AuthorizedAccountEmail::parse(self.invited)?;
        if invited.matches(self.signed_in) {
            Ok(())
        } else {
            Err(ValidationError::JoinerAccountMismatch)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drive(id: &str, kind: &str, role: &str, email: &str) -> DrivePermissionObservation {
        DrivePermissionObservation {
            id: id.to_owned(),
            permission_type: kind.to_owned(),
            role: role.to_owned(),
            email_address: email.to_owned(),
            deleted: false,
        }
    }

    fn participant(
        kind: &str,
        permission: &str,
        status: &str,
        email: &str,
    ) -> ICloudParticipantObservation {
        ICloudParticipantObservation {
            participant_id: format!("p-{email}"),
            participant_type: kind.to_owned(),
            permission: permission.to_owned(),
            acceptance_status: status.to_owned(),
            email_address: email.to_owned(),
        }
    }

    fn emails(list: &AuthorizedAccountList) -> Vec<&str> {
        list.accounts
            .iter()
            .map(|account| account.email.as_str())
            .collect()
    }

    #[test]
    fn drive_access_lists_only_individual_accounts_owner_first() {
        let mut deleted = drive("gone", "user", "writer", "gone@example.com");
        deleted.deleted = true;
        let list = AuthorizedAccountList::from_drive_permissions(&[
            drive("w2", "user", "writer", "zoe@example.com"),
            drive("anyone", "anyone", "reader", ""),
            drive("domain", "domain", "writer", "example.com"),
            drive("o", "user", "owner", "owner@example.com"),
            drive("r", "user", "reader", "Reader@Example.com"),
            drive("w1", "user", "writer", "amy@example.com"),
            drive("dup", "user", "writer", "AMY@example.com"),
            drive("bad", "user", "writer", "not-an-email"),
            deleted,
        ]);
        assert_eq!(
            emails(&list),
            vec![
                "owner@example.com",
                "amy@example.com",
                "zoe@example.com",
                "Reader@Example.com",
            ]
        );
        assert!(
            list.accounts
                .iter()
                .all(|account| account.status == AuthorizedAccountStatus::Active)
        );
        assert_eq!(
            list.accounts
                .get(1)
                .map(|account| account.access_id.as_str()),
            Some("w1")
        );
    }

    #[test]
    fn icloud_access_lists_named_participants_and_pending_invites() {
        let list = AuthorizedAccountList::from_icloud_participants(&[
            participant("OWNER", "READ_WRITE", "ACCEPTED", "owner@icloud.com"),
            participant("PRIVATE_USER", "READ_WRITE", "INVITED", "new@icloud.com"),
            participant("PRIVATE_USER", "READ_ONLY", "ACCEPTED", "viewer@icloud.com"),
            participant("PRIVATE_USER", "READ_WRITE", "REMOVED", "left@icloud.com"),
            participant("PRIVATE_USER", "READ_WRITE", "ACCEPTED", ""),
        ]);
        assert_eq!(
            emails(&list),
            vec!["owner@icloud.com", "new@icloud.com", "viewer@icloud.com"]
        );
        assert_eq!(
            list.accounts.get(1).map(|account| account.status),
            Some(AuthorizedAccountStatus::Invited)
        );
        assert_eq!(
            list.accounts.get(2).map(|account| account.role),
            Some(AuthorizedAccountRole::Reader)
        );
    }

    #[test]
    fn invites_name_a_listed_account_with_write_access() -> anyhow::Result<()> {
        let list = AuthorizedAccountList::from_drive_permissions(&[
            drive("o", "user", "owner", "owner@example.com"),
            drive("w", "user", "writer", "member@example.com"),
            drive("r", "user", "reader", "viewer@example.com"),
        ]);
        assert_eq!(list.invite_account(" MEMBER@example.com ")?.access_id, "w");
        assert_eq!(list.invite_account("owner@example.com")?.access_id, "o");
        assert_eq!(
            list.invite_account("viewer@example.com"),
            Err(ValidationError::AuthorizedAccountReadOnly)
        );
        assert_eq!(
            list.invite_account("stranger@example.com"),
            Err(ValidationError::AuthorizedAccountMissing)
        );
        Ok(())
    }

    #[test]
    fn additions_and_removals_respect_the_existing_list() -> anyhow::Result<()> {
        let list = AuthorizedAccountList::from_drive_permissions(&[
            drive("o", "user", "owner", "owner@example.com"),
            drive("w", "user", "writer", "member@example.com"),
        ]);
        assert_eq!(
            list.addition(" new@example.com ")?.as_str(),
            "new@example.com"
        );
        assert_eq!(
            list.addition("Member@example.com"),
            Err(ValidationError::AuthorizedAccountExists)
        );
        assert_eq!(
            list.addition(""),
            Err(ValidationError::SharedJoinerIdentityRequired)
        );
        assert_eq!(
            list.addition("nope"),
            Err(ValidationError::SharedJoinerIdentityInvalid)
        );
        assert_eq!(list.removal("member@example.com")?.access_id, "w");
        assert_eq!(
            list.removal("owner@example.com"),
            Err(ValidationError::AuthorizedAccountOwner)
        );
        assert_eq!(
            list.removal("stranger@example.com"),
            Err(ValidationError::AuthorizedAccountMissing)
        );
        Ok(())
    }

    #[test]
    fn deserialized_lists_reject_implausible_emails() -> anyhow::Result<()> {
        let valid = serde_json::json!({
            "accounts": [{
                "email": "member@example.com",
                "role": "writer",
                "status": "active",
                "accessId": "w"
            }]
        });
        let list: AuthorizedAccountList = serde_json::from_value(valid)?;
        assert_eq!(emails(&list), vec!["member@example.com"]);
        let forged = serde_json::json!({
            "accounts": [{
                "email": "not-an-email",
                "role": "owner",
                "status": "active",
                "accessId": "o"
            }]
        });
        assert!(serde_json::from_value::<AuthorizedAccountList>(forged).is_err());
        Ok(())
    }

    #[test]
    fn joiners_must_sign_in_with_the_invited_account() {
        assert!(
            JoinerAccountCheck {
                invited: "Member@Example.com",
                signed_in: " member@example.com ",
            }
            .verify()
            .is_ok()
        );
        assert_eq!(
            JoinerAccountCheck {
                invited: "member@example.com",
                signed_in: "other@example.com",
            }
            .verify(),
            Err(ValidationError::JoinerAccountMismatch)
        );
        assert_eq!(
            JoinerAccountCheck {
                invited: "member@example.com",
                signed_in: "",
            }
            .verify(),
            Err(ValidationError::JoinerAccountMismatch)
        );
    }
}
