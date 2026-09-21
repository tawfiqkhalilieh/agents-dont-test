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

## Development

```sh
npm test
```

Integration tests run Chromium, record real interactions, execute the exported scripts, and verify the resulting requests. Coverage includes forms, credential redaction, frames, popups, external CDP clients, MCP protocol lifecycle, and configuration preservation. A GitHub Actions template is provided at `ci/github-actions.yml`. Copy it to `.github/workflows/test.yml` using credentials with workflow permission to enable CI. The development token could not install workflows.

Source: `capture.js` installs browser observers; `recorder.js` manages sessions/journals; `generate.js` emits JavaScript; `server.js` exposes the MCP tools. Generated scripts are ordinary files: check useful recordings into your own test suite after reviewing their data and adding assertions.
