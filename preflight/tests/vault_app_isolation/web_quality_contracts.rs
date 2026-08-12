use super::{read, repository_root};

#[test]
fn web_quality_gate_includes_typed_security_property_and_dependency_checks() {
    let root = repository_root();
    let manifest = read(&root, "nook-app/nook-web/nook-web-app/package.json");
    for required in [
        "\"fast-check\":",
        "\"eslint-plugin-no-unsanitized\":",
        "\"security\": \"bun audit --prod --audit-level=high\"",
        "\"lint\": \"bun run security",
    ] {
        assert!(
            manifest.contains(required),
            "the web quality gate must retain `{required}`"
        );
    }

    let app_tasks = read(&root, "nook-app/Taskfile.yml");
    for required in [
        "cd \"{{.RESEARCH_ROOT}}\" && bun run format",
        "cd \"{{.RESEARCH_ROOT}}\" && bun run format:check",
    ] {
        assert!(
            app_tasks.contains(required),
            "sealed formatting must retain the research command `{required}`"
        );
    }
    let web_toolchain = read(&root, "nook-app/nook-web/docker/toolchain.Dockerfile");
    assert!(
        web_toolchain.contains("nook-web-research && bun install --frozen-lockfile"),
        "sealed formatting must use the research package's pinned dependencies"
    );

    let research_manifest = read(&root, "nook-app/nook-web/nook-web-research/package.json");
    for required in [
        "\"security\": \"bun audit --prod --audit-level=high\"",
        "\"check\": \"bun run security",
        "bun run lint",
        "\"lint\": \"cd .. && nook-web-app/node_modules/.bin/eslint --config eslint.config.js nook-web-research/src\"",
    ] {
        assert!(
            research_manifest.contains(required),
            "the independently deployed research quality gate must retain `{required}`"
        );
    }

    let web_eslint = read(&root, "nook-app/nook-web/eslint.config.js");
    assert!(
        !web_eslint.contains("'max-params': 'off'")
            && !web_eslint.contains("\"max-params\": \"off\""),
        "single-parameter exceptions must stay on exact host-owned callbacks"
    );
    let eslint = format!(
        "{}\n{}\n{}\n{}",
        web_eslint,
        read(&root, "nook-app/nook-web/no-raw-object-arguments-rule.js",),
        read(&root, "nook-app/nook-web/typed-api-analysis.js"),
        read(&root, "nook-app/nook-web/typed-api-rules.js")
    );
    for required in [
        "import { typedApiRules } from './typed-api-rules.js'",
        "untrustedInputAdapterRules",
        "concreteObjectTypeRules",
        "rules: typedApiRules",
        "\"max-params\": [\"error\", { max: 1 }]",
        "\"@typescript-eslint/no-restricted-types\"",
        "Nook web forbids unknown",
        "Nook web forbids the generic object type",
        "Nook web forbids the Object type",
        "Nook web forbids the empty object type",
        "\"@typescript-eslint/no-explicit-any\": \"error\"",
        "\"@typescript-eslint/no-empty-object-type\": \"error\"",
        "Model a concrete domain type",
        "must be narrowed immediately",
        "ExternalValue: { message: \"Use a concrete Nook domain value.\" }",
        "ExternalObject: { message: \"Use a concrete Nook domain object.\" }",
        "JsonValue: { message: \"Use a concrete Nook domain value.\" }",
        "GenericValue: { message: \"Use a concrete Nook domain value.\" }",
        "\"nook-typed-api/no-raw-object-arguments\": [",
        "enforceNamedParameterContracts: false",
        "enforceNamedParameterContracts: true",
        "TSAsExpression",
        "TSTypeAssertion",
        "TSSatisfiesExpression",
        "TSNonNullExpression",
        "function inspectInlineObjectExpressions(expression)",
        "unwrapped.type === 'ObjectExpression'",
        "unwrapped.type === 'ConditionalExpression'",
        "unwrapped.type === 'LogicalExpression'",
        "unwrapped.type === 'SequenceExpression'",
        "inspectInlineObjectExpressions(argument)",
        "named typed value first",
        "sourceCode.getScope(identifier)",
        "variable.defs",
        "definition.name.typeAnnotation",
        "explicitly typed named declaration",
        "VariableLookupKind.NotFound",
        "inspectSpreadArgument(argument)",
        "function spreadArrayElements(args)",
        "unwrapped.type === 'ArrayExpression'",
        "reference.isWrite() && !reference.init && reference.writeExpr",
        "nook-web-extension/src/**/*.{ts,svelte}",
        "nook-web-shared/src/**/*.{ts,svelte}",
        "nook-web-app/src/**/*.{ts,svelte}",
        "nook-web-research/src/**/*.{ts,svelte}",
        "nook-web-extension/src/chrome.d.ts",
        "nook-web-shared/src/extension/runtime-messages.ts",
        "'@typescript-eslint/await-thenable': 'error'",
        "'@typescript-eslint/no-floating-promises': 'error'",
        "'@typescript-eslint/no-misused-promises': 'error'",
        "'@typescript-eslint/switch-exhaustiveness-check': [",
        "considerDefaultExhaustiveForUnions: false",
        "project: './tsconfig.eslint.json'",
        "extraFileExtensions: ['.svelte']",
        "noUnsanitized.configs.recommended",
    ] {
        assert!(
            eslint.contains(required),
            "the web static-analysis config must retain `{required}`"
        );
    }
    let translation_html = read(
        &root,
        "nook-app/nook-web/nook-web-app/src/landing/translation-html.js",
    );
    for required in [
        "DOMPurify.sanitize",
        "ALLOWED_TAGS: ['br', 'code']",
        "ALLOWED_ATTR: []",
        "RETURN_DOM_FRAGMENT: true",
    ] {
        assert!(
            translation_html.contains(required),
            "landing translation markup must retain `{required}`"
        );
    }

    let typed_project = read(&root, "nook-app/nook-web/tsconfig.eslint.json");
    for required in [
        "nook-web-extension/src/**/*.ts",
        "nook-web-extension/src/**/*.svelte",
    ] {
        assert!(
            typed_project.contains(required),
            "the typed lint project must retain extension production sources matching `{required}`"
        );
    }

    let extension_manifest = read(&root, "nook-app/nook-web/nook-web-extension/package.json");
    assert!(
        extension_manifest.contains(
            "eslint --config eslint.config.js nook-web-extension/scripts nook-web-extension/src nook-web-extension/e2e nook-web-extension/playwright.config.ts"
        ),
        "the extension lint command must retain its production source tree"
    );

    let typed_api_tests = read(
        &root,
        "nook-app/nook-web/nook-web-extension/scripts/eslint-typed-api-contract.test.js",
    );
    for required in [
        "rejects object literals expanded from a named spread array",
        "rejects object literals assigned to a spread array name",
    ] {
        assert!(
            typed_api_tests.contains(required),
            "the typed API lint contract must retain `{required}`"
        );
    }

    let property_tests = read(
        &root,
        "nook-app/nook-web/nook-web-app/tests/unit/lib/log.test.ts",
    );
    assert!(
        property_tests.contains("fc.property(")
            && property_tests.contains("never persists query or fragment secrets"),
        "the unit gate must retain a security-relevant property test"
    );
}
