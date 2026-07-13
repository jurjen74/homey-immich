# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Homey smart home app (SDK v3) that integrates Immich, the self-hosted photo management platform. App ID: `net.ladenius.immich`. Supported Immich versions: 2.7.5 through 3.x. The API client targets endpoints present across that whole range (e.g. `POST /search/random` rather than the v3-removed `GET /assets/random`; `PUT /assets/{id}` for single-asset updates), so no version-detection logic is needed.

## Commands

```bash
npm run lint                  # ESLint using athom/homey-app config
homey app run                 # run on Homey during development
homey app install             # install on Homey
```

No build step — runs directly as Node.js. All user configuration (URL, API key, poll interval) is entered through Homey's device pairing UI — no config files needed.

## Architecture

```
app.js                               — registers the widget's album autocomplete listener via homey.dashboards
lib/ImmichApi.js                     — HTTP client for the Immich REST API (/api/*)
drivers/immich/
  driver.compose.json                — settings (url, apiKey, poll_interval), pairing flow
  driver.js                          — flow card registration + autocomplete listeners + onPair
  device.js                          — polling loop, trigger firing, album set-diff tracking
  pair/connect.html                  — pairing UI (URL + API key form)
.homeycompose/flow/triggers/         — new_asset, new_memory, person_in_new_photo,
                                       album_got_new_asset, new_duplicate, disk_space_low
.homeycompose/flow/conditions/       — new_uploads_today, uploads_in_last_x_minutes,
                                       disk_space_below
.homeycompose/flow/actions/          — random_photo, add_to_album, remove_from_album,
                                       create_album, share_album, create_shared_link,
                                       favorite/unfavorite/archive/unarchive_asset,
                                       set_description, trigger_job
widgets/immich_photo/
  widget.compose.json                — widget settings + devices binding + api endpoints
  api.js                             — getPhoto endpoint (driver lookup by device.getId())
  public/index.html                  — widget HTML, uses onHomeyReady pattern
locales/en.json / nl.json            — English / Dutch UI strings (pairing only)
```

## Key conventions

- **Do not edit `app.json` directly** — generated from `.homeycompose/`. Edit `.homeycompose/app.json` and `drivers/immich/driver.compose.json`.
- **Immich API** (`lib/ImmichApi.js`) uses Node's built-in `http`/`https` module. All endpoints are under `/api/`. Auth via `x-api-key` header. The module (`http` vs `https`) is selected in the constructor from the URL scheme. `getThumbnailStream(id, size)` returns the raw response stream for piping into Homey image tokens; `getThumbnail(id, size)` buffers it (used by the widget's `/photo` API endpoint).
- **Polling** lives in `device.js`. `_lastPolledAt` is initialized to `new Date()` in `onInit` so existing assets never re-fire on restart. `_lastMemoryDate` (ISO date string, persisted via `setStoreValue`) gates the memory check to once per day across restarts.
- **New asset detection** uses `POST /api/search/metadata` with `createdAfter` = last poll timestamp and `withPeople: true`. Paginated up to 50 × 100 = 5000 assets per poll. This single call covers both `new_asset` and `person_in_new_photo` triggers.
- **Flow-card run listeners use positional args, NOT a destructured first parameter.** Homey's `RunCallback` signature is `(args, state)` for triggers and `(args)` for actions/conditions — `args` is the args object itself, with `args.device`, `args.threshold`, etc. on it. Writing `({ args, state }) => …` silently makes `args` and `state` undefined and the resulting `TypeError` is swallowed by Homey, causing the flow to never fire with no log. Always write `(args, state) => args.album.id === state.albumId` or `(args) => args.device.cmdX(args.y)`.
- **`person_in_new_photo`** uses a state-based trigger: `trigger(device, tokens, { personId })` paired with `(args, state) => args.person.id === state.personId`. One trigger fires per recognized person per asset. `album_got_new_asset` follows the same pattern with `albumId`.
- **`album_got_new_asset` uses set-diff tracking, not count-based detection.** `device.js` keeps `_albumAssetIds[albumId]` as a `Set<assetId>`. On first poll per album the set is baselined (fire-and-forget via `_baselineAlbumAssetIds`). When the album's count goes up, `_getNewlyAddedAlbumAssets` fetches the album, diffs against the baseline, and the trigger fires once per newly added asset in upload order. The Immich `/api/albums/{id}` endpoint includes the asset list directly; sorting by `fileCreatedAt`/`updatedAt` is unreliable because adding an existing photo to an album doesn't move those timestamps.
- **Image tokens** (`new_asset`, `person_in_new_photo`, `new_memory`, `album_got_new_asset`, `random_photo`) are created via `device._createAssetImage(assetId)` which calls `this.homey.images.createImage()` then `await image.setStream(async (stream) => { const res = await this._api.getThumbnailStream(assetId); return res.pipe(stream); })`. The setStream callback returns the pipe — Homey expects the callback to set up streaming and return, not to await the full transfer. Images are auto-unregistered after 10 minutes via `setTimeout` to avoid leaks.
- **Autocomplete args** (`person`, `album`) use `getArgument('name').registerAutocompleteListener((query, args) => [...])`. The listener receives `args.device` to access `device._api`. People are paginated through `getAllPeople()` (loops `?page=N&size=500`) so libraries with more than one page are fully searchable.
- **`create_shared_link`** returns `{ link_url }` from its run listener — this becomes an action output token available to subsequent cards in the same flow.
- **`trigger_job`** sends `{ command: 'start', force: false }` to `PUT /api/jobs/{jobId}`. The `job` arg is a dropdown; its value in the run listener is the selected id string.

## Widget conventions

- **Widget manager is `this.homey.dashboards`, not `this.homey.widgets`** — the latter is `undefined` on Homey Pro (Early 2023) and triggers `Cannot read properties of undefined (reading 'getWidget')` on app startup.
- **Widget binds to a device via the `devices` field in `widget.compose.json`** (`{ type: "app", singular: true, filter: { capabilities: "immich_photo_count" } }`), not via a `device`-type setting autocomplete. Inside the iframe `Homey.getDeviceIds()` returns the chosen device's Homey UUID. In `api.js` look it up with `driver.getDevices().find(d => d.getId() === deviceId)` — `device.getData().id` is the Immich URL we use for pairing identity, not the runtime device id.
- **Widget HTML uses the `onHomeyReady(Homey)` global entry point** (defined at script top-level, NOT `Homey.ready(callback)`). Inside, call `Homey.ready()` once with no arguments to dismiss the loading spinner, then use synchronous `Homey.getSettings()`, `Homey.getDeviceIds()`, and `Homey.api()`. `Homey.setHeight(px)` resizes the iframe; we call it from a `ResizeObserver` on the wrapper so the photo's aspect ratio is recomputed when the dashboard column width changes.
- **The album setting on the widget** uses an autocomplete registered in `app.js` against `homey.dashboards.getWidget('immich_photo')`. The autocomplete listener returns `[{ id: '__all__', name: 'All photos' }, …albums]`; `widgets/immich_photo/api.js` treats `albumId === '__all__'` as the whole library.
