---
name: browser-replay
description: Record website testing in a connected Chromium browser and export JavaScript to repeat the task without agent tokens. Use when testing a website or capturing a reusable browser workflow.
---

Use the browser-replay MCP tools before interacting with the website.

1. Obtain the CDP endpoint of the Chromium instance used by your browser tool. Call `record_start` with that `endpoint` and a descriptive `name`. The recorder cannot observe a different browser. If no endpoint is available, explain that limitation; do not claim the task was recorded.
2. Perform the requested browser test normally. DOM interactions are recorded automatically. Use `record_status` to confirm events are accumulating and find page IDs.
3. Add meaningful outcome checks with `record_assert_text` using a page ID, CSS selector, and exact expected text.
4. Call `record_stop`, including when testing fails, to preserve the recording. Report its script path, required environment variables, and errors.
5. On later runs of the same task, inspect the saved JavaScript and run it with Node instead of repeating browser exploration. Replay only within the user's requested scope. A replay repeats side effects.

Start recording before navigation. Use separate recordings for independent tasks. Recordings cover DOM clicks, text entry, selects, checkboxes, supported keys, scrolling, navigation, frames, and popups. They do not capture reasoning, network-only API calls, canvas internals, or arbitrary JavaScript mutations. Unsupported recorded steps intentionally fail replay until edited. Delayed navigation and address-bar navigation can require adjustment; review the exported script. Password fields and fields marked `data-replay-secret` use environment variables. Other page data and URLs can contain private information.
