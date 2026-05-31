# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Homey smart home app (SDK v3) that integrates Immich, the self-hosted photo management platform. App ID: `net.ladenius.immich`. Minimum supported Immich version: 2.7.5.

## Commands

```bash
npm run lint                  # ESLint using athom/homey-app config
homey app run                 # run on Homey during development
homey app install             # install on Homey
```

No build step — runs directly as Node.js. All user configuration (URL, API key, poll interval) is entered through Homey's device pairing UI — no config files needed.

## Architecture

```
lib/ImmichApi.js                    — HTTP client for the Immich REST API (/api/*)
drivers/immich/
  driver.compose.json                — settings (url, apiKey, poll_interval), pairing flow
  driver.js                          — flow card registration + autocomplete listeners + onPair
  device.js                          — polling loop, trigger firing
  pair/connect.html                  — pairing UI (URL + API key form)
.homeycompose/flow/triggers/         — new_asset, new_memory, person_in_new_photo
.homeycompose/flow/conditions/       — new_uploads_today
.homeycompose/flow/actions/          — add_to_album, create_shared_link, trigger_job
locales/en.json                      — English UI strings
locales/nl.json                      — Dutch UI strings
```

## Key conventions

- **Do not edit `app.json` directly** — generated from `.homeycompose/`. Edit `.homeycompose/app.json` and `drivers/immich/driver.compose.json`.
- **Immich API** (`lib/ImmichApi.js`) uses Node's built-in `http`/`https` module. All endpoints are under `/api/`. Auth via `x-api-key` header. The module (`http` vs `https`) is selected in the constructor from the URL scheme.
- **Polling** lives in `device.js`. `_lastPolledAt` is initialized to `new Date()` in `onInit` so existing assets never re-fire on restart. `_lastMemoryDate` (ISO date string) gates the memory check to once per day.
- **New asset detection** uses `POST /api/search/metadata` with `createdAfter` = last poll timestamp and `withPeople: true`. This single call covers both `new_asset` and `person_in_new_photo` triggers.
- **`person_in_new_photo`** uses a state-based trigger: `trigger(device, tokens, { personId })` paired with `registerRunListener(({ args, state }) => args.person.id === state.personId)`. One trigger fires per recognized person per asset.
- **Autocomplete args** (`person`, `album`) use `getArgument('name').registerAutocompleteListener((query, args) => [...])`. The listener receives `args.device` to access `device._api`.
- **`create_shared_link`** returns `{ link_url }` from its run listener — this becomes an action output token available to subsequent cards in the same flow.
- **`trigger_job`** sends `{ command: 'start', force: false }` to `PUT /api/jobs/{jobId}`. The `job` arg is a dropdown; its value in the run listener is the selected id string.
