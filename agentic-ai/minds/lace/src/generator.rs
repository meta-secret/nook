//! Generator module to convert a YAML graph definition into compile-time Rust code using `quote!`.

use heck::ToUpperCamelCase;
use proc_macro2::{Ident, Span, TokenStream};
use quote::quote;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Deserialize, Serialize)]
pub struct GraphYaml {
    pub graph: BTreeMap<String, TaskConfig>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct TaskConfig {
    #[serde(default)]
    pub depends_on: Vec<String>,
}

fn to_ident(s: &str) -> Ident {
    Ident::new(s, Span::call_site())
}

fn to_pascal_ident(s: &str) -> Ident {
    Ident::new(&s.to_upper_camel_case(), Span::call_site())
}


/// Generates strongly-typed, compile-time self-orchestrating Rust task code using `quote!`.
pub fn generate_rust_code(yaml_content: &str) -> Result<String, Box<dyn std::error::Error>> {
    let parsed: GraphYaml = serde_yaml::from_str(yaml_content)?;
    let mut tokens = TokenStream::new();

    for (task_name, config) in &parsed.graph {
        let task_ident = to_pascal_ident(&format!("{}_task", task_name));

        if config.depends_on.is_empty() {
            let item = quote! {
                #[derive(Debug, Clone, Copy, Default)]
                pub struct #task_ident;

                impl Task for #task_ident {
                    fn execute(&self, prompt: &Prompt) {
                        println!(concat!("[Task: ", stringify!(#task_ident), "] Executing prompt: {}"), prompt.text);
                    }
                }
            };
            tokens.extend(item);
        } else {
            let deps_ident = to_pascal_ident(&format!("{}_deps", task_name));
            let dep_fields: Vec<_> = config.depends_on.iter().map(|d| to_ident(d)).collect();
            let dep_types: Vec<_> = config
                .depends_on
                .iter()
                .map(|d| to_pascal_ident(&format!("{}_task", d)))
                .collect();

            let exec_calls = config.depends_on.iter().map(|d| {
                let field_ident = to_ident(d);
                quote! { self.deps.#field_ident.execute(prompt); }
            });

            let item = quote! {
                #[derive(Debug, Clone, Copy, Default)]
                pub struct #deps_ident {
                    #( pub #dep_fields: #dep_types, )*
                }

                #[derive(Debug, Clone, Copy, Default)]
                pub struct #task_ident {
                    pub deps: #deps_ident,
                }

                impl Task for #task_ident {
                    fn execute(&self, prompt: &Prompt) {
                        #( #exec_calls )*
                        println!(concat!("[Task: ", stringify!(#task_ident), "] Executing prompt: {}"), prompt.text);
                    }
                }
            };
            tokens.extend(item);
        }
    }

    let code = quote! {
        //! Auto-generated task dependency graph from YAML.
        use crate::{Prompt, Task};

        #tokens
    };

    Ok(code.to_string())
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
  backend:
    depends_on:
      - architecture
      - unit_test

  unit_test:
    depends_on:

  architecture:
    depends_on:
"#;

        let code = generate_rust_code(yaml).expect("Failed to generate code with quote");
        assert!(code.contains("struct BackendTask"));
        assert!(code.contains("struct BackendDeps"));
        assert!(code.contains("struct UnitTestTask"));
        assert!(code.contains("struct ArchitectureTask"));
    }

    #[test]
    fn test_generate_from_actual_graph_yaml() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../graph.yaml");
        if std::path::Path::new(path).exists() {
            let code = generate_from_file(path).expect("Failed to generate from graph.yaml");
            assert!(code.contains("struct BackendTask"));
        }
    }
}
