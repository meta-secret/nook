use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(js_name = projectSummary)]
#[must_use]
pub fn project_summary() -> String {
    nook_core::project_summary()
}

#[wasm_bindgen(js_name = workspaceProjectsJson)]
#[must_use]
pub fn workspace_projects_json() -> String {
    serde_json::to_string(nook_core::workspace_projects()).unwrap_or_else(|_| "[]".to_owned())
}
