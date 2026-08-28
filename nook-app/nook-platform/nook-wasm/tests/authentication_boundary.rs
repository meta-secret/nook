#![cfg(target_arch = "wasm32")]

use nook_wasm::{
    NookAuthenticationPageObservation, NookAuthenticationPageObservations,
    NookAuthenticationWorkflowMatchState, authentication_workflow_snapshot,
};
use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen_test]
fn reduced_current_password_observation_cannot_forge_login_continuation() {
    let observation =
        NookAuthenticationPageObservation::new(nook_core::AuthenticationPageObservation {
            current_password_field_count: 1,
            advance_control: nook_core::AuthenticationAdvanceControlEvidence::Present,
            ..Default::default()
        });
    let mut observations = NookAuthenticationPageObservations::new();
    observations.add(&observation);

    let workflow = authentication_workflow_snapshot(&observations);
    assert_eq!(
        workflow.state(),
        NookAuthenticationWorkflowMatchState::NoMatch
    );
    assert!(workflow.snapshot().is_err());
}
