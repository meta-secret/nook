//! Generator module to convert a YAML graph definition into compile-time Rust code using `quote!`.

use heck::ToUpperCamelCase;
use proc_macro2::{Ident, Span, TokenStream};
use quote::quote;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Deserialize, Serialize)]
pub struct GraphYaml {
    pub graph: BTreeMap<String, BTreeMap<String, serde_yaml::Value>>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct TaskNodeSpecWrapper {
    #[serde(default)]
    pub attrs: TaskAttrs,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default = "default_retries")]
    pub retries: usize,
    #[serde(default)]
    pub output: TaskOutputReference,
    #[serde(default)]
    pub error: TaskErrorReference,
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(untagged)]
pub enum TaskOutputReference {
    Named(String),
    #[default]
    Automatic,
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(untagged)]
pub enum TaskErrorReference {
    Named(String),
    #[default]
    NotDeclared,
}

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct TaskAttrs {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Deserialize, Serialize, Default, Clone)]
pub struct PayloadSpec {
    #[serde(default)]
    pub attrs: Vec<String>,
}

fn default_retries() -> usize {
    1
}

fn to_ident(s: &str) -> Ident {
    Ident::new(s, Span::call_site())
}

fn to_pascal_ident(s: &str) -> Ident {
    Ident::new(&s.to_upper_camel_case(), Span::call_site())
}

fn generate_payload_tokens(struct_ident: &Ident, attrs: &[String]) -> TokenStream {
    if attrs.is_empty() {
        quote! {
            #[derive(Debug, Clone, Default)]
            pub struct #struct_ident {
                pub payload: String,
            }
        }
    } else {
        let field_names: Vec<_> = attrs.iter().map(|a| to_ident(a)).collect();
        let field_types: Vec<_> = attrs
            .iter()
            .map(|a| {
                if a == "passed" {
                    to_ident("bool")
                } else if a.contains("count") {
                    to_ident("u32")
                } else {
                    to_ident("String")
                }
            })
            .collect();

        quote! {
            #[derive(Debug, Clone, Default)]
            pub struct #struct_ident {
                #( pub #field_names: #field_types, )*
            }
        }
    }
}

/// Generates strongly-typed, compile-time self-orchestrating Rust task code using `quote!`.
pub fn generate_rust_code(yaml_content: &str) -> Result<String, Box<dyn std::error::Error>> {
    let parsed: GraphYaml = serde_yaml::from_str(yaml_content)?;
    let mut mod_tokens = TokenStream::new();

    for (domain_name, domain_map) in &parsed.graph {
        let mod_ident = to_ident(domain_name);

        let (_task_key, task_val) = domain_map
            .iter()
            .find(|(k, _)| k.ends_with("_task") || k.contains("task"))
            .ok_or_else(|| format!("Domain '{}' is missing a task definition", domain_name))?;

        let task_spec: TaskNodeSpecWrapper = if task_val.get("task").is_some() {
            let task_inner = &task_val["task"];
            let mut spec: TaskNodeSpecWrapper = serde_yaml::from_value(task_inner.clone())?;
            if let Some(out_val) = task_val.get("output") {
                spec.output = TaskOutputReference::Named(
                    out_val
                        .as_str()
                        .ok_or("task output reference must be a string")?
                        .to_owned(),
                );
            }
            if let Some(err_val) = task_val.get("error") {
                spec.error = TaskErrorReference::Named(
                    err_val
                        .as_str()
                        .ok_or("task error reference must be a string")?
                        .to_owned(),
                );
            }
            spec
        } else {
            serde_yaml::from_value(task_val.clone())?
        };

        let task_id = if task_spec.attrs.id.is_empty() {
            domain_name.as_str()
        } else {
            &task_spec.attrs.id
        };

        let task_ident = to_pascal_ident(&format!("{}_task", task_id));
        let description = &task_spec.attrs.description;
        let retries = task_spec.retries;

        let output_key = match &task_spec.output {
            TaskOutputReference::Named(key) => key.clone(),
            TaskOutputReference::Automatic => format!("{}_output", task_id),
        };

        let output_spec: PayloadSpec = domain_map
            .get(&output_key)
            .map(|v| serde_yaml::from_value(v.clone()).unwrap_or_default())
            .unwrap_or_default();

        let output_ident = to_pascal_ident(&output_key);
        let output_tokens = generate_payload_tokens(&output_ident, &output_spec.attrs);

        let error_tokens = match &task_spec.error {
            TaskErrorReference::Named(err_key) => {
                let err_spec: PayloadSpec = domain_map
                    .get(err_key)
                    .map(|v| serde_yaml::from_value(v.clone()).unwrap_or_default())
                    .unwrap_or_default();
                let err_ident = to_pascal_ident(err_key);
                generate_payload_tokens(&err_ident, &err_spec.attrs)
            }
            TaskErrorReference::NotDeclared => quote! {},
        };

        let retriable_impl = quote! {
            impl RetriableTask for #task_ident {
                fn max_retries(&self) -> usize {
                    #retries
                }
            }
        };

        let task_item = if task_spec.depends_on.is_empty() {
            quote! {
                #output_tokens
                #error_tokens

                #[doc = #description]
                #[derive(Debug, Clone, Copy, Default)]
                pub struct #task_ident;

                impl Task for #task_ident {
                    type Output = #output_ident;

                    fn execute(&self, prompt: &Prompt) -> TaskResult<Self::Output> {
                        println!(concat!("[Task: ", stringify!(#task_ident), "] Executing prompt: {}"), prompt.text);
                        Agent.call(prompt);
                        Ok(#output_ident::default())
                    }
                }

                #retriable_impl
            }
        } else {
            let deps_ident = to_pascal_ident(&format!("{}_deps", task_id));
            let dep_fields: Vec<_> = task_spec
                .depends_on
                .iter()
                .map(|d| to_ident(&d.replace("_task", "")))
                .collect();
            let dep_types: Vec<_> = task_spec
                .depends_on
                .iter()
                .map(|d| {
                    let dep_mod = to_ident(&d.replace("_task", ""));
                    let dep_task = to_pascal_ident(d);
                    quote! { super::#dep_mod::#dep_task }
                })
                .collect();

            let exec_calls = task_spec.depends_on.iter().map(|d| {
                let field_ident = to_ident(&d.replace("_task", ""));
                quote! { let _ = self.deps.#field_ident.execute(prompt)?; }
            });

            quote! {
                #output_tokens
                #error_tokens

                #[derive(Debug, Clone, Copy, Default)]
                pub struct #deps_ident {
                    #( pub #dep_fields: #dep_types, )*
                }

                #[doc = #description]
                #[derive(Debug, Clone, Copy, Default)]
                pub struct #task_ident {
                    pub deps: #deps_ident,
                }

                impl Task for #task_ident {
                    type Output = #output_ident;

                    fn execute(&self, prompt: &Prompt) -> TaskResult<Self::Output> {
                        #( #exec_calls )*
                        println!(concat!("[Task: ", stringify!(#task_ident), "] Executing prompt: {}"), prompt.text);
                        Agent.call(prompt);
                        Ok(#output_ident::default())
                    }
                }

                #retriable_impl
            }
        };

        let mod_item = quote! {
            pub mod #mod_ident {
                use crate::{Agent, Prompt, RetriableTask, Task, TaskResult};

                #task_item
            }
        };

        mod_tokens.extend(mod_item);
    }

    let code = quote! {
        //! Auto-generated task dependency graph from YAML.

        #mod_tokens
    };

    let syntax_tree = syn::parse_file(&code.to_string())?;
    let formatted = prettyplease::unparse(&syntax_tree);

    Ok(formatted)
}

/// Reads a YAML file from disk and returns the generated Rust source code string.
pub fn generate_from_file<P: AsRef<Path>>(path: P) -> Result<String, Box<dyn std::error::Error>> {
    let content = std::fs::read_to_string(path)?;
    generate_rust_code(&content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_yaml_generator_with_quote() {
        let yaml = r#"
graph:
  architecture:
    architecture_task:
      attrs:
        id: "architecture"
        description: "Design the architecture of the system."
      depends_on:
      output: architecture_output

    architecture_output:
      attrs:
        - design_doc

  backend:
    backend_task:
      attrs:
        id: "backend"
        description: "Implement backend services."
      depends_on:
        - architecture_task
      output: backend_output

    backend_output:
      attrs:
        - source_code

  unit_test:
    unit_test_task:
      attrs:
        id: "unit_test"
        description: "Run unit test suite."
      depends_on:
        - backend_task
      retries: 3
      output: unit_test_output
      error: unit_test_error

    unit_test_output:
      attrs:
        - test_logs
        - passed

    unit_test_error:
      attrs:
        - failed_test_count
        - error_log
"#;

        let code = generate_rust_code(yaml).expect("Failed to generate code with quote");
        assert!(code.contains("pub mod architecture"));
        assert!(code.contains("pub struct ArchitectureTask"));
        assert!(code.contains("pub struct BackendTask"));
        assert!(code.contains("pub struct UnitTestTask"));
        assert!(code.contains("pub struct UnitTestOutput"));
        assert!(code.contains("pub struct UnitTestError"));
        assert!(code.contains("pub test_logs: String"));
        assert!(code.contains("pub passed: bool"));
    }

    #[test]
    fn test_generate_from_actual_graph_yaml() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../graph.yaml");
        if std::path::Path::new(path).exists() {
            let code = generate_from_file(path).expect("Failed to generate from graph.yaml");
            assert!(code.contains("pub mod unit_test"));
            assert!(code.contains("pub struct UnitTestTask"));
        }
    }

    #[test]
    fn regenerate_graph_rs() {
        let yaml_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../graph.yaml");
        let target_rs = concat!(env!("CARGO_MANIFEST_DIR"), "/src/graph.rs");
        let code = generate_from_file(yaml_path).expect("Failed to generate code from graph.yaml");
        std::fs::write(target_rs, code).expect("Failed to write generated code to graph.rs");
    }
}
