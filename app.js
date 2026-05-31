'use strict';

const Homey = require('homey');

module.exports = class ImmichApp extends Homey.App {

  async onInit() {
    this.homey.widgets.getWidget('immich_photo')
      .registerSettingAutocompleteListener('device', async (query) => {
        const driver = this.homey.drivers.getDriver('immich');
        const devices = driver.getDevices();
        return devices
          .filter(d => d.getName().toLowerCase().includes(query.toLowerCase()))
          .map(d => ({ id: d.getData().id, name: d.getName() }));
      });

    this.log('ImmichApp initialized');
  }

};
