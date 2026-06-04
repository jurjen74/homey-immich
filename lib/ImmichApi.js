'use strict';

class ImmichApi {

  constructor({ url, apiKey }) {
    this._baseUrl = url.trim().replace(/\/$/, '');
    this._apiKey = apiKey.trim();
    this._lib = this._baseUrl.startsWith('https://') ? require('https') : require('http');
  }

  _request(method, path, { body, query } = {}) {
    let endpoint = `${this._baseUrl}/api${path}`;
    if (query) {
      const params = Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      if (params) endpoint += `?${params}`;
    }

    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'x-api-key': this._apiKey,
      Accept: 'application/json',
    };
    if (bodyStr) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    return new Promise((resolve, reject) => {
      const req = this._lib.request(endpoint, { method, headers, timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
          } else {
            let msg = `HTTP ${res.statusCode}`;
            try { const p = JSON.parse(data); msg = p.message ?? p.error ?? msg; } catch { /* */ }
            reject(new Error(msg));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  // Server
  getServerAbout() {
    return this._request('GET', '/server/about');
  }

  // Assets — createdAfter accepts Date or ISO string
  searchAssets({ createdAfter, type, personIds, page = 1, size = 100, order = 'asc', withPeople = true } = {}) {
    const body = { page, size, order, withPeople };
    if (createdAfter) body.createdAfter = createdAfter instanceof Date ? createdAfter.toISOString() : createdAfter;
    if (type) body.type = type;
    if (personIds?.length) body.personIds = personIds;
    return this._request('POST', '/search/metadata', { body });
  }

  // Memories — date is an ISO date string 'YYYY-MM-DD'
  getMemories(date) {
    return this._request('GET', '/memories', { query: { for: date } });
  }

  // People
  getPeople({ page = 1, size = 500, withHidden = false } = {}) {
    return this._request('GET', '/people', { query: { page, size, withHidden } });
  }

  async getAllPeople() {
    const all = [];
    for (let page = 1; page <= 50; page++) {
      const res = await this.getPeople({ page, size: 500 });
      const items = res?.people ?? [];
      all.push(...items);
      if (!res?.hasNextPage || items.length < 500) break;
    }
    return all;
  }

  // Albums
  getAlbums() {
    return this._request('GET', '/albums');
  }

  addToAlbum(albumId, assetIds) {
    return this._request('PUT', `/albums/${albumId}/assets`, { body: { ids: assetIds } });
  }

  createAlbum(albumName) {
    return this._request('POST', '/albums', { body: { albumName } });
  }

  updateAssets(ids, updates) {
    return this._request('PUT', '/assets', { body: { ids, ...updates } });
  }

  // Shared links — returns { key, ... }
  createSharedLink(assetIds) {
    return this._request('POST', '/shared-links', {
      body: { type: 'INDIVIDUAL', assetIds, allowDownload: true, showMetadata: true },
    });
  }

  // Server stats & storage
  getServerStatistics() {
    return this._request('GET', '/server/statistics');
  }

  getServerStorage() {
    return this._request('GET', '/server/storage');
  }

  getRandomAssets(count = 1) {
    return this._request('GET', '/assets/random', { query: { count } });
  }

  getAlbum(id) {
    return this._request('GET', `/albums/${encodeURIComponent(id)}`);
  }

  getThumbnail(id, size = 'thumbnail') {
    const url = `${this._baseUrl}/api/assets/${encodeURIComponent(id)}/thumbnail?size=${encodeURIComponent(size)}`;
    const headers = { 'x-api-key': this._apiKey };
    return new Promise((resolve, reject) => {
      const req = this._lib.request(url, { method: 'GET', headers, timeout: 15000 }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const contentType = res.headers['content-type'] ?? 'image/jpeg';
        const chunks = [];
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve({ data: Buffer.concat(chunks), contentType }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Thumbnail timed out')); });
      req.end();
    });
  }

  removeFromAlbum(albumId, assetIds) {
    return this._request('DELETE', `/albums/${albumId}/assets`, { body: { ids: assetIds } });
  }

  createAlbumSharedLink(albumId) {
    return this._request('POST', '/shared-links', {
      body: { type: 'ALBUM', albumId, allowDownload: true, showMetadata: true },
    });
  }

  updateAsset(id, updates) {
    return this._request('PATCH', `/assets/${id}`, { body: updates });
  }

  getDuplicates() {
    return this._request('GET', '/duplicates');
  }

  getTrashCount() {
    return this._request('POST', '/search/metadata', { body: { isTrashed: true, page: 1, size: 1 } })
      .then(r => r?.assets?.total ?? 0);
  }

  // Jobs
  triggerJob(jobId) {
    return this._request('PUT', `/jobs/${jobId}`, { body: { command: 'start', force: false } });
  }

}

module.exports = ImmichApi;
