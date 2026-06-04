'use strict';

const Homey = require('homey');

module.exports = class ImmichApp extends Homey.App {

  async onInit() {
    this.log('ImmichApp initialized');
  }

};
