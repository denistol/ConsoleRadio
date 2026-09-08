const fs = require('fs');
const path = require('path');
const https = require('https');

class StationManager {
  constructor(assetsDir) {
    this.assetsDir = assetsDir || path.join(__dirname, '../assets');
    this.favFile = path.join(this.assetsDir, 'favorites.json');
    this.favorites = this._loadFavorites();
    this.apiServers = [
      'https://de1.api.radio-browser.info',
      'https://nl1.api.radio-browser.info',
      'https://at1.api.radio-browser.info'
    ];
    this.currentApiServer = this.apiServers[0];
  }

  _loadFavorites() {
    try {
      if (fs.existsSync(this.favFile)) {
        const raw = fs.readFileSync(this.favFile, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {}
    return [];
  }

  _saveFavorites() {
    try {
      if (!fs.existsSync(this.assetsDir)) {
        fs.mkdirSync(this.assetsDir, { recursive: true });
      }
      fs.writeFileSync(this.favFile, JSON.stringify(this.favorites, null, 2), 'utf8');
    } catch (e) {}
  }

  getFavorites() {
    return this.favorites;
  }

  isFavorite(station) {
    if (!station || !station.url) return false;
    return this.favorites.some(f => f.url === station.url);
  }

  toggleFavorite(station) {
    if (!station || !station.url) return false;
    const idx = this.favorites.findIndex(f => f.url === station.url);
    if (idx >= 0) {
      this.favorites.splice(idx, 1);
      this._saveFavorites();
      return false;
    } else {
      this.favorites.unshift({
        name: station.name || 'Custom Station',
        url: station.url,
        genre: station.genre || 'Radio',
        bitrate: station.bitrate || 128
      });
      this._saveFavorites();
      return true;
    }
  }

  _fetchFromApi(endpoint) {
    const url = `${this.currentApiServer}${endpoint}`;
    return new Promise((resolve) => {
      const req = https.get(url, { timeout: 4500 }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const list = JSON.parse(raw);
            const stations = list.map(item => ({
              name: item.name ? item.name.trim() : 'Unknown Station',
              url: item.url_resolved || item.url,
              genre: item.tags ? item.tags.split(',').slice(0, 2).join(', ') : (item.country || 'Radio'),
              bitrate: item.bitrate || 0,
              country: item.country || ''
            })).filter(s => s.url && s.url.startsWith('http'));
            resolve(stations);
          } catch (e) {
            resolve([]);
          }
        });
      });

      req.on('error', () => {
        // Rotate server on failure
        this.currentApiServer = this.apiServers[(this.apiServers.indexOf(this.currentApiServer) + 1) % this.apiServers.length];
        resolve([]);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve([]);
      });
    });
  }

  async getTopStations(limit = 35) {
    return this._fetchFromApi(`/json/stations/topclick/${limit}`);
  }

  async searchRadioBrowser(query, limit = 40) {
    if (!query || query.trim().length === 0) {
      return this.getTopStations(limit);
    }
    const encoded = encodeURIComponent(query.trim());
    return this._fetchFromApi(`/json/stations/byname/${encoded}?limit=${limit}&order=votes&reverse=true`);
  }
}

module.exports = StationManager;
