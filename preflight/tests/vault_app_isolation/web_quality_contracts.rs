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

    let research_manifest = read(&root, "nook-app/nook-web/nook-web-research/package.json");
    for required in [
        "\"security\": \"bun audit --prod --audit-level=high\"",
        "\"check\": \"bun run security",
    ] {
        assert!(
            research_manifest.contains(required),
            "the independently deployed research quality gate must retain `{required}`"
        );
    }

    let eslint = read(&root, "nook-app/nook-web/eslint.config.js");
    for required in [
        "'max-params': ['error', { max: 1 }]",
        "'@typescript-eslint/no-restricted-types'",
        "Nook web forbids unknown",
        "'nook-typed-api/no-raw-object-arguments': 'error'",
        "TSAsExpression",
        "TSTypeAssertion",
        "TSSatisfiesExpression",
        "TSNonNullExpression",
        "unwrapTypeScriptExpression(argument).type === 'ObjectExpression'",
        "named typed value first",
        "sourceCode.getScope(identifier)",
        "variable.defs",
        "definition.name.typeAnnotation",
        "explicitly typed named declaration",
        "nook-web-extension/src/lib/**/*.ts",
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
        extension_manifest
            .contains("eslint --config ../eslint.config.js scripts src e2e playwright.config.ts"),
        "the extension lint command must retain its production source tree"
    );

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
