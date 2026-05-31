'use strict';

const Homey = require('homey');
const ImmichApi = require('../../lib/ImmichApi');

class ImmichDriver extends Homey.Driver {

  async onInit() {
    this._triggerNewAsset = this.homey.flow.getDeviceTriggerCard('new_asset');
    this._triggerNewMemory = this.homey.flow.getDeviceTriggerCard('new_memory');

    this._triggerDiskSpaceLow = this.homey.flow.getDeviceTriggerCard('disk_space_low');
    this._triggerDiskSpaceLow
      .registerRunListener(({ args, state }) =>
        state.diskFreeGb < args.threshold && state.prevDiskFreeGb >= args.threshold,
      );

    this.homey.flow.getConditionCard('disk_space_below')
      .registerRunListener(({ device, args }) =>
        device.getCapabilityValue('immich_disk_free') < args.threshold,
      );

    this._triggerPersonInNewPhoto = this.homey.flow.getDeviceTriggerCard('person_in_new_photo');
    this._triggerPersonInNewPhoto
      .registerRunListener(({ args, state }) => args.person.id === state.personId);
    this._triggerPersonInNewPhoto
      .getArgument('person')
      .registerAutocompleteListener(async (query, args) => {
        const api = args.device?._api;
        if (!api) return [];
        const res = await api.getPeople().catch(() => ({ people: [] }));
        return (res?.people ?? [])
          .filter(p => p.name && p.name.toLowerCase().includes(query.toLowerCase()))
          .map(p => ({ id: p.id, name: p.name }));
      });

    const addToAlbumCard = this.homey.flow.getActionCard('add_to_album');
    addToAlbumCard.registerRunListener(({ device, args }) => device.cmdAddToAlbum(args.album.id, args.asset_id));
    addToAlbumCard.getArgument('album')
      .registerAutocompleteListener(async (query, args) => {
        const api = args.device?._api;
        if (!api) return [];
        const albums = await api.getAlbums().catch(() => []);
        return (Array.isArray(albums) ? albums : [])
          .filter(a => (a.albumName ?? '').toLowerCase().includes(query.toLowerCase()))
          .map(a => ({ id: a.id, name: a.albumName }));
      });

    this.homey.flow.getConditionCard('new_uploads_today')
      .registerRunListener(({ device }) => device.cmdHasNewUploadsToday());

    this.homey.flow.getActionCard('create_shared_link')
      .registerRunListener(({ device, args }) => device.cmdCreateSharedLink(args.asset_id));

    this.homey.flow.getActionCard('trigger_job')
      .registerRunListener(({ device, args }) => device.cmdTriggerJob(args.job));
  }

  triggerNewAsset(device, tokens) {
    return this._triggerNewAsset.trigger(device, tokens, {});
  }

  triggerNewMemory(device, tokens) {
    return this._triggerNewMemory.trigger(device, tokens, {});
  }

  triggerPersonInNewPhoto(device, tokens, state) {
    return this._triggerPersonInNewPhoto.trigger(device, tokens, state);
  }

  triggerDiskSpaceLow(device, tokens, state) {
    return this._triggerDiskSpaceLow.trigger(device, tokens, state);
  }

  async onPair(session) {
    let pairData = {};

    session.setHandler('test_connection', async ({ url, apiKey }) => {
      const cleanUrl = url.trim().replace(/\/$/, '');
      const api = new ImmichApi({ url: cleanUrl, apiKey: apiKey.trim() });
      const about = await api.getServerAbout(); // throws with descriptive message on failure
      pairData = { url: cleanUrl, apiKey: apiKey.trim() };
      return { version: about?.version ?? 'unknown' };
    });

    session.setHandler('list_devices', () => {
      const { url, apiKey } = pairData;
      const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
      return [
        {
          name: `Immich (${hostname})`,
          data: { id: url },
          settings: { url, apiKey, poll_interval: 60 },
        },
      ];
    });
  }

}

module.exports = ImmichDriver;
