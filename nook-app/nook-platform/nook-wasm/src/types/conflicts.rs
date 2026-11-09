use super::{NookError, wasm_bindgen};
use std::collections::BTreeMap;

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookReplacementCandidate {
    event_id: String,
    secret_id: String,
}

#[wasm_bindgen]
impl NookReplacementCandidate {
    #[wasm_bindgen(getter, js_name = eventId)]
    pub fn event_id(&self) -> String {
        self.event_id.clone()
    }

    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookReplacementConflict {
    old_secret_id: String,
    candidates: Vec<NookReplacementCandidate>,
}

#[wasm_bindgen]
impl NookReplacementConflict {
    #[wasm_bindgen(getter, js_name = oldSecretId)]
    pub fn old_secret_id(&self) -> String {
        self.old_secret_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn candidates(&self) -> Vec<NookReplacementCandidate> {
        self.candidates.clone()
    }

    #[wasm_bindgen(getter, js_name = candidateSecretIds)]
    pub fn candidate_secret_ids(&self) -> Vec<String> {
        self.candidates
            .iter()
            .map(|candidate| candidate.secret_id.clone())
            .collect()
    }
}

impl NookReplacementConflict {
    pub(crate) fn replacement_conflicts_to_vec(
        conflicts: BTreeMap<nook_core::SecretId, nook_core::SecretReplacementConflict>,
    ) -> Result<Vec<NookReplacementConflict>, NookError> {
        conflicts
            .into_values()
            .map(|conflict| {
                Ok(NookReplacementConflict {
                    old_secret_id: conflict.old_secret_id.as_str().to_owned(),
                    candidates: conflict
                        .candidates
                        .into_iter()
                        .map(|(event_id, secret_id)| NookReplacementCandidate {
                            event_id: event_id.as_str().to_owned(),
                            secret_id: secret_id.as_str().to_owned(),
                        })
                        .collect(),
                })
            })
            .collect()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSecurityConflict {
    events: Vec<String>,
    reasons: Vec<String>,
}

#[wasm_bindgen]
impl NookSecurityConflict {
    #[wasm_bindgen]
    pub fn from_display_parts(events: Vec<String>, reasons: Vec<String>) -> Self {
        Self { events, reasons }
    }

    #[wasm_bindgen(getter)]
    pub fn events(&self) -> Vec<String> {
        self.events.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn reasons(&self) -> Vec<String> {
        self.reasons.clone()
    }
}

impl NookSecurityConflict {
    pub(crate) fn security_conflicts_to_vec(
        conflicts: Vec<nook_core::SecurityConflict>,
    ) -> Result<Vec<NookSecurityConflict>, NookError> {
        conflicts
            .into_iter()
            .map(|conflict| {
                Ok(NookSecurityConflict {
                    events: conflict
                        .events
                        .into_iter()
                        .map(|event| event.as_str().to_owned())
                        .collect(),
                    reasons: conflict
                        .reasons
                        .into_iter()
                        .map(|reason| reason.as_str().to_owned())
                        .collect(),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod projection_conflict_tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn replacement_conflict_exposes_candidate_ids_without_web_mapping() {
        let conflict = NookReplacementConflict {
            old_secret_id: "secret-old".to_owned(),
            candidates: vec![
                NookReplacementCandidate {
                    event_id: "event-a".to_owned(),
                    secret_id: "secret-a".to_owned(),
                },
                NookReplacementCandidate {
                    event_id: "event-b".to_owned(),
                    secret_id: "secret-b".to_owned(),
                },
            ],
        };

        assert_eq!(
            conflict.candidate_secret_ids(),
            vec!["secret-a".to_owned(), "secret-b".to_owned()]
        );
    }

    #[wasm_bindgen_test]
    fn security_conflict_display_parts_are_owned_by_wasm() {
        let conflict = NookSecurityConflict::from_display_parts(
            vec!["event-a".to_owned()],
            vec!["password-rotated".to_owned()],
        );

        assert_eq!(conflict.events(), vec!["event-a".to_owned()]);
        assert_eq!(conflict.reasons(), vec!["password-rotated".to_owned()]);
    }
}
