pub struct JavaScriptLiteral<'scan> {
    pub node: tree_sitter::Node<'scan>,
    pub source: &'scan str,
}
use std::str::Chars;

impl JavaScriptLiteral<'_> {
    pub fn static_javascript_string(self) -> Result<String, JavaScriptLiteralFailure> {
        let Self { node, source } = self;
        if node.kind() == "template_string" && self.contains_template_substitution() {
            return Err(JavaScriptLiteralFailure::DynamicTemplate);
        }
        let literal = node
            .utf8_text(source.as_bytes())
            .map_err(|_| JavaScriptLiteralFailure::InvalidSource)?;
        let delimiter = literal
            .chars()
            .next()
            .ok_or(JavaScriptLiteralFailure::InvalidDelimiter)?;
        if literal
            .chars()
            .last()
            .ok_or(JavaScriptLiteralFailure::InvalidDelimiter)?
            != delimiter
            || !matches!(delimiter, '\'' | '"' | '`')
        {
            return Err(JavaScriptLiteralFailure::InvalidDelimiter);
        }
        if delimiter == '"' {
            return serde_json::from_str(literal)
                .map_err(|_| JavaScriptLiteralFailure::InvalidEscape);
        }
        JavaScriptLiteral::decode_javascript_escapes(&literal[1..literal.len() - 1])
    }
}

impl JavaScriptLiteral<'_> {
    pub(super) fn semantic_javascript_name(self) -> Result<String, JavaScriptLiteralFailure> {
        let Self { node, source } = self;
        let text = node
            .utf8_text(source.as_bytes())
            .map_err(|_| JavaScriptLiteralFailure::InvalidSource)?;
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
    pub(super) fn callable_expression_name(self) -> Result<String, JavaScriptLiteralFailure> {
        let Self { node, source } = self;
        let property = match node.kind() {
            "identifier" => node,
            "member_expression" => node
                .child_by_field_name("property")
                .ok_or(JavaScriptLiteralFailure::MissingCallableName)?,
            "subscript_expression" => node
                .child_by_field_name("index")
                .ok_or(JavaScriptLiteralFailure::MissingCallableName)?,
            _ => return Err(JavaScriptLiteralFailure::UnsupportedCallable),
        };
        (JavaScriptLiteral {
            node: property,
            source,
        })
        .semantic_javascript_name()
    }
}

impl JavaScriptLiteral<'_> {
    fn contains_template_substitution(&self) -> bool {
        let node = self.node;
        let mut cursor = node.walk();
        node.named_children(&mut cursor)
            .any(|child| child.kind() == "template_substitution")
    }
}

impl JavaScriptLiteral<'_> {
    fn decode_javascript_escapes(source: &str) -> Result<String, JavaScriptLiteralFailure> {
        let mut decoded = String::with_capacity(source.len());
        let mut chars = source.chars();
        while let Some(character) = chars.next() {
            if character != '\\' {
                decoded.push(character);
                continue;
            }
            let escape = chars
                .next()
                .ok_or(JavaScriptLiteralFailure::TruncatedEscape)?;
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
        Ok(decoded)
    }
}

impl JavaScriptLiteral<'_> {
    fn decode_unicode_escape(chars: &mut Chars<'_>) -> Result<char, JavaScriptLiteralFailure> {
        if chars.clone().next() == Some('{') {
            chars.next();
            let mut value = 0_u32;
            let mut digits = 0;
            loop {
                let character = chars
                    .next()
                    .ok_or(JavaScriptLiteralFailure::TruncatedEscape)?;
                if character == '}' {
                    if digits == 0 {
                        return Err(JavaScriptLiteralFailure::InvalidEscape);
                    }
                    return char::from_u32(value).ok_or(JavaScriptLiteralFailure::InvalidCodePoint);
                }
                value = value
                    .checked_mul(16)
                    .ok_or(JavaScriptLiteralFailure::InvalidCodePoint)?
                    .checked_add(
                        character
                            .to_digit(16)
                            .ok_or(JavaScriptLiteralFailure::InvalidEscape)?,
                    )
                    .ok_or(JavaScriptLiteralFailure::InvalidCodePoint)?;
                digits += 1;
            }
        }
        JavaScriptLiteral::decode_fixed_hex(chars, 4)
    }
}

impl JavaScriptLiteral<'_> {
    fn decode_fixed_hex(
        chars: &mut Chars<'_>,
        digits: usize,
    ) -> Result<char, JavaScriptLiteralFailure> {
        let mut value = 0_u32;
        for _ in 0..digits {
            value = value
                .checked_mul(16)
                .ok_or(JavaScriptLiteralFailure::InvalidCodePoint)?
                .checked_add(
                    chars
                        .next()
                        .ok_or(JavaScriptLiteralFailure::TruncatedEscape)?
                        .to_digit(16)
                        .ok_or(JavaScriptLiteralFailure::InvalidEscape)?,
                )
                .ok_or(JavaScriptLiteralFailure::InvalidCodePoint)?;
        }
        char::from_u32(value).ok_or(JavaScriptLiteralFailure::InvalidCodePoint)
    }
}

#[derive(Debug)]
pub enum JavaScriptLiteralFailure {
    DynamicTemplate,
    InvalidSource,
    InvalidDelimiter,
    InvalidEscape,
    TruncatedEscape,
    InvalidCodePoint,
    MissingCallableName,
    UnsupportedCallable,
}
