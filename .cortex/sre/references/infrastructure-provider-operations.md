# Infrastructure Provider Operations

## Overview

Provider control planes are privileged production systems. Agents use the
smallest authenticated interface that can complete the authorized operation.
They preserve reusable local credentials automatically and never place secret
material in the repository.

## Provider access order

Use provider interfaces in this order:

1. Use the provider's authenticated MCP connection when it exposes the needed
   capability.
2. Use the provider's official API or CLI when MCP lacks that capability or
   cannot attach to the current session.
3. Use an authenticated browser only for initial authorization, credential
   bootstrap, or a capability unavailable through MCP, API, and CLI.

Do not begin with dashboard automation when a semantic provider interface is
available. A transient MCP failure does not justify creating a broad token.
Any fallback credential must have the narrowest practical permissions and
duration.

## Credential persistence hard rule

Automatically save every reusable provider credential under `~/.nook` as soon
as the provider returns it. Do not wait for a separate request.

- Create `~/.nook` and provider subdirectories with mode `0700`.
- Store credential files with mode `0600`.
- Use a provider-specific path such as `~/.nook/ovh-api.json`.
- Persist one-time credential responses before navigating away from them.
- Validate that the saved credential is readable and can perform an authorized
  read operation.
- Never print the credential while saving or validating it.
- Never commit credentials or copy them into Workbench, Cortex, logs,
  screenshots, task output, or pull-request text.
- Record only the expected local path and permission contract in repository
  documentation.
- Revoke and replace a credential immediately if secret material reaches an
  unauthorized surface.

This rule applies only to the authorized operator machine. Hosted runners and
other developers must receive credentials through their own reviewed secret
distribution boundary.

## Mutation contract

Before every provider mutation:

1. Read the current state.
2. Resolve the exact account, service, resource, and region identifiers.
3. Check that the requested operation matches the resolved target.
4. Use the narrowest reversible mutation available.
5. Poll the provider task to a terminal state.
6. Verify the resulting resource through both the provider API and its live
   service boundary when practical.

Destructive installation and reinstall operations require an exact target
check immediately before submission. Display names and stale inventory are not
sufficient authority.
