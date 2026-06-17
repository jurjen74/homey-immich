'use strict';

const Homey = require('homey');

const ALL_PHOTOS_ID = '__all__';

module.exports = class ImmichApp extends Homey.App {

  async onInit() {
    try {
      const widgetManager = this.homey.dashboards ?? this.homey.widgets;
      widgetManager.getWidget('immich_photo')
        .registerSettingAutocompleteListener('album', (query) => this._albumAutocomplete(query));
      this.log('Album autocomplete registered');
    } catch (err) {
      this.log('Album autocomplete registration failed:', err.message);
    }

    this.log('ImmichApp initialized');
  }

  async _albumAutocomplete(query) {
    const devices = this.homey.drivers.getDriver('immich').getDevices();
    const multiple = devices.length > 1;

    const results = [{ id: ALL_PHOTOS_ID, name: 'All photos' }];

    for (const device of devices) {
      try {
        const albums = await device._api.getAlbums();
        if (!Array.isArray(albums)) continue;
        for (const album of albums) {
          results.push({
            id: album.id,
            name: multiple ? `${album.albumName} (${device.getName()})` : album.albumName,
            description: album.assetCount ? `${album.assetCount} photos` : undefined,
          });
        }
      } catch (err) {
        this.log('Failed to list albums for', device.getName(), '-', err.message);
      }
    }

    const q = (query || '').toLowerCase();
    return results.filter((r) => r.name.toLowerCase().includes(q));
  }

};
