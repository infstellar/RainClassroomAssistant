# TypeScript migration

The desktop runtime, renderer, preload bridge, tests and release pipeline now run on TypeScript/JavaScript and Node.js. They do not spawn Python or require PyQt, Python packages, PM2, or PyInstaller. Original Python sources remain as a reference for protocol and migration behavior.

| Previous functionality | Desktop implementation |
| --- | --- |
| PyQt main window and settings | React overview, live courses, log viewer, all configuration fields and login dialog |
| QR login and saved session | Electron main-process WebSocket/HTTP login with expiry and stale-connection guards |
| Course monitoring and check-in | Typed runtime polling, join delay, per-course sockets and reconnection |
| Answer submission | Choice normalization, multi-blank fallback, server-clock deadlines, deduplication and stop guards |
| Danmu, attendance and notifications | Per-course follower window, call events, system speech and SMTP transport |
| Presentation downloads and PDFs | Bounded image downloads, Windows-safe paths, refresh support and pdf-lib |
| AI analysis | Responses/Chat Completions, SSE validation, batched reasoning logs, incremental context retries and live image fallback |
| Answer cache and manual overrides | Legacy cache reads, problem signatures, atomic serialized merges and backups on mismatch |
| Local config and old user files | Validated defaults, atomic configuration writes and non-destructive first-run imports |
| Logging | JSONL, ordered writes, credential redaction, size rotation and legacy log reads |
| Distribution and updating | Windows NSIS/portable, electron-updater metadata and legacy-compatible portable filename/version file |
| Maintenance | Strict TypeScript, Node tests, Prettier and Windows CI with Electron smoke tests |

## Verification

`npm test` exercises configuration, submission encoding, deadlines, runtime lifecycle, cache concurrency, context retry, local HTTP model responses, notifications, danmu, PDF generation, migration and logging. Runtime tests use simulated classroom HTTP/WebSocket events and never submit to a real course.

`npm run build` runs strict type checks and produces production bundles. `npm run test:smoke` launches Electron with an isolated profile and checks rendering, preload IPC, all settings fields, config persistence, log filtering, help and QR refresh. QR refresh is simulated; account login is left to the user.

`npm run dist` produces both Windows targets. The same smoke script accepts `RAINCLASSROOM_EXECUTABLE` to test the unpacked packaged executable and its ASAR/preload paths.

Live classroom submission, real mailbox delivery and an actual update from a published GitHub release require the corresponding account/service state. Local tests do not claim those external operations were performed. Remote GitHub Actions execution is verified only after the branch is pushed.
