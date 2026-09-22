# Isolated browser dogfood — 2026-09-21

Environment: Windows, Node 24.18.0, Codex in-app browser, temporary Git repository and data directory under agentos-ui-dogfood-Ku6L4Z. The server used an OS-assigned loopback port, an empty adapter list, and a no-op discovery function. No installed Agent, credentials, or personal AgentOS home was used. The 150 test-fixture events explicitly stated that they were not Agent results.

## Reproduced and repaired

1. Opening a task with 150 fixture events showed an empty timeline indefinitely. Browser console: ReferenceError: renderTab is not defined at ws.onmessage. The callback referenced a function scoped inside renderTaskDetail. Passing the view callback explicitly fixed replay rendering and reconnection. After reload the DOM contained 151 timeline rows: task.created plus all 150 fixture events.
2. Clicking Run with no adapters produced task.started and task.failed in real time, but the header remained created. The view now refreshes authoritative task status after operation completion/failure and task lifecycle events. A second task's failed status became visible without manual reload.
3. Directly reloading task detail showed an empty recent-task sidebar. Boot now loads tasks before rendering the detail view; both test tasks appeared after reload.
4. Opening Settings failed with TypeError: Cannot set properties of null (setting value), at the obsolete setDefaultProfile binding. The HTML has no such control. Removing that dead binding restored the settings dialog without adding a new setting.
5. Onboarding/settings claimed that data was never sent to servers. Text now distinguishes locally stored task records from the chosen CLI's possible transmission of code/context to model services. The settings wording was verified in the visible dialog.

## Validation scope

- Actual browser actions: task list, detail, 150-event replay, live failure events, switching to a second task, direct detail reload, opening settings. The second task displayed only its own three events after its deliberate no-adapter failure.
- The browser's retained console history contained the two pre-fix errors above; no new occurrences were observed after the relevant reloads.
- Automated browser-script callback tests use simulated sockets to check callback dispatch, rejecting obsolete task messages, and preserving callbacks through reconnect. These are unit tests, not browser or model E2E.
- The agent-created browser tab was closed and the owned temporary server exited with code 0 after its automatic deadline. No unrelated process was stopped.
- Not verified: successful real model runs, full first-install flow, long-session scale performance, macOS/Linux browser behavior, or a complete UX audit. Other asynchronous UI request paths still warrant later review.
