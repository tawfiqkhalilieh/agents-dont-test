# Verified enrichment example

These artifacts were captured from `website/index.html` using the actual Browser Replay recorder. No `record_assert_text` call was made.

- `session.json`: the recorded form workflow.
- `raw.mjs`: unmodified exported actions, with no outcome assertions.
- `observations.json`: DOM evidence captured during the enrichment replay.
- `enriched.mjs`: seven assertions added through the real enrichment pipeline.
- `verification.json`: execution result and assertion provenance.

**Assertion provenance:** a deterministic test stand-in supplied the assertions for this example. They are not attributed to Flash. A real Antigravity CLI 1.2.7 invocation was attempted in the development workspace, but it required Google authentication and timed out before model execution. The production CLI/MCP path invokes `agy --agent assertion-enricher`; there is no automatic stand-in or larger-model fallback.

The enriched script verifies a visible confirmation with the expected message, one list item with the submitted values, cleared name/message fields, and the `#saved` URL. It was independently executed with Node and exited 0. The integration suite also changes the application's success message to an error and confirms that the text assertion fails.

To reproduce the verified script:

```sh
npm ci
npx playwright install chromium
npm run demo:serve
# In another terminal:
node examples/enrichment/enriched.mjs
```

To demonstrate actual Flash enrichment after authenticating Antigravity (stop the demo server first so port 4173 is free):

```sh
npm run setup
npm run demo:enrich
```

That command makes a fresh recording, calls the registered Flash agent, verifies its output, and writes artifacts to `recordings/demo`. It reports failure and retains the raw script if authentication or verification fails.
