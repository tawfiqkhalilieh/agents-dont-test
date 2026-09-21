# Browser Replay — agents-dont-test

Record a website test once while an agent explores it. Repeat the captured workflow with JavaScript instead of spending tokens on the same browser task again.

Browser Replay is a local MCP plugin for Claude Code, Codex, and Antigravity. Setup also configures VS Code. It attaches to the **same Chromium browser** used by the testing agent, observes DOM interactions, and exports Playwright JavaScript. Recording and replay require no model, API key, or Ollama instance; your agent can use whichever model its host supports.

## Install in a checkout

Requires Node.js 20+ and Chromium installed through Playwright:

```sh
npm ci
npx playwright install chromium
npm run setup
```

On Linux machines missing browser libraries, use `npx playwright install --with-deps chromium`.

Setup merges a `browser-replay` MCP entry into these project files, preserving other servers and backing up changed configurations:

| Host | Configuration |
| --- | --- |
| Claude Code | `.mcp.json` |
| Codex CLI / IDE extension | `.codex/config.toml` |
| Antigravity | `.agents/mcp_config.json` |
| VS Code | `.vscode/mcp.json` |

It installs the recording workflow skill into `.agents/skills` and `.claude/skills`. Restart the host or reload its MCP servers. Host trust and MCP enablement settings still apply. To configure another project, run `npm run setup -- /absolute/path/to/project`. Keep this checkout in place: setup writes absolute paths to its server and to the target project's `recordings` directory. Run setup again after moving it. Existing JSONC configs are normalized to JSON; their original contents are backed up beside them.

This uses the documented [Codex MCP configuration](https://developers.openai.com/codex/mcp), [Claude plugin format](https://code.claude.com/docs/en/plugins-reference), and [Antigravity workspace MCP configuration](https://antigravity.google/docs/mcp). Host UI activation must be verified on the machine running those applications.

The plugin source lives in `plugins/browser-replay`, with Claude and Codex manifests and a bundled skill. Claude can also load the source plugin with `claude --plugin-dir ./plugins/browser-replay` after dependencies are installed. Prefer project setup for Codex because it uses absolute paths and does not depend on host-specific plugin-cache behavior. Do not enable both installation modes in the same host. Marketplace publication is not required.

## Record a task

Start a Chromium browser that exposes a local debugging endpoint:

```sh
npm run browser
# For a machine without a display:
HEADLESS=1 npm run browser
```

The default endpoint is `http://127.0.0.1:9222`; use `CDP_PORT` to choose a different port. Configure your agent's browser tool to connect to this browser too. An existing Chromium instance with a CDP endpoint also works. Keep its debugging port on localhost.

Ask your agent:

> Record the checkout test using browser-replay at http://127.0.0.1:9222, verify the confirmation message, then export the replay.

The agent follows this sequence:

1. `record_start({"name":"checkout","endpoint":"http://127.0.0.1:9222"})`
2. Use its normal browser tools to perform the task. Capture continues between tool calls, including human interaction with that browser.
3. `record_status({})` to inspect page IDs and confirm events are accumulating.
4. `record_assert_text({"page":0,"selector":"[data-testid=confirmation]","text":"Order received"})` to save a verified outcome check.
5. `record_stop({})` to export the script and disconnect. The external browser stays open.

Only start one recorder for a given task. Start before navigating to the website. The selected browser context's existing tabs, new tabs, frames, and popups are observed. Other browser contexts are not captured. The recorder cannot watch a host's isolated browser if that host does not expose its debugging endpoint.

Without `endpoint`, `record_start` launches a new isolated browser, optionally with `url` and `headless:false`. This mode is useful for manual recording; an agent using another browser will not be observed.

## Replay without an agent

`record_stop` returns paths for three artifacts under `recordings/`:

- `.jsonl`: incremental raw event journal, useful if a session is interrupted.
- `.json`: normalized events, required environment variable names, and capture errors.
- `.mjs`: runnable JavaScript with Playwright's locator auto-waiting and browser cleanup.

```sh
node recordings/checkout-<session-id>.mjs
# Show the browser during replay:
HEADLESS=0 node recordings/checkout-<session-id>.mjs
```

Run scripts from this checkout, where Playwright is installed. When moving a script to another project, install `playwright` there and install its Chromium browser. Replays launch a fresh browser context. Configure authentication/fixtures in the script when the original session depended on existing login state. A replay repeats actions and their side effects; assertions must be added for it to verify outcomes.

Password inputs, fields marked `data-replay-secret`, and inputs whose names/IDs indicate credentials become required environment variables, such as `REPLAY_SECRET_1`. Sensitive query parameters become separate `REPLAY_URL_SECRET_*` variables. Supply those variables through your environment or secret manager. Missing values fail with the variable name. No secret values are printed by the recorder. Ordinary form values, text assertions, URL paths/fragments, and selectors remain in recordings; automatic redaction is not a complete sensitive-data detector. Output directories and files use restrictive creation permissions and are gitignored.

## What is captured

Clicks, text input and contenteditable changes, select options, checkbox/radio state, Enter/Tab/Escape/arrow keys with modifiers, scroll positions, page navigation, frame interactions, popups, page closure, and explicit text assertions. Consecutive typing/scroll events for the same target are consolidated. Selectors prefer unique test IDs, IDs, names, and accessible labels; open shadow roots are supported.

This is DOM observation, not a recording of the agent's thoughts or its entire tool protocol. It cannot reproduce arbitrary JavaScript evaluations, API-only requests, browser chrome, native dialogs, hover-only workflows, canvas internals, closed shadow roots, or filesystem effects. File selection, drag and drop, and JavaScript dialogs produce explicit manual-step failures instead of pretending the exported script is complete. Custom widgets, unstable DOM selectors, and navigation after long delays can require editing.

Navigation shortly following a click or keypress becomes a URL checkpoint, so replay does not submit forms twice. Direct navigation becomes `goto`. Since a DOM observer cannot always distinguish delayed application navigation from a separately requested agent navigation, review those transitions in the generated script. Record independent tasks separately. A changed website or starting state can invalidate a recording.

## Add assertions with a Flash subagent

After `record_stop`, enrich an unmodified export with Antigravity's `assertion-enricher`:

```sh
npm run setup
npm run enrich -- recordings/session.mjs recordings/session.json
# Or call the MCP tool:
# record_enrich({"scriptPath":"/project/recordings/session.mjs","recordingPath":"/project/recordings/session.json"})
```

This optional step requires an installed, authenticated [Antigravity CLI](https://antigravity.google/docs/cli/install). Use `BROWSER_REPLAY_AGY=/absolute/path/to/agy` if it is not on PATH. The application must be running, and any `requiredEnv` values from the recording must be available. Existing host command permissions must allow the agent to run Node for its verification; enrichment does not change global permission settings. If an MCP client has a short tool timeout, use the standalone command. Setup gives Codex a 900-second tool timeout.

The registered [agent specification](.agents/agents/assertion-enricher.md) uses `model: flash` and only `view_file`, `replace_file_content`, `write_to_file`, and `run_command`; inherited MCP tools are disabled. The canonical plugin copy is in `plugins/browser-replay/agents/`. Setup installs it in the target workspace. The same specification is selectable through Antigravity's [`--agent` headless option](https://antigravity.google/docs/cli/headless/) and callable as a [custom subagent](https://antigravity.google/docs/subagents?tab=cli). `mainAgent: true` permits the CLI to select it directly, avoiding an extra orchestrator model call. The CLI resolves the `flash` tier; no larger-model fallback is requested.

Enrichment performs these steps:

1. Verify that the script matches its recording; fail without overwriting manually edited tests.
2. Replay the raw script headlessly and sample the target DOM after actions. Evidence includes visible status text, list/table counts and items, field values, and URLs. The short sampling window is bounded; absent evidence is not a reason to invent an assertion.
3. Give the agent the recording, action summary, DOM evidence, and a candidate script with numbered insertion slots. It adds retrying Playwright `expect` assertions for outcomes: confirmation visibility/text, changed items/counts, cleared/persisted inputs, and navigation.
4. Validate that only assertion slots changed, then independently execute `node candidate.mjs` with `HEADLESS=1`. The agent is instructed to verify once too. On failure, supply bounded error output for correction, up to three attempts. Retries cannot remove previously validated matcher types/counts to make failures disappear.
5. Publish only a verified candidate. Keep an original backup, DOM evidence, and attempt report under a private `.assertion-enrichment-*` directory alongside the script. Failure preserves the original and writes diagnostics. A per-script lock prevents concurrent enrichment; after an interrupted process, remove a stale `.enrichment.lock` only when no enrichment is running.

`--max-attempts 1` limits model retries; `--workspace /project` selects a different registered workspace. Each agent invocation has a three-minute limit and each replay a one-minute limit. Execution repeats task side effects: the default workflow can run once for observation plus once per agent attempt and once per independent verification (up to seven executions). Use a resettable test application. Assertion checks are additive and cannot rewrite actions, swallow exceptions, or force success. They do not prove that a model inferred the right business requirement; review the resulting diff. Unsupported/manual recording steps fail before enrichment.

Enriched scripts import `expect` from `@playwright/test`, which is included in this plugin's dependencies. Install it alongside Playwright when moving an enriched script to another project. Ordinary DOM text and recording values are available to the selected model; credential controls and known secret environment values are redacted from collected evidence. Recordings, observations, and website content are explicitly treated as untrusted data by the agent prompt.

### Demo

`website/index.html` is a resettable form that adds a submission to a list, clears its fields, shows a confirmation, and updates the URL fragment.

```sh
# Record the demo, invoke the REAL authenticated Flash agent, and verify:
npm run demo:enrich
# Prepare raw artifacts without a model:
npm run demo:enrich -- --record-only
# Serve the demo for replaying saved artifacts:
npm run demo:serve
```

The live demo uses `http://127.0.0.1:4173/` and writes raw, recording, and enriched artifacts into `recordings/demo/`. Use `--port` for a different port when recording; use `BROWSER_REPLAY_DEMO_PORT` when serving. [The checked-in demonstration](examples/enrichment/README.md) identifies how its assertions were produced and how they were verified. Integration tests use a deterministic agent stand-in, run real Chromium replays, and deliberately break the application to verify that added assertions catch a regression. They do not claim to validate Flash output or account authentication.

## Development

```sh
npm test
```

Integration tests run Chromium, record real interactions, execute the exported scripts, and verify the resulting requests. Coverage includes forms, credential redaction, frames, popups, external CDP clients, MCP protocol lifecycle, and configuration preservation. A GitHub Actions template is provided at `ci/github-actions.yml`. Copy it to `.github/workflows/test.yml` using credentials with workflow permission to enable CI. The development token could not install workflows.

Source: `capture.js` installs browser observers; `recorder.js` manages sessions/journals; `generate.js` emits JavaScript; `server.js` exposes the MCP tools. Generated scripts are ordinary files: check useful recordings into your own test suite after reviewing their data and adding assertions.
