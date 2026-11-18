use tree_sitter::Node;

pub(crate) trait TypeScriptRuntimeNode {
    fn is_type_only_import(&self, source: &str) -> bool;
    fn runtime_expression(self) -> Self;
}

impl TypeScriptRuntimeNode for Node<'_> {
    fn is_type_only_import(&self, source: &str) -> bool {
        if self
            .utf8_text(source.as_bytes())
            .is_ok_and(|text| text.trim_start().starts_with("type "))
        {
            return true;
        }
        let mut ancestor = self.parent();
        while let Some(parent) = ancestor {
            if parent.kind() == "import_statement" {
                return parent
                    .utf8_text(source.as_bytes())
                    .is_ok_and(|text| text.trim_start().starts_with("import type "));
            }
            ancestor = parent.parent();
        }
        false
    }

    fn runtime_expression(self) -> Self {
        let mut node = self;
        while matches!(
            node.kind(),
            "parenthesized_expression"
                | "as_expression"
                | "satisfies_expression"
                | "non_null_expression"
                | "type_assertion"
        ) {
            let mut cursor = node.walk();
            let Some(value) = node
                .named_children(&mut cursor)
                .find(|child| child.kind() != "type_annotation" && !child.kind().contains("type"))
            else {
                break;
            };
            node = value;
        }
        node
    }
}
