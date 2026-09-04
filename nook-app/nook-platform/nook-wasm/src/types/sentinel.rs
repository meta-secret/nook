use super::{NookVaultArchitecture, wasm_bindgen};
use crate::NookError;
use nook_core::{MultiDeviceError, RemoteEventLogClassification, SentinelGenesisPhase};
use std::mem;
use wasm_bindgen::JsError;

#[wasm_bindgen]
pub struct NookSentinelUnlockSessionStatus {
    active: bool,
    collected: u8,
    threshold: u8,
    ready: bool,
}

#[wasm_bindgen]
impl NookSentinelUnlockSessionStatus {
    #[wasm_bindgen]
    pub fn inactive() -> Self {
        Self {
            active: false,
            collected: 0,
            threshold: 0,
            ready: false,
        }
    }

    pub(crate) fn from_status(status: nook_core::SentinelUnlockStatus) -> Result<Self, JsError> {
        Ok(Self {
            active: true,
            collected: u8::try_from(usize::from(status.collected)).map_err(|_| {
                JsError::new(
                    "Sentinel unlock contribution count exceeds the JavaScript bridge limit.",
                )
            })?,
            threshold: status.threshold.into(),
            ready: matches!(status.readiness, nook_core::SentinelUnlockReadiness::Ready),
        })
    }

    #[wasm_bindgen(getter)]
    pub fn active(&self) -> bool {
        self.active
    }

    #[wasm_bindgen(getter)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `collected` count through a JavaScript Number scalar"
        )
    )]
    pub fn collected(&self) -> u8 {
        self.collected
    }

    #[wasm_bindgen(getter)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `threshold` count through a JavaScript Number scalar"
        )
    )]
    pub fn threshold(&self) -> u8 {
        self.threshold
    }

    #[wasm_bindgen(getter)]
    pub fn ready(&self) -> bool {
        self.ready
    }
}

#[cfg(test)]
mod tests {
    use super::NookSentinelUnlockSessionStatus;
    use nook_core::{SentinelUnlockReadiness, SentinelUnlockStatus};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn unlock_status_bridge_projects_counts_and_rejects_overflow()
    -> Result<(), wasm_bindgen::JsError> {
        let status = SentinelUnlockStatus {
            collected: 2.into(),
            threshold: 3.into(),
            readiness: SentinelUnlockReadiness::Collecting,
        };
        let projected = NookSentinelUnlockSessionStatus::from_status(status)?;
        assert_eq!(projected.collected, 2);

        let overflow = SentinelUnlockStatus {
            collected: 256.into(),
            threshold: 3.into(),
            readiness: SentinelUnlockReadiness::Ready,
        };
        assert!(NookSentinelUnlockSessionStatus::from_status(overflow).is_err());
        Ok(())
    }
}

#[wasm_bindgen]
pub struct NookSentinelStoredDeliverySummary {
    store_id: String,
    session_id: String,
    participant_count: u8,
    threshold: u8,
}

#[wasm_bindgen]
impl NookSentinelStoredDeliverySummary {
    pub(crate) fn from_delivery(
        store_id: String,
        delivery: &nook_core::SentinelGenesisShareDelivery,
    ) -> Self {
        Self {
            store_id,
            session_id: delivery.session_id.as_str().to_owned(),
            participant_count: delivery.policy.participant_count.into(),
            threshold: delivery.policy.threshold.into(),
        }
    }

    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter, js_name = sessionId)]
    pub fn session_id(&self) -> String {
        self.session_id.clone()
    }

    #[wasm_bindgen(getter, js_name = participantCount)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `participant_count` count through a JavaScript Number scalar"
        )
    )]
    pub fn participant_count(&self) -> u8 {
        self.participant_count
    }

    #[wasm_bindgen(getter)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `threshold` count through a JavaScript Number scalar"
        )
    )]
    pub fn threshold(&self) -> u8 {
        self.threshold
    }
}

#[wasm_bindgen]
pub struct NookSentinelGenesisParticipantStatus {
    device_id: String,
    label: String,
    fingerprint: String,
}

#[wasm_bindgen]
impl NookSentinelGenesisParticipantStatus {
    fn from_core(participant: &nook_core::SentinelGenesisParticipant) -> Self {
        Self {
            device_id: participant.device_id.as_str().to_owned(),
            label: participant.label.clone(),
            fingerprint: participant.fingerprint.clone(),
        }
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn fingerprint(&self) -> String {
        self.fingerprint.clone()
    }
}

#[wasm_bindgen]
pub struct NookSentinelGenesisStatus {
    participants: Vec<NookSentinelGenesisParticipantStatus>,
    phase: nook_core::SentinelGenesisPhase,
}

#[wasm_bindgen]
impl NookSentinelGenesisStatus {
    pub(crate) const fn from_phase(phase: nook_core::SentinelGenesisPhase) -> Self {
        Self {
            participants: Vec::new(),
            phase,
        }
    }

    pub(crate) fn from_session(session: &nook_core::SentinelGenesisSession) -> Self {
        Self {
            participants: session
                .participants()
                .iter()
                .map(NookSentinelGenesisParticipantStatus::from_core)
                .collect(),
            phase: SentinelGenesisPhase::from_session(session),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn phase(&self) -> nook_core::SentinelGenesisPhase {
        self.phase
    }

    #[wasm_bindgen(getter)]
    pub fn participants(&mut self) -> Vec<NookSentinelGenesisParticipantStatus> {
        mem::take(&mut self.participants)
    }
}

#[wasm_bindgen]
pub struct NookSentinelGenesisDelivery {
    device_id: String,
    fingerprint: String,
    payload: String,
}

#[wasm_bindgen]
impl NookSentinelGenesisDelivery {
    pub(crate) fn from_core(
        delivery: &nook_core::SentinelGenesisShareDelivery,
        fingerprint: String,
    ) -> Result<Self, crate::NookError> {
        Ok(Self {
            device_id: delivery.device_id.as_str().to_owned(),
            fingerprint,
            payload: serde_json::to_string(delivery)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        })
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn fingerprint(&self) -> String {
        self.fingerprint.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn payload(&self) -> String {
        self.payload.clone()
    }
}

#[wasm_bindgen]
pub struct NookSentinelGenesisFinalizeResult {
    store_id: String,
    architecture: nook_core::VaultArchitecture,
    deliveries: Vec<NookSentinelGenesisDelivery>,
}

#[wasm_bindgen]
pub struct NookEventLogSyncIssue {
    provider_label: String,
    classification: nook_core::RemoteEventLogClassification,
}

#[wasm_bindgen]
impl NookEventLogSyncIssue {
    pub(crate) fn new(
        provider_label: String,
        classification: nook_core::RemoteEventLogClassification,
    ) -> Self {
        Self {
            provider_label,
            classification,
        }
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> String {
        self.provider_label.clone()
    }

    #[wasm_bindgen(getter, js_name = isStoreMismatch)]
    pub fn is_store_mismatch(&self) -> bool {
        matches!(
            self.classification,
            RemoteEventLogClassification::DifferentStore { .. }
        )
    }

    #[wasm_bindgen(getter, js_name = isMultipleStores)]
    pub fn is_multiple_stores(&self) -> bool {
        matches!(
            self.classification,
            RemoteEventLogClassification::MultipleStores { .. }
        )
    }

    #[wasm_bindgen(getter, js_name = localStoreId)]
    pub fn local_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.classification {
            RemoteEventLogClassification::DifferentStore { local_store_id, .. } => {
                Ok(local_store_id.clone())
            }
            _ => Err(JsError::new("event-log issue is not a store mismatch")),
        }
    }

    #[wasm_bindgen(getter, js_name = remoteStoreId)]
    pub fn remote_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.classification {
            RemoteEventLogClassification::DifferentStore {
                remote_store_id, ..
            } => Ok(remote_store_id.clone()),
            _ => Err(JsError::new("event-log issue is not a store mismatch")),
        }
    }

    #[wasm_bindgen(getter, js_name = storeIds)]
    pub fn store_ids(&self) -> Vec<String> {
        match &self.classification {
            RemoteEventLogClassification::MultipleStores { store_ids } => store_ids.clone(),
            _ => Vec::new(),
        }
    }
}

#[wasm_bindgen]
impl NookSentinelGenesisFinalizeResult {
    pub(crate) fn from_core(
        store_id: String,
        architecture: nook_core::VaultArchitecture,
        participants: &[nook_core::SentinelGenesisParticipant],
        deliveries: &[nook_core::SentinelGenesisShareDelivery],
    ) -> Result<Self, crate::NookError> {
        let deliveries = deliveries
            .iter()
            .map(|delivery| {
                let fingerprint = participants
                    .iter()
                    .find(|participant| participant.device_id == delivery.device_id)
                    .map(|participant| participant.fingerprint.clone())
                    .ok_or(MultiDeviceError::InvalidSentinelGenesisPayload)?;
                NookSentinelGenesisDelivery::from_core(delivery, fingerprint)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            store_id,
            architecture,
            deliveries,
        })
    }

    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn phase(&self) -> nook_core::SentinelGenesisPhase {
        SentinelGenesisPhase::DeliveringShares
    }

    #[wasm_bindgen(getter)]
    pub fn architecture(&self) -> NookVaultArchitecture {
        NookVaultArchitecture::from_core(self.architecture.clone())
    }

    #[wasm_bindgen(getter, js_name = participantDeliveries)]
    pub fn participant_deliveries(&mut self) -> Vec<NookSentinelGenesisDelivery> {
        mem::take(&mut self.deliveries)
    }
}
