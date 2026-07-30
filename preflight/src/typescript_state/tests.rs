use super::{
    svelte_raw_string_discriminant_lines, typescript_code_generic_optional_state_lines,
    typescript_code_mutable_void_state_lines, typescript_code_null_token_lines,
    typescript_code_raw_string_discriminant_lines, typescript_code_undefined_token_lines,
};

#[test]
fn reports_every_code_and_type_token_but_not_prose() -> Result<(), tree_sitter::LanguageError> {
    let source = r#"
// undefined is discussed here
type State = { kind: 'empty' } | { kind: 'ready'; value: string }
const config: { optional?: string } = {}
let timer: ReturnType<typeof setTimeout> | undefined
const missing = value === undefined
const word = 'undefined'
const hidden = typeof value === 'undefined'
const reversed = "undefined" != typeof another
const parenthesized = typeof(value)===`undefined`
expect(value).toBeUndefined()
expect(value).not.toBeDefined()
expect(value).toBeNull()
let implicitBinding = $bindable()
"#;

    assert_eq!(
        typescript_code_undefined_token_lines(source, 1)?,
        vec![5, 6, 8, 9, 10, 11, 12, 13, 14]
    );
    Ok(())
}

#[test]
fn reports_value_or_void_contracts_but_not_unit_effects() -> Result<(), tree_sitter::LanguageError>
{
    let source = r"
let timer: ReturnType<typeof setTimeout> | void
const parser = (): string | void => {}
let request: ValueState<Promise<string | void>> = { kind: 'empty' }
let selected = $state<string | void>()
const command = (): void => {}
const effect = async (): Promise<void> => {}
const callback: (value: string) => void = () => {}
const maybeEffect = (): void | Promise<void> => {}
void effect()
";

    assert_eq!(
        typescript_code_mutable_void_state_lines(source, 1)?,
        vec![2, 3, 4, 5]
    );
    Ok(())
}

#[test]
fn reports_null_values_and_types_but_not_prose() -> Result<(), tree_sitter::LanguageError> {
    let source = r#"
// null is discussed here
const word = "null"
type State = string | null
const value = null
"#;

    assert_eq!(typescript_code_null_token_lines(source, 1)?, vec![4, 5]);
    Ok(())
}

#[test]
fn reports_generic_option_style_state_names_but_not_prose() -> Result<(), tree_sitter::LanguageError>
{
    let source = r"
// ValueState and EMPTY_VALUE are discussed here
type ValueState<T> = { kind: 'empty' } | { kind: 'present'; value: T }
const EMPTY_VALUE = { kind: 'empty' }
const state = presentValue(value)
";

    assert_eq!(
        typescript_code_generic_optional_state_lines(source, 1)?,
        vec![3, 4, 5]
    );
    Ok(())
}

#[test]
fn reports_raw_string_vocabularies_and_runtime_discriminants()
-> Result<(), tree_sitter::LanguageError> {
    let source = r"
enum SessionKind {
  Closed = 'closed',
  Open = 'open',
}
enum ProviderKind {
  Local = 'local',
}
type SessionState =
  | { kind: 'closed' }
  | { kind: SessionKind.Open; handle: number }
type Message = { type: 'nook:open'; payload: string }
type Description = { label: 'static copy' }
type Panel = 'closed' | 'open'
function choose(mode: 'closed' | 'open') { return mode }
const state: SessionState = { kind: 'closed' }
if (state.kind === 'closed') console.log('closed')
if ('closed' !== state.kind) console.log('open')
if (provider.type === 'local') console.log('unrelated enum value')
if (server.transport.type !== 'stdio') console.log('external protocol')
const progress = { status: `${completedCount} complete` }
const description = { label: 'static copy' }
const externalKind = state.kind ?? 'external-value'
type SelectedFields = Pick<SessionState, 'kind' | 'handle'>
type ToolArguments = ToolCall['args'] | void
";

    assert_eq!(
        typescript_code_raw_string_discriminant_lines(source, 1)?,
        vec![10, 12, 14, 15, 16, 17, 18]
    );
    Ok(())
}

#[test]
fn reports_raw_discriminants_in_svelte_template_expressions()
-> Result<(), tree_sitter::LanguageError> {
    let source = r#"
<script lang="ts">
  enum SessionKind { Open = 'open' }
  const state = { kind: SessionKind.Open }
</script>
<button class:active={state.kind === 'open'}>
  {state.kind === 'open' ? 'Close' : 'Open'}
</button>
"#;

    assert_eq!(svelte_raw_string_discriminant_lines(source)?, vec![6, 7]);
    Ok(())
}

#[test]
fn reports_bare_variant_comparisons_in_svelte_templates() -> Result<(), tree_sitter::LanguageError>
{
    let source = r#"
<script lang="ts">
  enum DialogVariant { NeedsRequest = 'needs_request' }
  const variant = DialogVariant.NeedsRequest
</script>
{#if variant === 'needs_request'}
  <button>Join</button>
{/if}
"#;

    assert_eq!(svelte_raw_string_discriminant_lines(source)?, vec![6]);
    Ok(())
}
