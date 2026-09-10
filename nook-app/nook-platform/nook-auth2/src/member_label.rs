//! Optional wire labels retain explicit unnamed membership in the domain.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum MemberLabelState {
    Named(String),
    #[default]
    Unnamed,
}

impl MemberLabelState {
    pub fn is_unnamed(&self) -> bool {
        matches!(self, Self::Unnamed)
    }
    pub fn into_display_text(self) -> String {
        match self {
            Self::Named(label) => label,
            Self::Unnamed => String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi_device_api::{AppKey, MemberEntry};
    use crate::{DeviceSigningPublicKey, IdentityMember};

    #[test]
    fn named_label_roundtrips_as_a_wire_string() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let label = MemberLabelState::Named("Laptop".to_owned());
        let encoded = serde_json::to_string(&label)?;
        assert_eq!(encoded, "\"Laptop\"");
        assert_eq!(serde_json::from_str::<MemberLabelState>(&encoded)?, label);

        let identity_member = IdentityMember {
            app_id: app.app_id().clone(),
            auth_id: app.auth_id(),
            public_key: app.public_key(),
            signing_public_key: DeviceSigningPublicKey::Unavailable,
            label: label.clone(),
        };
        let encoded_identity_member = serde_json::to_string(&identity_member)?;
        assert!(encoded_identity_member.contains("\"label\":\"Laptop\""));
        assert_eq!(
            serde_json::from_str::<IdentityMember>(&encoded_identity_member)?,
            identity_member
        );

        let roster_member = MemberEntry {
            pk_id: app.auth_id(),
            pk: app.public_key(),
            label: label.clone(),
            enrolled_at: String::new(),
        };
        let encoded_roster_member = serde_json::to_string(&roster_member)?;
        assert!(encoded_roster_member.contains("\"label\":\"Laptop\""));
        assert_eq!(
            serde_json::from_str::<MemberEntry>(&encoded_roster_member)?,
            roster_member
        );
        assert!(!label.is_unnamed());
        assert_eq!(label.into_display_text(), "Laptop");
        Ok(())
    }

    #[test]
    fn unnamed_label_roundtrips_as_wire_null() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let label = MemberLabelState::default();
        let encoded = serde_json::to_string(&label)?;
        assert_eq!(encoded, "null");
        assert_eq!(serde_json::from_str::<MemberLabelState>(&encoded)?, label);

        let identity_member = IdentityMember {
            app_id: app.app_id().clone(),
            auth_id: app.auth_id(),
            public_key: app.public_key(),
            signing_public_key: DeviceSigningPublicKey::Unavailable,
            label: label.clone(),
        };
        let mut identity_wire = serde_json::to_value(&identity_member)?;
        assert!(identity_wire.get("label").is_none());
        let serde_json::Value::Object(identity_fields) = &mut identity_wire else {
            return Err(anyhow::anyhow!("identity member wire must be an object"));
        };
        identity_fields.insert("label".to_owned(), serde_json::Value::Null);
        assert_eq!(
            serde_json::from_value::<IdentityMember>(identity_wire)?.label,
            MemberLabelState::Unnamed
        );

        let roster_member = MemberEntry {
            pk_id: app.auth_id(),
            pk: app.public_key(),
            label: label.clone(),
            enrolled_at: String::new(),
        };
        let mut roster_wire = serde_json::to_value(&roster_member)?;
        assert!(roster_wire.get("label").is_none());
        let serde_json::Value::Object(roster_fields) = &mut roster_wire else {
            return Err(anyhow::anyhow!("roster member wire must be an object"));
        };
        roster_fields.insert("label".to_owned(), serde_json::Value::Null);
        assert_eq!(
            serde_json::from_value::<MemberEntry>(roster_wire)?.label,
            MemberLabelState::Unnamed
        );
        assert!(label.is_unnamed());
        assert!(label.into_display_text().is_empty());
        Ok(())
    }
}
