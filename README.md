# Immich for Homey

Connects [Immich](https://immich.app) — the self-hosted photo and video manager — to Homey, giving you flow automation and a live photo widget for the Homey Pro dashboard.

## Requirements

- Homey Pro (2023 or later) for the dashboard widget
- Immich v2.7.5 or later
- An Immich API key (generate one in Immich → Account Settings → API Keys)

## Setup

Add the Immich device through Homey's device pairing flow. You will be asked for:

- **URL** — the full address of your Immich server, including scheme and port if needed (e.g. `http://192.168.1.100:2283` or `https://photos.example.com`)
- **API key** — your Immich API key

A connection test runs before the device is added. The device polls Immich on a configurable interval (default: 60 seconds, minimum: 10 seconds).

Multiple Immich instances are supported by adding more than one device.

## Triggers

**A photo or video was uploaded** — fires for every new asset that appears in Immich since the last poll. Provides tokens for asset ID, type, filename, date taken, thumbnail URL, and a **Photo image token** you can drop into Homey Gallery, push notifications, or any flow card that accepts an image.

**A person appeared in a new photo** — fires for each recognised person in a newly uploaded asset. You configure which person to watch using an autocomplete picker. Provides tokens for the person's name, asset ID, thumbnail URL, and a Photo image token.

**An album received a new asset** — fires once per newly added asset when an album you've chosen gains assets. Detection is set-diff based, so it works whether you uploaded a fresh photo or added an existing one. Provides tokens for the album name, new total count, the new asset's ID, filename, and a Photo image token.

**New duplicates were found** — fires when Immich detects more duplicate groups than the previous poll. Provides a token with the current number of duplicate groups.

**An "On This Day" memory year is available** — fires once per memory year on the first poll of the day (e.g. once for 2022 and again for 2019). Provides tokens for the year, the number of photos in that year's memory, and a Photo image token of the first asset.

**Disk space dropped below a threshold** — fires once when free disk space drops below a threshold you set, and resets when space rises back above it. Provides a token with the current free space in GB.

## Conditions

**There were uploads today** — true if any asset was uploaded since midnight.

**There were uploads in the last X minutes** — true if any asset was uploaded within the given number of minutes.

**Disk space is below X GB** — true if free disk space is currently below the threshold.

## Actions

**Get a random photo** — fetches a random asset from Immich and provides its asset ID, type, filename, date taken, thumbnail URL, and a Photo image token for use in subsequent cards.

**Add to album / Remove from album** — moves an asset into or out of an album. The album is selected from an autocomplete list of your albums.

**Create album** — creates a new album by name and provides the new album's ID as a token.

**Create shared link** — creates a public share link for a single asset and provides the URL as a token.

**Create shared link for album** — creates a public share link for an entire album and provides the URL as a token.

**Favourite / Unfavourite an asset** — marks or unmarks an asset as a favourite.

**Archive / Unarchive an asset** — moves an asset to or from the archive.

**Set description** — sets or updates the description text on an asset.

**Trigger a job** — starts one of Immich's background jobs (thumbnail generation, face detection, video transcoding, etc.).

## Capabilities

The Immich device exposes the following sensor values on its device tile:

- Photo count and video count
- Storage used (GB)
- Free disk space (GB)
- Number of recognised people
- Number of albums
- Number of items in trash
- Number of duplicate groups

All values update on each poll and are available in Homey Insights.

## Dashboard widget

The **Immich Photo** widget displays a photo from your Immich library on the Homey Pro dashboard. The Immich device is selected when you add the widget; each widget instance binds to one device, so multiple Immich servers and multiple widgets each pointing at a different album are all supported. Configure the widget by tapping its settings:

- **Widget shape** — square, landscape, wide, portrait, or tall (drives the tile's aspect ratio via dynamic height)
- **Photo fit** — fill (crop edges) or fit (show whole photo with letterboxing)
- **Album** — autocomplete picker. Choose *All photos* to use the whole library or pick a specific album to restrict the widget to it
- **Photo source** — random photo, latest upload, or today's memory
- **Refresh interval** — how often to load a new photo (10–3600 seconds)
- **Show filename and date** — toggle the metadata overlay at the bottom of the photo

## Notes

Non-admin API keys cannot access server statistics (photo/video counts and storage). All other features work with any valid API key. The app degrades gracefully — missing statistics simply leave those capability values unchanged rather than marking the device unavailable.
