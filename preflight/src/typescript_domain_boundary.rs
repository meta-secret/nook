use super::{
    HashSet, Path, RUST_WASM_TYPED_DOMAIN_FUNCTION_MARKERS, RUST_WASM_UNCHECKED_TYPE_MARKERS,
    TYPESCRIPT_DOMAIN_ALIAS_NAMES, TYPESCRIPT_DOMAIN_MIRROR_ENUM_NAMES, TYPESCRIPT_DOMAIN_MIRRORS,
    Violation, collect_files_with_extension, fs, io,
};

/// Finds TypeScript declarations that duplicate Rust-owned domain boundaries.
///
/// # Errors
///
/// Returns an error when the web source tree cannot be read.
pub fn typescript_domain_boundary_boilerplate(root: &Path) -> io::Result<Vec<Violation>> {
    source_violations(
        root,
        Path::new("nook-app/nook-web"),
        &["ts", "svelte"],
        typescript_boundary_violation_lines,
    )
}

/// Finds JSON serialize/parse round trips used as cloning or reactive-proxy
/// escape hatches in authored web source.
///
/// Rune modules must take a Svelte snapshot at the call boundary instead.
///
/// # Errors
///
/// Returns an error when the web source tree cannot be read.
pub fn typescript_json_round_trip_clones(root: &Path) -> io::Result<Vec<Violation>> {
    source_violations(
        root,
        Path::new("nook-app/nook-web"),
        &["ts", "svelte"],
        json_round_trip_clone_lines,
    )
}

/// Finds redundant optional Svelte rune declarations, domain identifiers
/// widened to `string` anywhere in authored web state, and domain unions in
/// the central vault state.
///
/// # Errors
///
/// Returns an error when the authored web source tree cannot be read.
pub fn typescript_svelte_state_modeling_violations(root: &Path) -> io::Result<Vec<Violation>> {
    let mut violations = source_violations(
        root,
        Path::new("nook-app/nook-web"),
        &["ts", "svelte"],
        redundant_optional_state_lines,
    )?;
    violations.extend(source_violations(
        root,
        Path::new("nook-app/nook-web"),
        &["ts", "svelte"],
        widened_domain_identifier_state_lines,
    )?);

    let relative_path =
        Path::new("nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault.svelte.ts");
    let source = fs::read_to_string(root.join(relative_path))?;
    violations.extend(
        domain_string_union_state_lines(&source)
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
        let Some(equals) = compact[..start].iter().rposition(|byte| *byte == b'=') else {
            continue;
        };
        let identifier_start = compact[..equals]
            .iter()
            .rposition(|byte| !(byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'$'))
            .map_or(0, |index| index + 1);
        let identifier = &compact[identifier_start..equals];
        let is_domain_identifier = identifier.ends_with(b"switchingTo")
            || identifier.ends_with(b"StoreId")
            || identifier.ends_with(b"EntryId");
        if is_domain_identifier {
            lines.push(source_lines[start]);
        }
    }
    lines.sort_unstable();
    lines.dedup();
    lines
}

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
        let Some(generic_end) = compact[generic_start..]
            .iter()
            .position(|byte| *byte == b'>')
            .map(|offset| generic_start + offset)
        else {
            continue;
        };
        let generic = &compact[generic_start..generic_end];
        if !generic.contains(&b'|') || !(generic.contains(&b'"') || generic.contains(&b'\'')) {
            continue;
        }

        let Some(equals) = compact[..start].iter().rposition(|byte| *byte == b'=') else {
            continue;
        };
        let identifier_start = compact[..equals]
            .iter()
            .rposition(|byte| !(byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'$'))
            .map_or(0, |index| index + 1);
        let identifier = &compact[identifier_start..equals];
        if UI_ONLY_STATE.contains(&identifier) {
            continue;
        }
        lines.push(source_lines[start]);
    }
    lines.sort_unstable();
    lines.dedup();
    lines
}

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
            let tail = &compact[start + prefix.len()..];
            let Some(end) = tail
                .windows(b">(undefined)".len())
                .position(|candidate| candidate == b">(undefined)")
            else {
                continue;
            };
            let generic = &tail[..end];
            if generic.contains(&b';') {
                continue;
            }
            if generic
                .windows(b"|undefined".len())
                .any(|candidate| candidate == b"|undefined")
            {
                lines.push(source_lines[start]);
            }
        }
    }
    lines.sort_unstable();
    lines.dedup();
    lines
}

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
        .enumerate()
        .filter_map(|(index, window)| (window == PATTERN).then_some(source_lines[index]))
        .collect()
}

/// Reject declarations that make a raw JavaScript value look typed only in the
/// generated declaration file. Provider/auth DTOs must use an actual Rust ABI
/// type (for example a `Tsify` type), never `JsValue` plus an unchecked hint.
///
/// # Errors
///
/// Returns an error when the WASM source tree cannot be read.
pub fn rust_wasm_domain_boundary_escape_hatches(root: &Path) -> io::Result<Vec<Violation>> {
    source_violations(
        root,
        Path::new("nook-app/nook-wasm/src"),
        &["rs"],
        rust_wasm_boundary_violation_lines,
    )
}

pub(super) fn source_violations(
    root: &Path,
    relative_directory: &Path,
    extensions: &[&str],
    detector: fn(&str) -> Vec<usize>,
) -> io::Result<Vec<Violation>> {
    let directory = root.join(relative_directory);
    let mut files = Vec::new();
    for extension in extensions {
        collect_files_with_extension(&directory, extension, &mut files)?;
    }

    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for line in detector(&contents) {
            violations.push(Violation {
                path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
                line,
            });
        }
    }
    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    violations.dedup();
    Ok(violations)
}

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
    while index < lines.len() {
        let trimmed = lines[index].trim_start();
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
            .find(|line| lines[*line].contains('{') || lines[*line].trim_end().ends_with(';'))
            .unwrap_or(index);
        let signature = lines[index..=signature_end].join(" ");
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

pub(super) fn typescript_boundary_violation_lines(contents: &str) -> Vec<usize> {
    let lines = contents.lines().collect::<Vec<_>>();
    let wasm_bindings = wasm_import_bindings(contents);
    let mut violations = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        if TYPESCRIPT_DOMAIN_MIRRORS
            .iter()
            .any(|marker| line.contains(marker))
            || is_wasm_type_alias(line, &wasm_bindings)
            || is_domain_mirror_interface(line)
            || is_domain_mirror_enum(line)
        {
            violations.push(index + 1);
        }
    }

    let mut index = 0;
    while index < lines.len() {
        let trimmed = lines[index].trim_start();
        if !trimmed.starts_with("export function ")
            && !trimmed.starts_with("export async function ")
        {
            index += 1;
            continue;
        }

        let function_line = index + 1;
        let Some(body_start) = function_body_start(&lines, index) else {
            index += 1;
            continue;
        };
        let declaration_indent = lines[index].len() - lines[index].trim_start().len();
        let Some(body_end) = (body_start + 1..lines.len()).find(|line| {
            lines[*line].trim() == "}"
                && lines[*line].len() - lines[*line].trim_start().len() == declaration_indent
        }) else {
            index += 1;
            continue;
        };

        let declaration = lines[index..=body_start].join(" ");
        let body = lines[body_start + 1..body_end].join(" ");
        if is_trivial_wasm_forwarder(&declaration, &body, &wasm_bindings) {
            violations.push(function_line);
        }
        index = body_end + 1;
    }

    violations.sort_unstable();
    violations.dedup();
    violations
}

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
    is_typescript_identifier(value) && wasm_bindings.contains(value)
}

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

pub(super) fn wasm_import_bindings(contents: &str) -> HashSet<String> {
    let mut bindings = HashSet::new();
    let lines = contents.lines().collect::<Vec<_>>();
    let mut index = 0;
    while index < lines.len() {
        if !lines[index].trim_start().starts_with("import ") {
            index += 1;
            continue;
        }

        let start = index;
        while index + 1 < lines.len() && !is_import_statement_complete(&lines, start, index) {
            index += 1;
        }
        let statement = lines[start..=index].join("\n");
        index += 1;

        if !is_wasm_import(&statement) {
            continue;
        }
        let Some(start) = statement.find('{') else {
            continue;
        };
        let Some(end) = statement.rfind('}') else {
            continue;
        };
        for binding in statement[start + 1..end].split(',') {
            let binding = binding.trim();
            if binding.is_empty() {
                continue;
            }
            let binding = binding.strip_prefix("type ").unwrap_or(binding).trim();
            let local_name = binding
                .split_once(" as ")
                .map_or(binding, |(_, local)| local)
                .trim();
            if is_typescript_identifier(local_name) {
                bindings.insert(local_name.to_owned());
            }
        }
    }
    bindings
}

pub(super) fn is_import_statement_complete(lines: &[&str], start: usize, end: usize) -> bool {
    let statement = lines[start..=end].join("\n");
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

pub(super) fn is_wasm_import(statement: &str) -> bool {
    statement.contains("from \"$app-wasm\"")
        || statement.contains("from '$app-wasm'")
        || statement.contains("/nook-wasm/nook_wasm\"")
        || statement.contains("/nook-wasm/nook_wasm'")
}

pub(super) fn function_body_start(lines: &[&str], start: usize) -> Option<usize> {
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
            return Some(index);
        }
    }
    None
}

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
    let callee = expression[..open].trim();
    if !wasm_bindings.contains(callee) {
        return false;
    }
    let trailing = expression[close + 1..].trim();
    if !trailing.is_empty() && !trailing.starts_with("as ") {
        return false;
    }

    let arguments = expression[open + 1..close]
        .split(',')
        .map(str::trim)
        .filter(|argument| !argument.is_empty())
        .collect::<Vec<_>>();
    arguments
        .iter()
        .all(|argument| is_typescript_identifier(argument))
        && forwarded_parameters(declaration).is_some_and(|parameters| parameters == arguments)
}

pub(super) fn forwarded_parameters(declaration: &str) -> Option<Vec<&str>> {
    let open = declaration.find('(')?;
    let close = declaration.rfind(')')?;
    let parameters = declaration[open + 1..close].trim();
    if parameters.is_empty() {
        return Some(Vec::new());
    }
    if parameters.contains("=>") || parameters.contains(['{', '[', '<']) {
        return None;
    }
    parameters
        .split(',')
        .map(str::trim)
        .filter(|parameter| !parameter.is_empty())
        .map(|parameter| {
            let end = parameter.find([':', '?']).unwrap_or(parameter.len());
            let name = parameter[..end].trim();
            is_typescript_identifier(name).then_some(name)
        })
        .collect()
}

pub(super) fn is_typescript_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || matches!(first, '_' | '$'))
        && characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '$'))
}
