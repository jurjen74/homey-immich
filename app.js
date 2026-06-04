'use strict';

const Homey = require('homey');

module.exports = class ImmichApp extends Homey.App {

  async onInit() {
    this._registerWidgetAutocomplete();
    this.log('ImmichApp initialized');
  }

  _registerWidgetAutocomplete(attempt = 0) {
    if (!this.homey.widgets) {
      // Retry up to ~30 s in case the widgets manager initializes after onInit
      if (attempt < 6) {
        const delay = attempt === 0 ? 0 : Math.min(1000 * 2 ** (attempt - 1), 10000);
        setTimeout(() => this._registerWidgetAutocomplete(attempt + 1), delay);
      } else {
        this.log('Widget API not available on this platform; device autocomplete inactive');
      }
      return;
    }

    try {
      this.homey.widgets.getWidget('immich_photo')
        .registerSettingAutocompleteListener('device', async (query) => {
          const driver = this.homey.drivers.getDriver('immich');
          const devices = driver.getDevices();
          return devices
            .filter(d => d.getName().toLowerCase().includes(query.toLowerCase()))
            .map(d => ({ id: d.getData().id, name: d.getName() }));
        });
      this.log('Widget device autocomplete registered');
    } catch (err) {
      this.log('Widget autocomplete registration failed:', err.message);
    }
  }

};
