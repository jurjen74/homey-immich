'use strict';

const ALL_PHOTOS_ID = '__all__';

module.exports = {

  async getPhoto({ homey, query }) {
    const { mode = 'random', deviceId, albumId } = query;
    if (!deviceId) throw new Error('No device');

    const driver = homey.drivers.getDriver('immich');
    const device = driver.getDevices().find((d) => d.getId() === deviceId);
    if (!device) throw new Error('Device not found');

    const useAlbum = albumId && albumId !== ALL_PHOTOS_ID;
    let assetInfo;

    if (mode === 'memory') {
      const todayStr = new Date().toISOString().slice(0, 10);
      const memories = await device._api.getMemories(todayStr);
      const assets = memories?.[0]?.assets ?? [];
      if (assets.length) {
        assetInfo = assets[Math.floor(Math.random() * assets.length)];
      }
    } else if (useAlbum) {
      const assets = await device._api.getAlbumAssets(albumId);
      if (assets.length) {
        if (mode === 'latest') {
          assetInfo = assets
            .slice()
            .sort((a, b) => new Date(b.fileCreatedAt) - new Date(a.fileCreatedAt))[0];
        } else {
          assetInfo = assets[Math.floor(Math.random() * assets.length)];
        }
      }
    } else if (mode === 'latest') {
      const result = await device._api.searchAssets({ order: 'desc', size: 1, withPeople: false });
      assetInfo = result?.assets?.items?.[0];
    } else {
      const raw = await device._api.getRandomAssets(1);
      assetInfo = Array.isArray(raw) ? raw[0] : raw;
    }

    if (!assetInfo?.id) {
      throw new Error(mode === 'memory' ? 'No memories for today' : 'No photo found');
    }

    const thumb = await device._api.getThumbnail(assetInfo.id);

    return {
      src: `data:${thumb.contentType};base64,${thumb.data.toString('base64')}`,
      filename: assetInfo.originalFileName ?? '',
      takenAt: assetInfo.fileCreatedAt ?? '',
    };
  },

};
