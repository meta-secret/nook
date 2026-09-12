pub struct WasmSvelteSources<'scan> {
    pub source: &'scan str,
    pub source_path: &'scan Path,
    pub callable_names: &'scan HashSet<String>,
    pub wasm_type_names: &'scan HashSet<String>,
    pub wasm_types: &'scan WasmTypeInventory,
}
use std::collections::HashSet;
use std::path::Path;

use crate::rust_wasm_names::RustWasmNames;
use crate::wasm_inventory::WasmTypeInventory;

impl WasmSvelteSources<'_> {
    pub fn svelte_wasm_import_alias_lines(self) -> Result<Vec<usize>, tree_sitter::LanguageError> {
        let Self {
            source,
            source_path,
            callable_names,
            wasm_type_names,
            wasm_types,
        } = self;
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(&tree_sitter_svelte_next::LANGUAGE.into())?;
        let Some(tree) = parser.parse(source, None) else {
            return Ok(Vec::new());
        };
        let blank = source
            .bytes()
            .map(|byte| if byte == b'\n' { byte } else { b' ' })
            .collect::<Vec<_>>();
        let mut instance = blank.clone();
        let mut module = blank;
        if !WasmSvelteSources::collect_svelte_typescript(
            tree.root_node(),
            source,
            &mut instance,
            &mut module,
        ) {
            return Ok(vec![1]);
        }
        let mut lines = Vec::new();
        for composite in [instance, module] {
            lines.extend(RustWasmNames::typescript_wasm_import_alias_lines_at_path(
                &String::from_utf8_lossy(&composite),
                source_path,
                1,
                callable_names,
                wasm_type_names,
                wasm_types,
            )?);
        }
        lines.sort_unstable();
        lines.dedup();
        Ok(lines)
    }
}

#[cfg(test)]
mod tests {
    use super::WasmSvelteSources;

    #[test]
    fn checked_source_ranges_preserve_unicode_and_reject_truncation() {
        let source = "🔐vault";
        let mut complete = vec![b' '; source.len()];
        assert!(WasmSvelteSources::copy_source_range(
            source,
            &mut complete,
            0,
            source.len()
        ));
        assert_eq!(complete, source.as_bytes());

        let mut truncated = vec![b' '; source.len() - 1];
        assert!(!WasmSvelteSources::copy_source_range(
            source,
            &mut truncated,
            0,
            source.len()
        ));
    }
}

impl WasmSvelteSources<'_> {
    fn collect_svelte_typescript(
        node: tree_sitter::Node<'_>,
        source: &str,
        instance: &mut [u8],
        module: &mut [u8],
    ) -> bool {
        if !WasmSvelteSources::preserve_block_scope(node, source, instance) {
            return false;
        }
        if node.kind() == "raw_text"
            && node
                .parent()
                .is_some_and(|parent| parent.kind() == "script_element")
        {
            let Some(parent) = node.parent() else {
                return false;
            };
            let Ok(parent_text) = parent.utf8_text(source.as_bytes()) else {
                return false;
            };
            let opening = parent_text.split('>').next().unwrap_or_default();
            let composite = if opening.contains("module") {
                module
            } else {
                instance
            };
            return WasmSvelteSources::copy_source_range(
                source,
                composite,
                node.start_byte(),
                node.end_byte(),
            );
        }
        if node.kind() == "const_tag" {
            let (Some(start), Some(end)) = (
                node.start_byte().checked_add("{@const".len()),
                node.end_byte().checked_sub(1),
            ) else {
                return false;
            };
            if !WasmSvelteSources::copy_source_range(source, instance, start, end) {
                return false;
            }
            let Some(terminator) = instance.get_mut(end) else {
                return false;
            };
            *terminator = b';';
            return true;
        }
        if node.kind() == "expression" {
            return WasmSvelteSources::copy_source_range(
                source,
                instance,
                node.start_byte(),
                node.end_byte(),
            );
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if !WasmSvelteSources::collect_svelte_typescript(child, source, instance, module) {
                return false;
            }
        }
        true
    }
}

impl WasmSvelteSources<'_> {
    fn copy_source_range(source: &str, composite: &mut [u8], start: usize, end: usize) -> bool {
        let (Some(destination), Some(value)) = (
            composite.get_mut(start..end),
            source.as_bytes().get(start..end),
        ) else {
            return false;
        };
        destination.copy_from_slice(value);
        true
    }
}

impl WasmSvelteSources<'_> {
    fn preserve_block_scope(
        node: tree_sitter::Node<'_>,
        source: &str,
        composite: &mut [u8],
    ) -> bool {
        let Ok(text) = node.utf8_text(source.as_bytes()) else {
            return false;
        };
        let header = text.split('}').next().unwrap_or_default();
        let raw = match node.kind() {
            "each_statement" => header.split_once(" as ").map(|(_, value)| value),
            "snippet_statement" => header
                .split_once('(')
                .and_then(|(_, value)| value.split_once(')').map(|(parameters, _)| parameters)),
            "then_block" | "catch_block" => header.split_once(' ').map(|(_, value)| value),
            _ => None,
        };
        let Some(raw) = raw else { return true };
        let raw = raw.trim();
        if raw.is_empty() {
            return true;
        }
        let initializer = matches!(raw.as_bytes().first(), Some(b'{' | b'[')).then_some("=0");
        let declaration = format!("{{let {raw}{};", initializer.unwrap_or_default());
        let (Some(span_length), Some(declaration_end), Some(block_end)) = (
            node.end_byte().checked_sub(node.start_byte()),
            node.start_byte().checked_add(declaration.len()),
            node.end_byte().checked_sub(1),
        ) else {
            return false;
        };
        if declaration.len() < span_length {
            let Some(destination) = composite.get_mut(node.start_byte()..declaration_end) else {
                return false;
            };
            destination.copy_from_slice(declaration.as_bytes());
            let Some(terminator) = composite.get_mut(block_end) else {
                return false;
            };
            *terminator = b'}';
        }
        true
    }
}
