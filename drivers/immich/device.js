'use strict';

const Homey = require('homey');
const ImmichApi = require('../../lib/ImmichApi');

class ImmichDevice extends Homey.Device {

  async onInit() {
    this._api = new ImmichApi(this.getSettings());
    this._lastPolledAt = new Date(); // baseline — don't re-trigger for existing assets
    this._lastMemoryDate = null;     // checked on first poll
    this._prevDiskFreeGb = null;
    this._prevDuplicateCount = null;
    this._albumAssetCounts = {};

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
    this._poll();
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

      for (const album of albums) {
        const prev = this._albumAssetCounts[album.id];
        const curr = album.assetCount ?? 0;
        if (prev !== undefined && curr > prev) {
          this.driver.triggerAlbumGotNewAsset(
            this,
            { album_name: album.albumName ?? '', asset_count: curr },
            { albumId: album.id },
          ).catch(this.error.bind(this));
        }
        this._albumAssetCounts[album.id] = curr;
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
    const result = await this._api.searchAssets({
      createdAfter: this._lastPolledAt,
      order: 'asc',
      size: 100,
      withPeople: true,
    });

    const baseUrl = this.getSetting('url').replace(/\/$/, '');
    for (const asset of (result?.assets?.items ?? [])) {
      const thumb_url = `${baseUrl}/api/assets/${asset.id}/thumbnail`;
      this.driver.triggerNewAsset(this, {
        asset_id: asset.id,
        type: asset.type ?? 'IMAGE',
        filename: asset.originalFileName ?? '',
        taken_at: asset.fileCreatedAt ?? '',
        thumb_url,
      }).catch(this.error.bind(this));

      for (const person of (asset.people ?? [])) {
        if (!person.id || !person.name) continue;
        this.driver.triggerPersonInNewPhoto(
          this,
          { person_name: person.name, asset_id: asset.id, thumb_url },
          { personId: person.id },
        ).catch(this.error.bind(this));
      }
    }
  }

  async _checkMemories() {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (this._lastMemoryDate === todayStr) return;

    const memories = await this._api.getMemories(todayStr);
    for (const memory of (memories ?? [])) {
      this.driver.triggerNewMemory(this, {
        year: memory?.data?.year ?? 0,
        asset_count: memory?.assets?.length ?? 0,
      }).catch(this.error.bind(this));
    }

    this._lastMemoryDate = todayStr;
  }

  async onSettings({ newSettings }) {
    this._stopPolling();
    this._api = new ImmichApi(newSettings);
    this._startPolling(newSettings.poll_interval);
  }

  onDeleted() {
    this._stopPolling();
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
    return {
      asset_id: asset.id,
      type: asset.type ?? 'IMAGE',
      filename: asset.originalFileName ?? '',
      taken_at: asset.fileCreatedAt ?? '',
      thumb_url: `${baseUrl}/api/assets/${asset.id}/thumbnail`,
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
