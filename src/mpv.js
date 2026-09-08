const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');
const EventEmitter = require('events');

class MpvController extends EventEmitter {
  constructor() {
    super();
    this.socketPath = path.join(os.tmpdir(), `consoleradio-mpv-${process.pid}-${Date.now()}.sock`);
    this.process = null;
    this.socket = null;
    this.isConnected = false;
    this.currentTrack = '';
    this.currentStation = null;
    this.isPaused = false;
    this.isLoading = false;
    this.volume = 70;
    this.isMuted = false;
    this.audioBitrate = null;
    this.bass = 0;
    this.treble = 0;
    this.eqPreset = 'Flat';
    this.startTime = null;
    this.msgId = 1;
    this.callbacks = new Map();
  }

  start() {
    return new Promise((resolve, reject) => {
      // Clean up previous socket if exists
      if (fs.existsSync(this.socketPath)) {
        try { fs.unlinkSync(this.socketPath); } catch (e) {}
      }

      this.process = spawn('mpv', [
        '--idle=yes',
        '--no-video',
        '--audio-display=no',
        '--msg-level=all=no,cplayer=no',
        `--volume=${this.volume}`,
        `--input-ipc-server=${this.socketPath}`
      ], { stdio: 'ignore' });

      this.process.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.process.on('exit', () => {
        this.isConnected = false;
        this.emit('close');
      });

      // Try connecting to IPC socket with retries
      let retries = 0;
      const maxRetries = 25;
      const tryConnect = () => {
        if (!fs.existsSync(this.socketPath)) {
          if (++retries > maxRetries) {
            return reject(new Error('Failed to create MPV IPC socket'));
          }
          return setTimeout(tryConnect, 100);
        }

        const socket = net.connect(this.socketPath, () => {
          this.socket = socket;
          this.isConnected = true;
          this._initObservers();
          resolve();
        });

        socket.on('error', () => {
          if (++retries > maxRetries) {
            reject(new Error('Could not connect to MPV socket'));
          } else {
            setTimeout(tryConnect, 100);
          }
        });

        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep last incomplete line
          for (const line of lines) {
            if (line.trim()) {
              this._handleIpcMessage(line.trim());
            }
          }
        });
      };

      setTimeout(tryConnect, 150);
    });
  }

  _sendCommand(command, args = []) {
    if (!this.isConnected || !this.socket) return Promise.resolve(null);
    const reqId = this.msgId++;
    const payload = JSON.stringify({ command: [command, ...args], request_id: reqId }) + '\n';
    return new Promise((resolve) => {
      this.callbacks.set(reqId, resolve);
      this.socket.write(payload);
      setTimeout(() => {
        if (this.callbacks.has(reqId)) {
          this.callbacks.delete(reqId);
          resolve(null);
        }
      }, 2000);
    });
  }

  _initObservers() {
    this._sendCommand('observe_property', [1, 'media-title']);
    this._sendCommand('observe_property', [2, 'pause']);
    this._sendCommand('observe_property', [3, 'volume']);
    this._sendCommand('observe_property', [4, 'audio-bitrate']);
    this._sendCommand('observe_property', [5, 'core-idle']);
  }

  _handleIpcMessage(raw) {
    try {
      const msg = JSON.parse(raw);
      if (msg.request_id && this.callbacks.has(msg.request_id)) {
        const cb = this.callbacks.get(msg.request_id);
        this.callbacks.delete(msg.request_id);
        cb(msg.data);
      }

      if (msg.event === 'property-change') {
        switch (msg.name) {
          case 'media-title':
            if (msg.data && msg.data !== this.currentTrack) {
              this.currentTrack = msg.data;
              this.emit('track-change', this.currentTrack);
            }
            break;
          case 'pause':
            this.isPaused = Boolean(msg.data);
            this.emit('pause-change', this.isPaused);
            break;
          case 'volume':
            if (typeof msg.data === 'number') {
              this.volume = Math.round(msg.data);
              this.emit('volume-change', this.volume);
            }
            break;
          case 'audio-bitrate':
            if (typeof msg.data === 'number') {
              this.audioBitrate = Math.round(msg.data / 1000);
              this.emit('bitrate-change', this.audioBitrate);
            }
            break;
          case 'core-idle':
            if (msg.data === false) {
              this.isLoading = false;
            }
            break;
        }
      } else if (msg.event === 'start-file') {
        this.isLoading = true;
        this.emit('loading');
      } else if (msg.event === 'file-loaded') {
        this.isLoading = false;
        this.startTime = Date.now();
        this.emit('playing', this.currentStation);
      } else if (msg.event === 'end-file') {
        this.isLoading = false;
        this.emit('stopped');
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  async play(station) {
    if (!station || !station.url) return;
    this.currentStation = station;
    this.currentTrack = station.name || '';
    this.isLoading = true;
    this.startTime = Date.now();
    await this._sendCommand('loadfile', [station.url, 'replace']);
    await this._applyAudioFilters();
  }

  async togglePause() {
    this.isPaused = !this.isPaused;
    await this._sendCommand('set_property', ['pause', this.isPaused]);
  }

  async setVolume(val) {
    this.volume = Math.max(0, Math.min(100, Math.round(val)));
    await this._sendCommand('set_property', ['volume', this.volume]);
  }

  async changeVolume(delta) {
    await this.setVolume(this.volume + delta);
  }

  async toggleMute() {
    this.isMuted = !this.isMuted;
    await this._sendCommand('set_property', ['mute', this.isMuted]);
  }

  async setEqualizer(bass = 0, treble = 0, presetName = 'Custom') {
    this.bass = Math.max(-12, Math.min(12, Math.round(bass)));
    this.treble = Math.max(-12, Math.min(12, Math.round(treble)));
    this.eqPreset = presetName;
    await this._applyAudioFilters();
  }

  async _applyAudioFilters() {
    const filters = [];
    if (this.bass !== 0) {
      filters.push(`bass=g=${this.bass}:f=110`);
    }
    if (this.treble !== 0) {
      filters.push(`treble=g=${this.treble}:f=3000`);
    }
    const filterString = filters.length > 0 ? `lavfi=[${filters.join(',')}]` : '';
    await this._sendCommand('set_property', ['af', filterString]);
  }

  async stop() {
    this.currentStation = null;
    this.currentTrack = '';
    this.startTime = null;
    this.isLoading = false;
    await this._sendCommand('stop');
  }

  destroy() {
    if (this.socket) {
      try { this.socket.destroy(); } catch (e) {}
    }
    if (this.process) {
      try { this.process.kill('SIGKILL'); } catch (e) {}
    }
    if (fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath); } catch (e) {}
    }
  }
}

module.exports = MpvController;
