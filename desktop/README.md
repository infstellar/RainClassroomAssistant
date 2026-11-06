# TypeScript Desktop

Electron + React + strict TypeScript application. User-facing setup, privacy, feature, and release documentation lives in the [project README](../README.md).

## Development

Requires Node.js 22.7 or newer:

```powershell
npm ci
npm run dev
```

Run `npm test` for unit tests, `npm run build` for strict type-checking and production bundles, and `npm run dist` on Windows to create the Setup installer and portable executable in `release/`.

Run `npm run test:smoke` after building to exercise the real Electron UI, preload IPC, settings persistence, log filters, help, and QR refresh. It uses an isolated temporary profile and writes screenshots to `test-results/`. Set `RAINCLASSROOM_EXECUTABLE` to a packaged executable to verify that build instead. `npm run format:check` checks source formatting; `npm run format` applies it.

The optional Electron `--user-data-dir=<absolute path>` switch opens a separate profile and disables automatic legacy imports. It is used by smoke tests so they cannot read existing account credentials.

`npm run preview:web` serves a renderer-only browser preview at `http://127.0.0.1:5173`; desktop-only actions are unavailable in that preview.

## Releases and updates

Push and pull request checks run formatting, tests, production build, and Electron smoke checks on Windows. Only a new stable `vMAJOR.MINOR.PATCH` tag on `main` publishes a release. See the root README for the release commands.

`npm run test:updater` covers updater scheduling, concurrent requests, download state, retries, and release integrity validation. `node scripts/verify-release.mjs` verifies the packaged assets and writes checksums. The release workflow uploads a draft before publishing all update assets together. Setup installations check after five seconds and every four hours; portable, development, and isolated test profiles use manual downloads.
