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
  getPeople() {
    return this._request('GET', '/people');
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

  // Jobs
  triggerJob(jobId) {
    return this._request('PUT', `/jobs/${jobId}`, { body: { command: 'start', force: false } });
  }

}

module.exports = ImmichApi;
