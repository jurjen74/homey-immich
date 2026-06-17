'use strict';

const Homey = require('homey');
const ImmichApi = require('../../lib/ImmichApi');

class ImmichDriver extends Homey.Driver {

  async onInit() {
    this._triggerNewAsset = this.homey.flow.getDeviceTriggerCard('new_asset');
    this._triggerNewMemory = this.homey.flow.getDeviceTriggerCard('new_memory');

    this._triggerDiskSpaceLow = this.homey.flow.getDeviceTriggerCard('disk_space_low');
    this._triggerDiskSpaceLow
      .registerRunListener((args, state) => state.diskFreeGb < args.threshold && state.prevDiskFreeGb >= args.threshold);

    this.homey.flow.getConditionCard('disk_space_below')
      .registerRunListener((args) => {
        const free = args.device.getCapabilityValue('immich_disk_free');
        return typeof free === 'number' && free < args.threshold;
      });

    this._triggerPersonInNewPhoto = this.homey.flow.getDeviceTriggerCard('person_in_new_photo');
    this._triggerPersonInNewPhoto
      .registerRunListener((args, state) => args.person.id === state.personId);
    this._triggerPersonInNewPhoto
      .getArgument('person')
      .registerAutocompleteListener(async (query, args) => {
        const api = args.device?._api;
        if (!api) return [];
        const people = await api.getAllPeople().catch(() => []);
        return people
          .filter((p) => p.name && p.name.toLowerCase().includes(query.toLowerCase()))
          .map((p) => ({ id: p.id, name: p.name }));
      });

    this._triggerAlbumGotNewAsset = this.homey.flow.getDeviceTriggerCard('album_got_new_asset');
    this._triggerAlbumGotNewAsset
      .registerRunListener((args, state) => args.album.id === state.albumId);
    this._triggerAlbumGotNewAsset
      .getArgument('album')
      .registerAutocompleteListener(async (query, args) => {
        const api = args.device?._api;
        if (!api) return [];
        const albums = await api.getAlbums().catch(() => []);
        return (Array.isArray(albums) ? albums : [])
          .filter((a) => (a.albumName ?? '').toLowerCase().includes(query.toLowerCase()))
          .map((a) => ({ id: a.id, name: a.albumName }));
      });

    this._triggerNewDuplicate = this.homey.flow.getDeviceTriggerCard('new_duplicate');

    const addToAlbumCard = this.homey.flow.getActionCard('add_to_album');
    addToAlbumCard.registerRunListener((args) => args.device.cmdAddToAlbum(args.album.id, args.asset_id));
    addToAlbumCard.getArgument('album')
      .registerAutocompleteListener(async (query, args) => {
        const api = args.device?._api;
        if (!api) return [];
        const albums = await api.getAlbums().catch(() => []);
        return (Array.isArray(albums) ? albums : [])
          .filter((a) => (a.albumName ?? '').toLowerCase().includes(query.toLowerCase()))
          .map((a) => ({ id: a.id, name: a.albumName }));
      });

    const removeFromAlbumCard = this.homey.flow.getActionCard('remove_from_album');
    removeFromAlbumCard.registerRunListener((args) => args.device.cmdRemoveFromAlbum(args.album.id, args.asset_id));
    removeFromAlbumCard.getArgument('album')
      .registerAutocompleteListener(async (query, args) => {
        const api = args.device?._api;
        if (!api) return [];
        const albums = await api.getAlbums().catch(() => []);
        return (Array.isArray(albums) ? albums : [])
          .filter((a) => (a.albumName ?? '').toLowerCase().includes(query.toLowerCase()))
          .map((a) => ({ id: a.id, name: a.albumName }));
      });

    const shareAlbumCard = this.homey.flow.getActionCard('share_album');
    shareAlbumCard.registerRunListener((args) => args.device.cmdShareAlbum(args.album.id));
    shareAlbumCard.getArgument('album')
      .registerAutocompleteListener(async (query, args) => {
        const api = args.device?._api;
        if (!api) return [];
        const albums = await api.getAlbums().catch(() => []);
        return (Array.isArray(albums) ? albums : [])
          .filter((a) => (a.albumName ?? '').toLowerCase().includes(query.toLowerCase()))
          .map((a) => ({ id: a.id, name: a.albumName }));
      });

    this.homey.flow.getConditionCard('new_uploads_today')
      .registerRunListener((args) => args.device.cmdHasNewUploadsToday());

    this.homey.flow.getConditionCard('uploads_in_last_x_minutes')
      .registerRunListener((args) => args.device.cmdHasUploadsInLastMinutes(args.minutes));

    this.homey.flow.getActionCard('random_photo')
      .registerRunListener((args) => args.device.cmdRandomPhoto());

    this.homey.flow.getActionCard('create_shared_link')
      .registerRunListener((args) => args.device.cmdCreateSharedLink(args.asset_id));

    this.homey.flow.getActionCard('create_album')
      .registerRunListener((args) => args.device.cmdCreateAlbum(args.album_name));

    this.homey.flow.getActionCard('favorite_asset')
      .registerRunListener((args) => args.device.cmdFavoriteAsset(args.asset_id));

    this.homey.flow.getActionCard('unfavorite_asset')
      .registerRunListener((args) => args.device.cmdUnfavoriteAsset(args.asset_id));

    this.homey.flow.getActionCard('archive_asset')
      .registerRunListener((args) => args.device.cmdArchiveAsset(args.asset_id));

    this.homey.flow.getActionCard('unarchive_asset')
      .registerRunListener((args) => args.device.cmdUnarchiveAsset(args.asset_id));

    this.homey.flow.getActionCard('set_description')
      .registerRunListener((args) => args.device.cmdSetDescription(args.asset_id, args.description));

    this.homey.flow.getActionCard('trigger_job')
      .registerRunListener((args) => args.device.cmdTriggerJob(args.job));
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

  triggerAlbumGotNewAsset(device, tokens, state) {
    return this._triggerAlbumGotNewAsset.trigger(device, tokens, state);
  }

  triggerNewDuplicate(device, tokens) {
    return this._triggerNewDuplicate.trigger(device, tokens, {});
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
      const hostname = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })();
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
