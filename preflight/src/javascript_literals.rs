pub struct JavaScriptLiteral<'scan> {
    pub node: tree_sitter::Node<'scan>,
    pub source: &'scan str,
}
use std::str::Chars;

impl JavaScriptLiteral<'_> {
    pub fn static_javascript_string(self) -> Option<String> {
        let Self { node, source } = self;
        if node.kind() == "template_string"
            && JavaScriptLiteral::contains_template_substitution(node)
        {
            return None;
        }
        let literal = node.utf8_text(source.as_bytes()).ok()?;
        let delimiter = literal.chars().next()?;
        if literal.chars().last()? != delimiter || !matches!(delimiter, '\'' | '"' | '`') {
            return None;
        }
        if delimiter == '"' {
            return serde_json::from_str(literal).ok();
        }
        JavaScriptLiteral::decode_javascript_escapes(&literal[1..literal.len() - 1])
    }
}

impl JavaScriptLiteral<'_> {
    pub(super) fn semantic_javascript_name(
        node: tree_sitter::Node<'_>,
        source: &str,
    ) -> Option<String> {
        let text = node.utf8_text(source.as_bytes()).ok()?;
        if matches!(node.kind(), "string" | "template_string") {
            (JavaScriptLiteral {
                node: node,
                source: source,
            })
            .static_javascript_string()
        } else {
            JavaScriptLiteral::decode_javascript_escapes(text)
        }
    }
}

impl JavaScriptLiteral<'_> {
    pub(super) fn callable_expression_name(
        node: tree_sitter::Node<'_>,
        source: &str,
    ) -> Option<String> {
        let property = match node.kind() {
            "identifier" => Some(node),
            "member_expression" => node.child_by_field_name("property"),
            "subscript_expression" => node.child_by_field_name("index"),
            _ => None,
        };
        property.and_then(|property| JavaScriptLiteral::semantic_javascript_name(property, source))
    }
}

impl JavaScriptLiteral<'_> {
    fn contains_template_substitution(node: tree_sitter::Node<'_>) -> bool {
        let mut cursor = node.walk();
        node.named_children(&mut cursor)
            .any(|child| child.kind() == "template_substitution")
    }
}

impl JavaScriptLiteral<'_> {
    fn decode_javascript_escapes(source: &str) -> Option<String> {
        let mut decoded = String::with_capacity(source.len());
        let mut chars = source.chars();
        while let Some(character) = chars.next() {
            if character != '\\' {
                decoded.push(character);
                continue;
            }
            let escape = chars.next()?;
            match escape {
                '\'' => decoded.push('\''),
                '"' => decoded.push('"'),
                '`' => decoded.push('`'),
                '\\' => decoded.push('\\'),
                'b' => decoded.push('\u{0008}'),
                'f' => decoded.push('\u{000c}'),
                'n' => decoded.push('\n'),
                'r' => decoded.push('\r'),
                't' => decoded.push('\t'),
                'v' => decoded.push('\u{000b}'),
                '0' => decoded.push('\0'),
                'x' => decoded.push(JavaScriptLiteral::decode_fixed_hex(&mut chars, 2)?),
                'u' => decoded.push(JavaScriptLiteral::decode_unicode_escape(&mut chars)?),
                '\n' => {}
                '\r' => {
                    if chars.clone().next() == Some('\n') {
                        chars.next();
                    }
                }
                other => decoded.push(other),
            }
        }
        Some(decoded)
    }
}

impl JavaScriptLiteral<'_> {
    fn decode_unicode_escape(chars: &mut Chars<'_>) -> Option<char> {
        if chars.clone().next() == Some('{') {
            chars.next();
            let mut value = 0_u32;
            let mut digits = 0;
            loop {
                let character = chars.next()?;
                if character == '}' {
                    return (digits > 0).then(|| char::from_u32(value)).flatten();
                }
                value = value
                    .checked_mul(16)?
                    .checked_add(character.to_digit(16)?)?;
                digits += 1;
            }
        }
        JavaScriptLiteral::decode_fixed_hex(chars, 4)
    }
}

impl JavaScriptLiteral<'_> {
    fn decode_fixed_hex(chars: &mut Chars<'_>, digits: usize) -> Option<char> {
        let mut value = 0_u32;
        for _ in 0..digits {
            value = value
                .checked_mul(16)?
                .checked_add(chars.next()?.to_digit(16)?)?;
        }
        char::from_u32(value)
    }
}
