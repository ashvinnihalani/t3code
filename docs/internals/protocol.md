# Protocol

The generated client is pinned to the OpenAI Codex source commit recorded in
`packages/effect-codex-app-server/scripts/generate.ts` and
`packages/app-server-conformance/reference-manifest.json`. Updating the pin requires regenerating
schemas and rerunning the protocol, transport, and conformance tests as one change.

The protocol package separates wire transport from process launch. Desktop uses the MessagePort
transport; tests and probes may use child-process stdio directly. A generic harness is compatible
when it accepts the same JSONL requests, returns schema-compatible responses, and preserves the
required notification ordering.

## Remote

Remote pairing is an app-server feature. T3 Codex calls the pinned experimental methods directly:

- `remoteControl/status/read`
- `remoteControl/enable`
- `remoteControl/disable`
- `remoteControl/pairing/start`
- `remoteControl/pairing/status`
- `remoteControl/client/list`
- `remoteControl/client/revoke`

The renderer may format values returned by those methods, but it must not construct a pairing link
or protocol of its own. `remoteControl/status/changed` is the source of live Remote status updates.
