'use strict';

const Homey = require('homey');
const ImmichApi = require('../../lib/ImmichApi');

class ImmichDevice extends Homey.Device {

  async onInit() {
    this._api = new ImmichApi(this.getSettings());
    this._lastPolledAt = new Date(); // baseline — don't re-trigger for existing assets
    this._lastMemoryDate = null;     // checked on first poll

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
      await this._checkNewAssets();
      await this._checkMemories();
      this._lastPolledAt = pollStart;
      if (!this.getAvailable()) await this.setAvailable();
    } catch (err) {
      this.error('Poll failed:', err.message);
      await this.setUnavailable(err.message);
    }
  }

  async _checkNewAssets() {
    const result = await this._api.searchAssets({
      createdAfter: this._lastPolledAt,
      order: 'asc',
      size: 100,
      withPeople: true,
    });

    for (const asset of (result?.assets?.items ?? [])) {
      this.driver.triggerNewAsset(this, {
        asset_id: asset.id,
        type: asset.type ?? 'IMAGE',
        filename: asset.originalFileName ?? '',
        taken_at: asset.fileCreatedAt ?? '',
      }).catch(this.error.bind(this));

      for (const person of (asset.people ?? [])) {
        if (!person.id || !person.name) continue;
        this.driver.triggerPersonInNewPhoto(
          this,
          { person_name: person.name, asset_id: asset.id },
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

  async cmdAddToAlbum(albumId, assetId) {
    await this._api.addToAlbum(albumId, [assetId]);
  }

  async cmdCreateSharedLink(assetId) {
    const link = await this._api.createSharedLink([assetId]);
    const key = link?.key;
    if (!key) throw new Error('No share key in response');
    return { link_url: `${this.getSetting('url').replace(/\/$/, '')}/share/${key}` };
  }

  async cmdTriggerJob(jobId) {
    await this._api.triggerJob(jobId);
  }

}

module.exports = ImmichDevice;
