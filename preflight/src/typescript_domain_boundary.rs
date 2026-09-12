pub struct TypeScriptDomainBoundary<'scan> {
    pub root: &'scan Path,
}
use super::{
    HashSet, Path, RUST_WASM_TYPED_DOMAIN_FUNCTION_MARKERS, RUST_WASM_UNCHECKED_TYPE_MARKERS,
    RustBoundarySources, TYPESCRIPT_DOMAIN_ALIAS_NAMES, TYPESCRIPT_DOMAIN_MIRROR_ENUM_NAMES,
    TYPESCRIPT_DOMAIN_MIRRORS, Violation, fs, io,
};

/// Finds TypeScript declarations that duplicate Rust-owned domain boundaries.
///
/// # Errors
///
/// Returns an error when the web source tree cannot be read.
impl TypeScriptDomainBoundary<'_> {
    /// # Errors
    ///
    /// Returns an error when the web source tree cannot be read.
    pub fn typescript_domain_boundary_boilerplate(self) -> io::Result<Vec<Violation>> {
        let Self { root } = self;
        TypeScriptDomainBoundary::source_violations(
            root,
            Path::new("nook-app/nook-web"),
            &["ts", "svelte"],
            TypeScriptDomainBoundary::typescript_boundary_violation_lines,
        )
    }
}

/// Finds JSON serialize/parse round trips used as cloning or reactive-proxy
/// escape hatches in authored web source.
///
/// Rune modules must take a Svelte snapshot at the call boundary instead.
///
/// # Errors
///
/// Returns an error when the web source tree cannot be read.
impl TypeScriptDomainBoundary<'_> {
    /// # Errors
    ///
    /// Returns an error when the web source tree cannot be read.
    pub fn typescript_json_round_trip_clones(root: &Path) -> io::Result<Vec<Violation>> {
        TypeScriptDomainBoundary::source_violations(
            root,
            Path::new("nook-app/nook-web"),
            &["ts", "svelte"],
            TypeScriptDomainBoundary::json_round_trip_clone_lines,
        )
    }
}

/// Finds extension persistence decisions that must remain in companion Rust.
///
/// Browser `IndexedDB` calls stay in TypeScript. Classification of the returned
/// database and store observations belongs in `nook-companion-core`.
///
/// # Errors
///
/// Returns an error when the extension source tree cannot be read.
impl TypeScriptDomainBoundary<'_> {
    /// # Errors
    ///
    /// Returns an error when the extension source tree cannot be read.
    pub fn typescript_extension_persistence_policy(root: &Path) -> io::Result<Vec<Violation>> {
        TypeScriptDomainBoundary::source_violations(
            root,
            Path::new("nook-app/nook-web/nook-web-extension"),
            &["ts", "svelte"],
            TypeScriptDomainBoundary::extension_persistence_policy_lines,
        )
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn extension_persistence_policy_lines(source: &str) -> Vec<usize> {
        source
            .lines()
            .enumerate()
            .filter_map(|(index, line)| {
                (line.contains("databases.some(") || line.contains("objectStoreNames.contains("))
                    .then_some(index + 1)
            })
            .collect()
    }
}

/// Finds redundant optional Svelte rune declarations, domain identifiers
/// widened to `string` anywhere in authored web state, and domain unions in
/// the central vault state.
///
/// # Errors
///
/// Returns an error when the authored web source tree cannot be read.
impl TypeScriptDomainBoundary<'_> {
    /// # Errors
    ///
    /// Returns an error when the authored web source tree cannot be read.
    pub fn typescript_svelte_state_modeling_violations(root: &Path) -> io::Result<Vec<Violation>> {
        let mut violations = TypeScriptDomainBoundary::source_violations(
            root,
            Path::new("nook-app/nook-web"),
            &["ts", "svelte"],
            TypeScriptDomainBoundary::redundant_optional_state_lines,
        )?;
        violations.extend(TypeScriptDomainBoundary::source_violations(
            root,
            Path::new("nook-app/nook-web"),
            &["ts", "svelte"],
            TypeScriptDomainBoundary::widened_domain_identifier_state_lines,
        )?);
        violations.extend(TypeScriptDomainBoundary::source_violations(
            root,
            Path::new("nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/state"),
            &["ts"],
            TypeScriptDomainBoundary::inline_object_collection_state_lines,
        )?);

        let relative_path =
            Path::new("nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault.svelte.ts");
        let source = fs::read_to_string(root.join(relative_path))?;
        violations.extend(
            TypeScriptDomainBoundary::domain_string_union_state_lines(&source)
                .into_iter()
                .map(|line| Violation {
                    path: relative_path.to_path_buf(),
                    line,
                }),
        );
        violations.sort_by(|left, right| {
            left.path
                .cmp(&right.path)
                .then_with(|| left.line.cmp(&right.line))
        });
        Ok(violations)
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn inline_object_collection_state_lines(source: &str) -> Vec<usize> {
        let mut compact = Vec::with_capacity(source.len());
        let mut source_lines = Vec::with_capacity(source.len());
        let mut line = 1;
        for byte in source.bytes() {
            if byte == b'\n' {
                line += 1;
            } else if !byte.is_ascii_whitespace() {
                compact.push(byte);
                source_lines.push(line);
            }
        }

        let mut lines = Vec::new();
        for pattern in [
            b"$state<Array<{".as_slice(),
            b"$state.raw<Array<{".as_slice(),
            b"$state<{".as_slice(),
        ] {
            for (window, source_line) in compact.windows(pattern.len()).zip(&source_lines) {
                if window == pattern {
                    lines.push(*source_line);
                }
            }
        }
        lines.sort_unstable();
        lines.dedup();
        lines
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn widened_domain_identifier_state_lines(source: &str) -> Vec<usize> {
        let mut compact = Vec::with_capacity(source.len());
        let mut source_lines = Vec::with_capacity(source.len());
        let mut line = 1;
        for byte in source.bytes() {
            if byte == b'\n' {
                line += 1;
            } else if !byte.is_ascii_whitespace() {
                compact.push(byte);
                source_lines.push(line);
            }
        }

        let pattern = b"$state<string";
        let mut lines = Vec::new();
        for (start, window) in compact.windows(pattern.len()).enumerate() {
            if window != pattern {
                continue;
            }
            let Some(before_state) = compact.get(..start) else {
                continue;
            };
            let Some(equals) = before_state.iter().rposition(|byte| *byte == b'=') else {
                continue;
            };
            let identifier_start = before_state
                .get(..equals)
                .unwrap_or_default()
                .iter()
                .rposition(|byte| !(byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'$'))
                .map_or(0, |index| index + 1);
            let Some(identifier) = compact.get(identifier_start..equals) else {
                continue;
            };
            let is_domain_identifier = identifier.ends_with(b"switchingTo")
                || identifier.ends_with(b"StoreId")
                || identifier.ends_with(b"EntryId");
            if is_domain_identifier && let Some(source_line) = source_lines.get(start) {
                lines.push(*source_line);
            }
        }
        lines.sort_unstable();
        lines.dedup();
        lines
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn domain_string_union_state_lines(source: &str) -> Vec<usize> {
        const UI_ONLY_STATE: &[&[u8]] = &[
            b"settingsSection",
            b"settingsAccordionSection",
            b"adminAccordionSection",
        ];

        let mut compact = Vec::with_capacity(source.len());
        let mut source_lines = Vec::with_capacity(source.len());
        let mut line = 1;
        for byte in source.bytes() {
            if byte == b'\n' {
                line += 1;
            } else if !byte.is_ascii_whitespace() {
                compact.push(byte);
                source_lines.push(line);
            }
        }

        let prefix = b"$state<";
        let mut lines = Vec::new();
        for (start, window) in compact.windows(prefix.len()).enumerate() {
            if window != prefix {
                continue;
            }
            let generic_start = start + prefix.len();
            let Some(generic_tail) = compact.get(generic_start..) else {
                continue;
            };
            let Some(generic_end) = generic_tail
                .iter()
                .position(|byte| *byte == b'>')
                .map(|offset| generic_start + offset)
            else {
                continue;
            };
            let Some(generic) = compact.get(generic_start..generic_end) else {
                continue;
            };
            if !generic.contains(&b'|') || !(generic.contains(&b'"') || generic.contains(&b'\'')) {
                continue;
            }

            let Some(before_state) = compact.get(..start) else {
                continue;
            };
            let Some(equals) = before_state.iter().rposition(|byte| *byte == b'=') else {
                continue;
            };
            let identifier_start = before_state
                .get(..equals)
                .unwrap_or_default()
                .iter()
                .rposition(|byte| !(byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'$'))
                .map_or(0, |index| index + 1);
            let Some(identifier) = compact.get(identifier_start..equals) else {
                continue;
            };
            if UI_ONLY_STATE.contains(&identifier) {
                continue;
            }
            if let Some(source_line) = source_lines.get(start) {
                lines.push(*source_line);
            }
        }
        lines.sort_unstable();
        lines.dedup();
        lines
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn redundant_optional_state_lines(source: &str) -> Vec<usize> {
        let mut compact = Vec::with_capacity(source.len());
        let mut source_lines = Vec::with_capacity(source.len());
        let mut line = 1;
        for byte in source.bytes() {
            if byte == b'\n' {
                line += 1;
            } else if !byte.is_ascii_whitespace() {
                compact.push(byte);
                source_lines.push(line);
            }
        }

        let mut lines = Vec::new();
        for prefix in [b"$state<".as_slice(), b"$state.raw<".as_slice()] {
            for (start, window) in compact.windows(prefix.len()).enumerate() {
                if window != prefix {
                    continue;
                }
                let Some(tail) = compact.get(start + prefix.len()..) else {
                    continue;
                };
                let Some(end) = tail
                    .windows(b">(undefined)".len())
                    .position(|candidate| candidate == b">(undefined)")
                else {
                    continue;
                };
                let Some(generic) = tail.get(..end) else {
                    continue;
                };
                if generic.contains(&b';') {
                    continue;
                }
                if generic
                    .windows(b"|undefined".len())
                    .any(|candidate| candidate == b"|undefined")
                    && let Some(source_line) = source_lines.get(start)
                {
                    lines.push(*source_line);
                }
            }
        }
        lines.sort_unstable();
        lines.dedup();
        lines
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn json_round_trip_clone_lines(source: &str) -> Vec<usize> {
        const PATTERN: &[u8] = b"JSON.parse(JSON.stringify(";

        let mut compact = Vec::with_capacity(source.len());
        let mut source_lines = Vec::with_capacity(source.len());
        let mut line = 1;
        for byte in source.bytes() {
            if byte == b'\n' {
                line += 1;
            } else if !byte.is_ascii_whitespace() {
                compact.push(byte);
                source_lines.push(line);
            }
        }

        compact
            .windows(PATTERN.len())
            .zip(source_lines)
            .filter_map(|(window, source_line)| (window == PATTERN).then_some(source_line))
            .collect()
    }
}

/// Reject declarations that make a raw JavaScript value look typed only in the
/// generated declaration file. Provider/auth DTOs must use an actual Rust ABI
/// type (for example a `Tsify` type), never `JsValue` plus an unchecked hint.
///
/// # Errors
///
/// Returns an error when the WASM source tree cannot be read.
impl TypeScriptDomainBoundary<'_> {
    /// # Errors
    ///
    /// Returns an error when the Rust or web source tree cannot be read.
    pub fn rust_wasm_domain_boundary_escape_hatches(root: &Path) -> io::Result<Vec<Violation>> {
        TypeScriptDomainBoundary::source_violations(
            root,
            Path::new("nook-app/nook-platform/nook-wasm/src"),
            &["rs"],
            TypeScriptDomainBoundary::rust_wasm_boundary_violation_lines,
        )
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn source_violations(
        root: &Path,
        relative_directory: &Path,
        extensions: &[&str],
        detector: fn(&str) -> Vec<usize>,
    ) -> io::Result<Vec<Violation>> {
        let directory = root.join(relative_directory);
        let mut files = Vec::new();
        for extension in extensions {
            RustBoundarySources::collect_files_with_extension(&directory, extension, &mut files)?;
        }

        let mut violations = Vec::new();
        for path in files {
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".d.ts"))
            {
                continue;
            }
            let contents = fs::read_to_string(&path)?;
            for line in detector(&contents) {
                violations.push(Violation {
                    path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
                    line,
                });
            }
        }
        violations
            .sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
        violations.dedup();
        Ok(violations)
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn rust_wasm_boundary_violation_lines(contents: &str) -> Vec<usize> {
        let lines = contents.lines().collect::<Vec<_>>();
        let mut violations = Vec::new();

        for (index, line) in lines.iter().enumerate() {
            if RUST_WASM_UNCHECKED_TYPE_MARKERS
                .iter()
                .any(|marker| line.contains(marker))
            {
                violations.push(index + 1);
            }
        }

        let mut index = 0;
        while let Some(line) = lines.get(index) {
            let trimmed = line.trim_start();
            let function = trimmed
                .strip_prefix("pub fn ")
                .or_else(|| trimmed.strip_prefix("pub async fn "));
            let Some(function) = function else {
                index += 1;
                continue;
            };
            let function_name = function
                .split(|character: char| character == '(' || character.is_whitespace())
                .next()
                .unwrap_or_default();
            let signature_end = (index..lines.len())
                .find(|line| {
                    lines
                        .get(*line)
                        .is_some_and(|line| line.contains('{') || line.trim_end().ends_with(';'))
                })
                .unwrap_or(index);
            let Some(signature_lines) = lines.get(index..=signature_end) else {
                violations.push(index + 1);
                break;
            };
            let signature = signature_lines.join(" ");
            if RUST_WASM_TYPED_DOMAIN_FUNCTION_MARKERS
                .iter()
                .any(|marker| function_name.contains(marker))
                && signature.contains("JsValue")
            {
                violations.push(index + 1);
            }
            index = signature_end + 1;
        }

        violations.sort_unstable();
        violations.dedup();
        violations
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn typescript_boundary_violation_lines(contents: &str) -> Vec<usize> {
        let lines = contents.lines().collect::<Vec<_>>();
        let wasm_bindings = TypeScriptDomainBoundary::wasm_import_bindings(contents);
        let mut violations = Vec::new();

        for (index, line) in lines.iter().enumerate() {
            if TYPESCRIPT_DOMAIN_MIRRORS
                .iter()
                .any(|marker| line.contains(marker))
                || TypeScriptDomainBoundary::is_wasm_type_alias(line, &wasm_bindings)
                || TypeScriptDomainBoundary::is_domain_mirror_interface(line)
                || TypeScriptDomainBoundary::is_domain_mirror_enum(line)
            {
                violations.push(index + 1);
            }
        }

        let mut index = 0;
        while let Some(line) = lines.get(index) {
            let trimmed = line.trim_start();
            if !trimmed.starts_with("export function ")
                && !trimmed.starts_with("export async function ")
            {
                index += 1;
                continue;
            }

            let function_line = index + 1;
            let FunctionBody::Located(body_start) =
                TypeScriptDomainBoundary::function_body_start(&lines, index)
            else {
                index += 1;
                continue;
            };
            let declaration_indent = line.len() - line.trim_start().len();
            let Some(body_end) = (body_start + 1..lines.len()).find(|line| {
                lines.get(*line).is_some_and(|line| {
                    line.trim() == "}" && line.len() - line.trim_start().len() == declaration_indent
                })
            }) else {
                index += 1;
                continue;
            };

            let (Some(declaration), Some(body)) = (
                lines.get(index..=body_start),
                lines.get(body_start + 1..body_end),
            ) else {
                violations.push(function_line);
                break;
            };
            let declaration = declaration.join(" ");
            let body = body.join(" ");
            if TypeScriptDomainBoundary::is_trivial_wasm_forwarder(
                &declaration,
                &body,
                &wasm_bindings,
            ) {
                violations.push(function_line);
            }
            index = body_end + 1;
        }

        violations.sort_unstable();
        violations.dedup();
        violations
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn is_domain_mirror_enum(line: &str) -> bool {
        let line = line.trim_start();
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some(declaration) = line.strip_prefix("enum ") else {
            return false;
        };
        let name = declaration
            .split(|character: char| character.is_whitespace() || character == '{')
            .next()
            .unwrap_or_default();
        TYPESCRIPT_DOMAIN_MIRROR_ENUM_NAMES.contains(&name)
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn is_wasm_type_alias(line: &str, wasm_bindings: &HashSet<String>) -> bool {
        let line = line.trim_start();
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some(alias) = line.strip_prefix("type ") else {
            return false;
        };
        let declaration_name = alias
            .split(|character: char| character.is_whitespace() || character == '=')
            .next()
            .unwrap_or_default();
        if TYPESCRIPT_DOMAIN_ALIAS_NAMES.contains(&declaration_name) {
            return true;
        }
        let Some((_, value)) = alias.split_once('=') else {
            return false;
        };
        let value = value.trim_start();
        if value.starts_with("Nook") {
            return true;
        }
        let value = value.trim_end_matches(';').trim();
        TypeScriptDomainBoundary::is_typescript_identifier(value) && wasm_bindings.contains(value)
    }
}

impl TypeScriptDomainBoundary<'_> {
    fn is_domain_mirror_interface(line: &str) -> bool {
        let line = line.trim_start();
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some(declaration) = line.strip_prefix("interface ") else {
            return false;
        };
        let name = declaration
            .split(|character: char| character.is_whitespace() || character == '{')
            .next()
            .unwrap_or_default();
        TYPESCRIPT_DOMAIN_ALIAS_NAMES.contains(&name)
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn wasm_import_bindings(contents: &str) -> HashSet<String> {
        let mut bindings = HashSet::new();
        let lines = contents.lines().collect::<Vec<_>>();
        let mut index = 0;
        while let Some(line) = lines.get(index) {
            if !line.trim_start().starts_with("import ") {
                index += 1;
                continue;
            }

            let start = index;
            while index + 1 < lines.len()
                && !TypeScriptDomainBoundary::is_import_statement_complete(&lines, start, index)
            {
                index += 1;
            }
            let Some(statement_lines) = lines.get(start..=index) else {
                break;
            };
            let statement = statement_lines.join("\n");
            index += 1;

            if !TypeScriptDomainBoundary::is_wasm_import(&statement) {
                continue;
            }
            let Some(start) = statement.find('{') else {
                continue;
            };
            let Some(end) = statement.rfind('}') else {
                continue;
            };
            let Some(named_bindings) = statement.get(start + 1..end) else {
                continue;
            };
            for binding in named_bindings.split(',') {
                let binding = binding.trim();
                if binding.is_empty() {
                    continue;
                }
                let binding = binding.strip_prefix("type ").unwrap_or(binding).trim();
                let local_name = binding
                    .split_once(" as ")
                    .map_or(binding, |(_, local)| local)
                    .trim();
                if TypeScriptDomainBoundary::is_typescript_identifier(local_name) {
                    bindings.insert(local_name.to_owned());
                }
            }
        }
        bindings
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn is_import_statement_complete(lines: &[&str], start: usize, end: usize) -> bool {
        let Some(statement_lines) = lines.get(start..=end) else {
            return false;
        };
        let statement = statement_lines.join("\n");
        if statement.trim_end().ends_with(';') {
            return true;
        }

        let braces = statement
            .chars()
            .fold(0_i32, |depth, character| match character {
                '{' => depth + 1,
                '}' => depth - 1,
                _ => depth,
            });
        braces == 0
            && (statement.contains(" from \"")
                || statement.contains(" from '")
                || statement.trim_start().starts_with("import \"")
                || statement.trim_start().starts_with("import '"))
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn is_wasm_import(statement: &str) -> bool {
        statement.contains("from \"$app-wasm\"")
            || statement.contains("from '$app-wasm'")
            || statement.contains("/nook-wasm/nook_wasm\"")
            || statement.contains("/nook-wasm/nook_wasm'")
    }
}

impl TypeScriptDomainBoundary<'_> {
    fn function_body_start(lines: &[&str], start: usize) -> FunctionBody {
        let mut parentheses = 0_i32;
        for (index, line) in lines.iter().enumerate().skip(start) {
            for character in line.chars() {
                match character {
                    '(' => parentheses += 1,
                    ')' => parentheses -= 1,
                    _ => {}
                }
            }
            if parentheses == 0 && line.trim_end().ends_with('{') {
                return FunctionBody::Located(index);
            }
        }
        FunctionBody::Unterminated
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn is_trivial_wasm_forwarder(
        declaration: &str,
        body: &str,
        wasm_bindings: &HashSet<String>,
    ) -> bool {
        if declaration.contains('=') {
            return false;
        }

        let statement = body.split_whitespace().collect::<Vec<_>>().join(" ");
        let expression = statement
            .strip_prefix("return await ")
            .or_else(|| statement.strip_prefix("return "))
            .or_else(|| statement.strip_prefix("await "))
            .unwrap_or_default()
            .trim();
        let expression = expression.strip_suffix(';').unwrap_or(expression).trim();
        let Some(open) = expression.find('(') else {
            return false;
        };
        let Some(close) = expression.rfind(')') else {
            return false;
        };
        let Some(callee) = expression.get(..open).map(str::trim) else {
            return false;
        };
        if !wasm_bindings.contains(callee) {
            return false;
        }
        let Some(trailing) = expression.get(close + 1..).map(str::trim) else {
            return false;
        };
        if !trailing.is_empty() && !trailing.starts_with("as ") {
            return false;
        }

        let Some(arguments) = expression.get(open + 1..close) else {
            return false;
        };
        let arguments = arguments
            .split(',')
            .map(str::trim)
            .filter(|argument| !argument.is_empty())
            .collect::<Vec<_>>();
        arguments
            .iter()
            .all(|argument| TypeScriptDomainBoundary::is_typescript_identifier(argument))
            && matches!(TypeScriptDomainBoundary::forwarded_parameters(declaration), ForwardedParameters::Identifiers(parameters) if parameters == arguments)
    }
}

impl TypeScriptDomainBoundary<'_> {
    fn forwarded_parameters(declaration: &str) -> ForwardedParameters<'_> {
        let Some(open) = declaration.find('(') else {
            return ForwardedParameters::Unsupported;
        };
        let Some(close) = declaration.rfind(')') else {
            return ForwardedParameters::Unsupported;
        };
        let Some(parameters) = declaration.get(open + 1..close).map(str::trim) else {
            return ForwardedParameters::Unsupported;
        };
        if parameters.is_empty() {
            return ForwardedParameters::Identifiers(Vec::new());
        }
        if parameters.contains("=>") || parameters.contains(['{', '[', '<']) {
            return ForwardedParameters::Unsupported;
        }
        let mut identifiers = Vec::new();
        for parameter in parameters
            .split(',')
            .map(str::trim)
            .filter(|parameter| !parameter.is_empty())
        {
            let end = parameter.find([':', '?']).unwrap_or(parameter.len());
            let Some(name) = parameter.get(..end).map(str::trim) else {
                return ForwardedParameters::Unsupported;
            };
            if !TypeScriptDomainBoundary::is_typescript_identifier(name) {
                return ForwardedParameters::Unsupported;
            }
            identifiers.push(name);
        }
        ForwardedParameters::Identifiers(identifiers)
    }
}

impl TypeScriptDomainBoundary<'_> {
    pub(super) fn is_typescript_identifier(value: &str) -> bool {
        let mut characters = value.chars();
        let Some(first) = characters.next() else {
            return false;
        };
        (first.is_ascii_alphabetic() || matches!(first, '_' | '$'))
            && characters.all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '$')
            })
    }
}

enum FunctionBody {
    Located(usize),
    Unterminated,
}
enum ForwardedParameters<'source> {
    Identifiers(Vec<&'source str>),
    Unsupported,
}

#[cfg(test)]
mod tests {
    use super::TypeScriptDomainBoundary;

    #[test]
    fn inline_object_collection_state_is_rejected() {
        let source = r"
            const conflicts = $state<Array<{
                events: string[];
            }>>([]);
            const raw = $state.raw<Array<{ id: string }>>([]);
        ";

        assert_eq!(
            TypeScriptDomainBoundary::inline_object_collection_state_lines(source),
            [2, 5]
        );
    }

    #[test]
    fn generated_domain_collection_state_is_accepted() {
        let source = "const conflicts = $state.raw<NookSecurityConflict[]>([]);";
        assert!(TypeScriptDomainBoundary::inline_object_collection_state_lines(source).is_empty());
    }

    #[test]
    fn unicode_prefixes_and_truncated_declarations_preserve_boundary_detection() {
        let source = "const 🔐label = 'vault';\nconst switchingTo = $state<string>('');\n";
        assert_eq!(
            TypeScriptDomainBoundary::widened_domain_identifier_state_lines(source),
            vec![2]
        );
        assert_eq!(
            TypeScriptDomainBoundary::widened_domain_identifier_state_lines(
                "const switchingTo = $state<str"
            ),
            Vec::<usize>::new()
        );
    }
}
