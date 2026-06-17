'use strict';

const Homey = require('homey');
const ImmichApi = require('../../lib/ImmichApi');

class ImmichDevice extends Homey.Device {

  async onInit() {
    this._api = new ImmichApi(this.getSettings());
    this._lastPolledAt = new Date(); // baseline — don't re-trigger for existing assets
    this._lastMemoryDate = this.getStoreValue('lastMemoryDate') ?? null;
    this._prevDiskFreeGb = null;
    this._prevDuplicateCount = null;
    this._albumAssetCounts = {};
    this._albumAssetIds = {}; // { albumId: Set<assetId> } — used to identify newly added assets

    for (const cap of [
      'immich_photo_count', 'immich_video_count', 'immich_storage_used', 'immich_disk_free',
      'immich_person_count', 'immich_album_count', 'immich_trash_count', 'immich_duplicate_count',
    ]) {
      if (!this.hasCapability(cap)) await this.addCapability(cap);
    }

    this._startPolling();
    this.log(`${this.getName()} initialized`);
  }

  _startPolling(intervalSeconds) {
    const secs = intervalSeconds ?? this.getSetting('poll_interval') ?? 60;
    this._pollTimer = this.homey.setInterval(() => this._poll(), secs * 1000);
    this._poll().catch((err) => this.error(err));
  }

  _stopPolling() {
    if (this._pollTimer) {
      this.homey.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _poll() {
    const pollStart = new Date();
    try {
      await Promise.all([
        this._checkNewAssets(),
        this._checkMemories(),
        this._checkServerStats(),
      ]);
      this._lastPolledAt = pollStart;
      if (!this.getAvailable()) await this.setAvailable();
    } catch (err) {
      this.error('Poll failed:', err.message);
      await this.setUnavailable(err.message);
    }
  }

  async _checkServerStats() {
    const [statsResult, storageResult, peopleResult, albumsResult, duplicatesResult, trashResult] = await Promise.allSettled([
      this._api.getServerStatistics(),
      this._api.getServerStorage(),
      this._api.getPeople(),
      this._api.getAlbums(),
      this._api.getDuplicates(),
      this._api.getTrashCount(),
    ]);

    if (statsResult.status === 'fulfilled') {
      const s = statsResult.value;
      await Promise.all([
        this.setCapabilityValue('immich_photo_count', s?.photos ?? 0),
        this.setCapabilityValue('immich_video_count', s?.videos ?? 0),
        this.setCapabilityValue('immich_storage_used', parseFloat(((s?.usage ?? 0) / 1e9).toFixed(1))),
      ]);
    } else {
      this.log('Server statistics unavailable (non-admin key?):', statsResult.reason?.message);
    }

    if (storageResult.status === 'fulfilled') {
      const stor = storageResult.value;
      const diskFreeGb = parseFloat(((stor?.diskAvailableRaw ?? 0) / 1e9).toFixed(1));
      await this.setCapabilityValue('immich_disk_free', diskFreeGb);

      if (this._prevDiskFreeGb !== null) {
        this.driver.triggerDiskSpaceLow(
          this,
          { disk_free_gb: diskFreeGb },
          { diskFreeGb, prevDiskFreeGb: this._prevDiskFreeGb },
        ).catch(this.error.bind(this));
      }
      this._prevDiskFreeGb = diskFreeGb;
    } else {
      this.log('Server storage unavailable:', storageResult.reason?.message);
    }

    if (peopleResult.status === 'fulfilled') {
      const count = peopleResult.value?.total ?? (peopleResult.value?.people?.length ?? 0);
      await this.setCapabilityValue('immich_person_count', count);
    }

    if (albumsResult.status === 'fulfilled') {
      const albums = Array.isArray(albumsResult.value) ? albumsResult.value : [];
      await this.setCapabilityValue('immich_album_count', albums.length);

      const currentIds = new Set();
      for (const album of albums) {
        currentIds.add(album.id);
        const prev = this._albumAssetCounts[album.id];
        const curr = album.assetCount ?? 0;
        if (prev !== undefined && curr > prev) {
          const newlyAdded = await this._getNewlyAddedAlbumAssets(album.id).catch(() => []);
          for (const asset of newlyAdded) {
            const photo = await this._createAssetImage(asset.id).catch(() => null);
            this.driver.triggerAlbumGotNewAsset(
              this,
              {
                album_name: album.albumName ?? '',
                asset_count: curr,
                asset_id: asset.id,
                filename: asset.originalFileName ?? '',
                photo,
              },
              { albumId: album.id },
            ).catch(this.error.bind(this));
          }
        } else if (prev === undefined && curr > 0) {
          this._baselineAlbumAssetIds(album.id).catch((err) => this.log(`Album baseline failed for "${album.albumName}": ${err.message}`));
        }
        this._albumAssetCounts[album.id] = curr;
      }

      for (const id of Object.keys(this._albumAssetCounts)) {
        if (!currentIds.has(id)) {
          delete this._albumAssetCounts[id];
          delete this._albumAssetIds[id];
        }
      }
    }

    if (duplicatesResult.status === 'fulfilled') {
      const count = Array.isArray(duplicatesResult.value) ? duplicatesResult.value.length : 0;
      await this.setCapabilityValue('immich_duplicate_count', count);

      if (this._prevDuplicateCount !== null && count > this._prevDuplicateCount) {
        this.driver.triggerNewDuplicate(this, { duplicate_count: count })
          .catch(this.error.bind(this));
      }
      this._prevDuplicateCount = count;
    }

    if (trashResult.status === 'fulfilled') {
      await this.setCapabilityValue('immich_trash_count', trashResult.value ?? 0);
    }
  }

  async _checkNewAssets() {
    const baseUrl = this.getSetting('url').replace(/\/$/, '');
    const PAGE_SIZE = 100;
    const MAX_PAGES = 50;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await this._api.searchAssets({
        createdAfter: this._lastPolledAt,
        order: 'asc',
        size: PAGE_SIZE,
        page,
        withPeople: true,
      });

      const items = result?.assets?.items ?? [];
      if (items.length === 0) break;

      for (const asset of items) {
        const thumbUrl = `${baseUrl}/api/assets/${asset.id}/thumbnail`;
        const photo = await this._createAssetImage(asset.id).catch(() => null);

        this.driver.triggerNewAsset(this, {
          asset_id: asset.id,
          type: asset.type ?? 'IMAGE',
          filename: asset.originalFileName ?? '',
          taken_at: asset.fileCreatedAt ?? '',
          thumb_url: thumbUrl,
          photo,
        }).catch(this.error.bind(this));

        for (const person of (asset.people ?? [])) {
          if (!person.id || !person.name) continue;
          this.driver.triggerPersonInNewPhoto(
            this,
            {
              person_name: person.name, asset_id: asset.id, thumb_url: thumbUrl, photo,
            },
            { personId: person.id },
          ).catch(this.error.bind(this));
        }
      }

      if (items.length < PAGE_SIZE) break;
    }
  }

  async _checkMemories() {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (this._lastMemoryDate === todayStr) return;

    const memories = await this._api.getMemories(todayStr);
    for (const memory of (memories ?? [])) {
      const firstAssetId = memory?.assets?.[0]?.id;
      const photo = firstAssetId
        ? await this._createAssetImage(firstAssetId).catch(() => null)
        : null;

      this.driver.triggerNewMemory(this, {
        year: memory?.data?.year ?? 0,
        asset_count: memory?.assets?.length ?? 0,
        photo,
      }).catch(this.error.bind(this));
    }

    this._lastMemoryDate = todayStr;
    await this.setStoreValue('lastMemoryDate', todayStr);
  }

  async onSettings({ newSettings }) {
    this._stopPolling();
    this._api = new ImmichApi(newSettings);
    this._startPolling(newSettings.poll_interval);
  }

  onDeleted() {
    this._stopPolling();
  }

  // ── Image tokens ──────────────────────────────────────────────────────────

  async _createAssetImage(assetId) {
    const image = await this.homey.images.createImage();
    await image.setStream(async (stream) => {
      const res = await this._api.getThumbnailStream(assetId);
      return res.pipe(stream);
    });
    this.homey.setTimeout(() => {
      image.unregister().catch(() => {});
    }, 10 * 60 * 1000);
    return image;
  }

  async _getNewlyAddedAlbumAssets(albumId) {
    const album = await this._api.getAlbum(albumId);
    const assets = album?.assets ?? [];
    if (!assets.length) return [];

    const knownIds = this._albumAssetIds[albumId];
    this._albumAssetIds[albumId] = new Set(assets.map((a) => a.id));

    if (knownIds) {
      return assets
        .filter((a) => !knownIds.has(a.id))
        .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
    }

    const newest = assets.slice().sort((a, b) => new Date(b.createdAt ?? b.updatedAt ?? 0) - new Date(a.createdAt ?? a.updatedAt ?? 0))[0];
    return newest ? [newest] : [];
  }

  async _baselineAlbumAssetIds(albumId) {
    const album = await this._api.getAlbum(albumId);
    if (album?.assets) {
      this._albumAssetIds[albumId] = new Set(album.assets.map((a) => a.id));
    }
  }

  // ── Flow targets ──────────────────────────────────────────────────────────

  async cmdHasNewUploadsToday() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const result = await this._api.searchAssets({ createdAfter: startOfToday, size: 1 });
    return (result?.assets?.total ?? 0) > 0;
  }

  async cmdHasUploadsInLastMinutes(minutes) {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const result = await this._api.searchAssets({ createdAfter: since, size: 1 });
    return (result?.assets?.total ?? 0) > 0;
  }

  async cmdRandomPhoto() {
    const assets = await this._api.getRandomAssets(1);
    const asset = Array.isArray(assets) ? assets[0] : assets;
    if (!asset?.id) throw new Error('No random asset found');
    const baseUrl = this.getSetting('url').replace(/\/$/, '');
    const photo = await this._createAssetImage(asset.id).catch(() => null);
    return {
      asset_id: asset.id,
      type: asset.type ?? 'IMAGE',
      filename: asset.originalFileName ?? '',
      taken_at: asset.fileCreatedAt ?? '',
      thumb_url: `${baseUrl}/api/assets/${asset.id}/thumbnail`,
      photo,
    };
  }

  async cmdAddToAlbum(albumId, assetId) {
    await this._api.addToAlbum(albumId, [assetId]);
  }

  async cmdRemoveFromAlbum(albumId, assetId) {
    await this._api.removeFromAlbum(albumId, [assetId]);
  }

  async cmdCreateAlbum(albumName) {
    const album = await this._api.createAlbum(albumName);
    if (!album?.id) throw new Error('No album ID in response');
    return { album_id: album.id };
  }

  async cmdShareAlbum(albumId) {
    const link = await this._api.createAlbumSharedLink(albumId);
    const key = link?.key;
    if (!key) throw new Error('No share key in response');
    return { link_url: `${this.getSetting('url').replace(/\/$/, '')}/share/${key}` };
  }

  async cmdCreateSharedLink(assetId) {
    const link = await this._api.createSharedLink([assetId]);
    const key = link?.key;
    if (!key) throw new Error('No share key in response');
    return { link_url: `${this.getSetting('url').replace(/\/$/, '')}/share/${key}` };
  }

  async cmdFavoriteAsset(assetId) {
    await this._api.updateAssets([assetId], { isFavorite: true });
  }

  async cmdUnfavoriteAsset(assetId) {
    await this._api.updateAssets([assetId], { isFavorite: false });
  }

  async cmdArchiveAsset(assetId) {
    await this._api.updateAssets([assetId], { isArchived: true });
  }

  async cmdUnarchiveAsset(assetId) {
    await this._api.updateAssets([assetId], { isArchived: false });
  }

  async cmdSetDescription(assetId, description) {
    await this._api.updateAsset(assetId, { description });
  }

  async cmdTriggerJob(jobId) {
    await this._api.triggerJob(jobId);
  }

}

module.exports = ImmichDevice;
