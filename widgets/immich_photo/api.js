'use strict';

module.exports = {

  async getPhoto({ homey, query }) {
    const { mode = 'random', deviceId } = query;

    if (!deviceId) throw new Error('No device selected');

    const driver = homey.drivers.getDriver('immich');
    const devices = driver.getDevices();
    const device = devices.find(d => d.getData().id === deviceId);
    if (!device) throw new Error('Device not found');

    let assetInfo;

    switch (mode) {
      case 'latest': {
        const result = await device._api.searchAssets({ order: 'desc', size: 1, withPeople: false });
        assetInfo = result?.assets?.items?.[0];
        break;
      }
      case 'memory': {
        const todayStr = new Date().toISOString().slice(0, 10);
        const memories = await device._api.getMemories(todayStr);
        const assets = memories?.[0]?.assets ?? [];
        if (assets.length) {
          assetInfo = assets[Math.floor(Math.random() * assets.length)];
        }
        break;
      }
      case 'random':
      default: {
        const raw = await device._api.getRandomAssets(1);
        assetInfo = Array.isArray(raw) ? raw[0] : raw;
        break;
      }
    }

    if (!assetInfo?.id) {
      throw new Error(mode === 'memory' ? 'No memories for today' : 'No photo found');
    }

    const thumb = await device._api.getThumbnail(assetInfo.id);

    return {
      src: `data:${thumb.contentType};base64,${thumb.data.toString('base64')}`,
      filename: assetInfo.originalFileName ?? '',
      takenAt: assetInfo.fileCreatedAt ?? '',
      type: assetInfo.type ?? 'IMAGE',
    };
  },

};
