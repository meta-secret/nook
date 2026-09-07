# Repository-managed JetStream

## Ownership

SRE owns the single `eventbus-default-js` StatefulSet, its headless and
WebSocket Services, configuration, credentials, and three retained local
volumes in the `argo-events` namespace. Argo Events consumes that same cluster
through the supported `jetstreamExotic` EventBus configuration. Argo must not
create a second JetStream cluster or regain ownership of the StatefulSet.

The initial transition is deliberately controlled because Argo Events v1.9.11
rejects an in-place native-to-exotic EventBus update. The deployment task first
copies the existing encryption key, TLS material, and Argo client credential to
the infrastructure secret store. It records all PVC identities and bindings,
stops the controller, orphans the controller-created server resources, removes
the native EventBus finalizer, and recreates the EventBus as exotic. The three
PVC identities and PV bindings must be unchanged after the repository-owned
StatefulSet starts. A mismatch fails the deployment.

## Public boundary

Traefik terminates trusted TLS for `wss://events.dev.nokey.sh` on public port
443 and forwards only WebSocket HTTP traffic to the private ClusterIP Service.
NATS ports 4222, 6222, 8222, and 9222 must never be host, NodePort, or
LoadBalancer listeners. The server permits the expected HTTPS Origin only.

## PR Steward identity

The infrastructure host owns the credential at
`$INFRA_REMOTE_DIR/secrets/jetstream/pr-steward-client.yaml` with mode `0600`;
the containing directories use mode `0700`. Kubernetes receives the same
material as `argo-events/jetstream-pr-steward-client`. Neither copy belongs in
Git, command arguments, or logs.

The identity can subscribe to `default.github-webhook.pr-lifecycle` and its
private inboxes. It can publish only the JetStream requests and acknowledgements
needed for the pre-created `default/pr-steward` durable pull consumer. Publishing
to application subjects is explicitly denied. The broad Argo client remains a
separate internal credential.

Rotate with `task infra:webhook-ingress:jetstream:pr-steward:rotate`. Rotation
replaces only the PR Steward password, republishes the Kubernetes Secret, and
rolls the repository-owned StatefulSet so new connections require the new
credential. Consumers must reload the handoff file after rotation.

Removal is a coordinated SRE change: remove the public Traefik router, delete
the durable consumer, remove the PR Steward user from the server authorization
file, republish the server Secret, roll the StatefulSet, and finally delete the
client Secret and remote handoff file. Removal must not delete the JetStream
StatefulSet, stream data, PVCs, PVs, Argo credential, or TLS material.
