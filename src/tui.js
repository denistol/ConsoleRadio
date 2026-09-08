const readline = require('readline');

// ANSI helper constants
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;

const COLOR_CYAN = `${ESC}36m`;
const COLOR_BRIGHT_CYAN = `${ESC}96m`;
const COLOR_MAGENTA = `${ESC}35m`;
const COLOR_BRIGHT_MAGENTA = `${ESC}95m`;
const COLOR_YELLOW = `${ESC}33m`;
const COLOR_BRIGHT_YELLOW = `${ESC}93m`;
const COLOR_GREEN = `${ESC}32m`;
const COLOR_BRIGHT_GREEN = `${ESC}92m`;
const COLOR_RED = `${ESC}31m`;
const COLOR_WHITE = `${ESC}97m`;
const COLOR_GRAY = `${ESC}90m`;

const BG_CYAN = `${ESC}46m`;

class TerminalUI {
  constructor({ mpv, stations, visualizer }) {
    this.mpv = mpv;
    this.stations = stations;
    this.visualizer = visualizer;

    this.activeTab = 0; // 0: Search, 1: Favorites, 2: Custom URL, 3: Equalizer
    this.tabs = [
      { id: 0, label: '1: Search (40k+)' },
      { id: 1, label: '2: Favorites ★' },
      { id: 2, label: '3: Custom M3U' },
      { id: 3, label: '4: Equalizer' }
    ];

    // Search view state (default screen!)
    this.searchQuery = '';
    this.isTypingSearch = false;
    this.searchResults = [];
    this.searchSelectedIdx = 0;
    this.searchScrollOffset = 0;
    this.isSearching = false;

    // Favorites view state
    this.favoriteSelectedIdx = 0;
    this.favScrollOffset = 0;

    // Custom URL input state
    this.customUrlInput = '';
    this.isTypingUrl = false;

    // Equalizer state
    this.eqPresets = [
      { name: 'Flat', bass: 0, treble: 0 },
      { name: 'Bass Boost', bass: 7, treble: 2 },
      { name: 'Rock / Metal', bass: 5, treble: 5 },
      { name: 'Electronic / EDM', bass: 6, treble: 4 },
      { name: 'Jazz / Smooth', bass: 3, treble: 2 },
      { name: 'Classical', bass: 2, treble: 3 },
      { name: 'Vocal / Podcast', bass: -2, treble: 4 },
      { name: 'Treble Boost', bass: 0, treble: 8 }
    ];
    this.selectedEqIdx = 0;

    this.statusMessage = 'Welcome to Console Radio! Press [/] to search stations.';
    this.statusTimer = null;
    this.renderTimer = null;
    this.isRunning = false;
  }

  async start() {
    this.isRunning = true;

    // Enter alternate screen buffer & hide cursor
    process.stdout.write(`${ESC}?1049h${ESC}?25l${ESC}H${ESC}2J`);

    // Setup keyboard raw mode
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.on('keypress', this._handleKeypress.bind(this));
    process.stdout.on('resize', () => this.render());

    // Listen to MPV events
    this.mpv.on('track-change', () => this.render());
    this.mpv.on('pause-change', () => this.render());
    this.mpv.on('volume-change', () => this.render());
    this.mpv.on('loading', () => {
      this.setStatus('Connecting & buffering stream...');
      this.render();
    });
    this.mpv.on('playing', (st) => {
      this.setStatus(`Now playing: ${st ? st.name : ''}`);
      this.render();
    });
    this.mpv.on('error', (err) => {
      this.setStatus(`Audio Error: ${err.message || err}`, 4000);
      this.render();
    });

    // Initial render
    this.render();

    // Immediately load top popular stations from Radio Browser
    this._loadInitialStations();

    // 25 FPS render loop for spectrum visualizer
    this.renderTimer = setInterval(() => {
      this._updateVisualizer();
      this.render();
    }, 40);
  }

  async _loadInitialStations() {
    this.isSearching = true;
    this.render();
    try {
      this.searchResults = await this.stations.getTopStations(40);
    } catch (e) {
      this.searchResults = [];
    }
    this.isSearching = false;
    this.render();
  }

  stop() {
    this.isRunning = false;
    if (this.renderTimer) clearInterval(this.renderTimer);
    if (this.statusTimer) clearTimeout(this.statusTimer);

    // Leave alternate screen buffer & restore cursor
    process.stdout.write(`${ESC}?1049l${ESC}?25h`);
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch(e){}
    }
  }

  setStatus(msg, timeout = 3500) {
    this.statusMessage = msg;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusMessage = '';
      this.render();
    }, timeout);
  }

  _updateVisualizer() {
    this.visualizer.update({
      isPlaying: Boolean(this.mpv.currentStation),
      isPaused: this.mpv.isPaused,
      isLoading: this.mpv.isLoading,
      volume: this.mpv.isMuted ? 0 : this.mpv.volume,
      bass: this.mpv.bass,
      treble: this.mpv.treble
    });
  }

  _handleKeypress(str, key) {
    if (!key) return;

    // Global Quit
    if ((key.ctrl && key.name === 'c') || (!this.isTypingSearch && !this.isTypingUrl && key.name === 'q')) {
      this.stop();
      this.mpv.destroy();
      process.exit(0);
    }

    // Text typing for Search
    if (this.isTypingSearch) {
      if (key.name === 'return') {
        this.isTypingSearch = false;
        this._executeSearch();
      } else if (key.name === 'escape') {
        this.isTypingSearch = false;
      } else if (key.name === 'backspace') {
        this.searchQuery = this.searchQuery.slice(0, -1);
      } else if (str && str.length === 1 && !key.ctrl && !key.meta) {
        this.searchQuery += str;
      }
      this.render();
      return;
    }

    // Text typing for Custom URL
    if (this.isTypingUrl) {
      if (key.name === 'return') {
        this.isTypingUrl = false;
        this._playCustomUrl();
      } else if (key.name === 'escape') {
        this.isTypingUrl = false;
      } else if (key.name === 'backspace') {
        this.customUrlInput = this.customUrlInput.slice(0, -1);
      } else if (str && str.length === 1 && !key.ctrl && !key.meta) {
        this.customUrlInput += str;
      }
      this.render();
      return;
    }

    // Tab switching via numbers 1-4
    if (str >= '1' && str <= '4') {
      this.activeTab = parseInt(str, 10) - 1;
      this.render();
      return;
    }

    // Tab navigation via Tab / Shift+Tab
    if (key.name === 'tab') {
      this.activeTab = key.shift ? (this.activeTab + 3) % 4 : (this.activeTab + 1) % 4;
      this.render();
      return;
    }

    // Volume controls
    if (key.name === 'left' || str === '[') {
      this.mpv.changeVolume(-5);
      return;
    }
    if (key.name === 'right' || str === ']') {
      this.mpv.changeVolume(5);
      return;
    }
    if (str === 'm' || str === 'M') {
      this.mpv.toggleMute();
      this.setStatus(this.mpv.isMuted ? 'Muted' : 'Unmuted');
      return;
    }

    // Play / Pause toggle
    if (key.name === 'space') {
      if (this.mpv.currentStation) {
        this.mpv.togglePause();
      }
      return;
    }

    // Toggle Favorite hotkey 'f'
    if (str === 'f' || str === 'F') {
      const target = this._getCurrentHighlightedStation();
      if (target) {
        const added = this.stations.toggleFavorite(target);
        this.setStatus(added ? `Added "${target.name}" to Favorites ★` : `Removed "${target.name}" from Favorites`);
        this.render();
      }
      return;
    }

    // Quick EQ preset hotkey 'e'
    if (str === 'e' || str === 'E') {
      this.activeTab = 3;
      this.selectedEqIdx = (this.selectedEqIdx + 1) % this.eqPresets.length;
      const p = this.eqPresets[this.selectedEqIdx];
      this.mpv.setEqualizer(p.bass, p.treble, p.name);
      this.setStatus(`EQ Preset: ${p.name} (Bass: ${p.bass > 0 ? '+' : ''}${p.bass}dB, Treble: ${p.treble > 0 ? '+' : ''}${p.treble}dB)`);
      this.render();
      return;
    }

    // Bass adjustment 'b' / 'B'
    if (str === 'b') {
      this.mpv.setEqualizer(this.mpv.bass - 1, this.mpv.treble, 'Custom');
      this.setStatus(`Bass: ${this.mpv.bass > 0 ? '+' : ''}${this.mpv.bass} dB`);
      return;
    }
    if (str === 'B') {
      this.mpv.setEqualizer(this.mpv.bass + 1, this.mpv.treble, 'Custom');
      this.setStatus(`Bass: ${this.mpv.bass > 0 ? '+' : ''}${this.mpv.bass} dB`);
      return;
    }

    // Treble adjustment 't' / 'T'
    if (str === 't') {
      this.mpv.setEqualizer(this.mpv.bass, this.mpv.treble - 1, 'Custom');
      this.setStatus(`Treble: ${this.mpv.treble > 0 ? '+' : ''}${this.mpv.treble} dB`);
      return;
    }
    if (str === 'T') {
      this.mpv.setEqualizer(this.mpv.bass, this.mpv.treble + 1, 'Custom');
      this.setStatus(`Treble: ${this.mpv.treble > 0 ? '+' : ''}${this.mpv.treble} dB`);
      return;
    }

    // Search hotkey '/'
    if (str === '/') {
      this.activeTab = 0;
      this.isTypingSearch = true;
      this.render();
      return;
    }

    // Custom URL hotkey 'u'
    if (str === 'u' || str === 'U') {
      this.activeTab = 2;
      this.isTypingUrl = true;
      this.render();
      return;
    }

    // Tab-specific list navigation
    switch (this.activeTab) {
      case 0: // Search
        this._handleSearchNavigation(key);
        break;
      case 1: // Favorites
        this._handleFavoritesNavigation(key);
        break;
      case 2: // Custom URL
        if (key.name === 'return') {
          this.isTypingUrl = true;
        }
        break;
      case 3: // Equalizer
        this._handleEqualizerNavigation(key);
        break;
    }

    this.render();
  }

  _getCurrentHighlightedStation() {
    if (this.activeTab === 0) {
      return this.searchResults[this.searchSelectedIdx] || this.mpv.currentStation;
    }
    if (this.activeTab === 1) {
      return this.stations.getFavorites()[this.favoriteSelectedIdx] || this.mpv.currentStation;
    }
    return this.mpv.currentStation;
  }

  _handleSearchNavigation(key) {
    if (key.name === 'up' && this.searchSelectedIdx > 0) {
      this.searchSelectedIdx--;
    } else if (key.name === 'down' && this.searchSelectedIdx < this.searchResults.length - 1) {
      this.searchSelectedIdx++;
    } else if (key.name === 'return' && this.searchResults.length > 0) {
      const st = this.searchResults[this.searchSelectedIdx];
      if (st) this.mpv.play(st);
    }
  }

  _handleFavoritesNavigation(key) {
    const favs = this.stations.getFavorites();
    if (key.name === 'up' && this.favoriteSelectedIdx > 0) {
      this.favoriteSelectedIdx--;
    } else if (key.name === 'down' && this.favoriteSelectedIdx < favs.length - 1) {
      this.favoriteSelectedIdx++;
    } else if (key.name === 'return' && favs.length > 0) {
      const st = favs[this.favoriteSelectedIdx];
      if (st) this.mpv.play(st);
    }
  }

  _handleEqualizerNavigation(key) {
    if (key.name === 'up' && this.selectedEqIdx > 0) {
      this.selectedEqIdx--;
      this._applySelectedEq();
    } else if (key.name === 'down' && this.selectedEqIdx < this.eqPresets.length - 1) {
      this.selectedEqIdx++;
      this._applySelectedEq();
    } else if (key.name === 'return') {
      this._applySelectedEq();
    }
  }

  _applySelectedEq() {
    const p = this.eqPresets[this.selectedEqIdx];
    this.mpv.setEqualizer(p.bass, p.treble, p.name);
    this.setStatus(`Applied EQ Preset: ${p.name}`);
  }

  async _executeSearch() {
    this.isSearching = true;
    this.searchSelectedIdx = 0;
    this.searchScrollOffset = 0;
    const query = this.searchQuery.trim();
    this.setStatus(query ? `Searching for "${query}"...` : `Loading top popular stations...`);
    this.render();

    this.searchResults = await this.stations.searchRadioBrowser(query);
    this.isSearching = false;
    this.setStatus(`Found ${this.searchResults.length} stations!`);
    this.render();
  }

  _playCustomUrl() {
    if (!this.customUrlInput.trim()) return;
    const url = this.customUrlInput.trim();
    const customStation = {
      name: 'Custom Stream / M3U',
      url: url,
      genre: 'Custom',
      bitrate: 0
    };
    this.mpv.play(customStation);
    this.setStatus(`Streaming custom URL...`);
  }

  _strWidth(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '').length;
  }

  _padEndVisible(str, len) {
    const w = this._strWidth(str);
    return w < len ? str + ' '.repeat(len - w) : str;
  }

  render() {
    if (!this.isRunning) return;

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    const leftWidth = Math.max(34, Math.floor(cols * 0.48));
    const rightWidth = Math.max(34, cols - leftWidth - 3);
    const numBands = Math.max(12, Math.min(36, Math.floor((rightWidth - 6) / 2)));
    const visHeight = Math.max(4, Math.min(8, rows - 16));
    this.visualizer.setDimensions(numBands, visHeight);

    const frameLines = [];

    // Header banner
    const title = ' 📻 CONSOLE RADIO 2.0 ';
    const timeStr = new Date().toTimeString().slice(0, 5);
    const headerBorder = '═'.repeat(Math.max(0, cols - 2));
    frameLines.push(`${COLOR_CYAN}╔${headerBorder}╗${RESET}`);
    
    const midHeaderPad = cols - 4 - this._strWidth(title) - this._strWidth(timeStr);
    const headerContent = `${COLOR_BRIGHT_CYAN}${BOLD}${title}${RESET}${' '.repeat(Math.max(0, midHeaderPad))}${COLOR_YELLOW}${timeStr}${RESET}`;
    frameLines.push(`${COLOR_CYAN}║ ${headerContent} ║${RESET}`);

    // Tabs line
    let tabsLine = '';
    for (let i = 0; i < this.tabs.length; i++) {
      const t = this.tabs[i];
      if (i === this.activeTab) {
        tabsLine += `${BG_CYAN}${COLOR_WHITE}${BOLD} [${t.label}] ${RESET} `;
      } else {
        tabsLine += `${COLOR_GRAY}  ${t.label}   ${RESET} `;
      }
    }
    const tabsPad = cols - 4 - this._strWidth(tabsLine);
    frameLines.push(`${COLOR_CYAN}║ ${tabsLine}${' '.repeat(Math.max(0, tabsPad))} ║${RESET}`);
    frameLines.push(`${COLOR_CYAN}╠${'═'.repeat(leftWidth)}╦${'═'.repeat(Math.max(0, cols - leftWidth - 3))}╣${RESET}`);

    // Content area
    const contentHeight = Math.max(8, rows - 7);
    const leftContent = this._renderLeftPanel(leftWidth, contentHeight);
    const rightContent = this._renderRightPanel(rightWidth, contentHeight);

    for (let r = 0; r < contentHeight; r++) {
      const leftPart = leftContent[r] || ' '.repeat(leftWidth);
      const rightPart = rightContent[r] || ' '.repeat(rightWidth);
      frameLines.push(`${COLOR_CYAN}║${RESET}${leftPart}${COLOR_CYAN}║${RESET}${rightPart}${COLOR_CYAN}║${RESET}`);
    }

    // Bottom Separator
    frameLines.push(`${COLOR_CYAN}╠${'═'.repeat(leftWidth)}╩${'═'.repeat(Math.max(0, cols - leftWidth - 3))}╣${RESET}`);

    // Status bar & Hotkeys
    let statusText = this.statusMessage || `[Space] Play/Pause | [↑/↓] Select | [Enter] Play | [←/→] Vol | [f] Fav | [/] Search | [q] Quit`;
    if (this._strWidth(statusText) > cols - 4) {
      statusText = statusText.slice(0, cols - 7) + '...';
    }
    const statusPad = cols - 4 - this._strWidth(statusText);
    frameLines.push(`${COLOR_CYAN}║ ${COLOR_BRIGHT_GREEN}${statusText}${RESET}${' '.repeat(Math.max(0, statusPad))} ║${RESET}`);
    frameLines.push(`${COLOR_CYAN}╚${headerBorder}╝${RESET}`);

    // Write full frame
    process.stdout.write(`${ESC}H${frameLines.join('\n')}`);
  }

  _renderLeftPanel(width, height) {
    const lines = [];

    switch (this.activeTab) {
      case 0: // Search (Default Home Screen)
        lines.push(this._padEndVisible(` ${BOLD}${COLOR_MAGENTA}RADIO BROWSER SEARCH (40,000+)${RESET}`, width));
        const searchPrompt = this.isTypingSearch
          ? ` ${COLOR_YELLOW}Search: ${COLOR_WHITE}${this.searchQuery}█${RESET}`
          : ` ${COLOR_GRAY}Search: ${COLOR_WHITE}${this.searchQuery || '(Press / to search)'}${RESET}`;
        lines.push(this._padEndVisible(searchPrompt, width));
        lines.push(this._padEndVisible(` ${COLOR_GRAY}${'─'.repeat(width - 2)}${RESET}`, width));

        if (this.isSearching) {
          lines.push(this._padEndVisible(`   ${COLOR_YELLOW}⏳ Connecting to global radio servers...${RESET}`, width));
        } else if (this.searchResults.length === 0) {
          lines.push(this._padEndVisible(`   ${COLOR_GRAY}No stations found.${RESET}`, width));
          lines.push(this._padEndVisible(`   ${COLOR_GRAY}Press [/] to search (e.g. rock, synth, jazz)...${RESET}`, width));
        } else {
          // Calculate scrolling window
          const visibleRows = height - 4;
          if (this.searchSelectedIdx < this.searchScrollOffset) {
            this.searchScrollOffset = this.searchSelectedIdx;
          } else if (this.searchSelectedIdx >= this.searchScrollOffset + visibleRows) {
            this.searchScrollOffset = this.searchSelectedIdx - visibleRows + 1;
          }

          const start = this.searchScrollOffset;
          const end = Math.min(this.searchResults.length, start + visibleRows);

          for (let i = start; i < end; i++) {
            const st = this.searchResults[i];
            const isSel = i === this.searchSelectedIdx;
            const isPlayingThis = this.mpv.currentStation && this.mpv.currentStation.url === st.url;
            const fav = this.stations.isFavorite(st) ? `${COLOR_YELLOW}★${RESET}` : ' ';
            const prefix = isSel ? `${COLOR_BRIGHT_CYAN}${BOLD} ❯ ` : '   ';
            const playIcon = isPlayingThis ? `${COLOR_GREEN}▶ ${RESET}` : '  ';

            const maxNameLen = width - 11;
            const cleanName = (st.name || 'Station').slice(0, maxNameLen);
            const name = isSel ? `${BOLD}${COLOR_BRIGHT_CYAN}${cleanName}${RESET}` : cleanName;

            lines.push(this._padEndVisible(`${prefix}${playIcon}${fav} ${name}`, width));
          }
        }
        break;

      case 1: // Favorites
        lines.push(this._padEndVisible(` ${BOLD}${COLOR_YELLOW}★ FAVORITE STATIONS${RESET}`, width));
        lines.push(this._padEndVisible(` ${COLOR_GRAY}${'─'.repeat(width - 2)}${RESET}`, width));
        const favs = this.stations.getFavorites();
        if (favs.length === 0) {
          lines.push(this._padEndVisible(`   ${COLOR_GRAY}No favorites saved yet.${RESET}`, width));
          lines.push(this._padEndVisible(`   ${COLOR_GRAY}Find a station in Search and press [f]!${RESET}`, width));
        } else {
          const visibleRows = height - 3;
          if (this.favoriteSelectedIdx < this.favScrollOffset) {
            this.favScrollOffset = this.favoriteSelectedIdx;
          } else if (this.favoriteSelectedIdx >= this.favScrollOffset + visibleRows) {
            this.favScrollOffset = this.favoriteSelectedIdx - visibleRows + 1;
          }

          const start = this.favScrollOffset;
          const end = Math.min(favs.length, start + visibleRows);

          for (let i = start; i < end; i++) {
            const st = favs[i];
            const isSel = i === this.favoriteSelectedIdx;
            const isPlayingThis = this.mpv.currentStation && this.mpv.currentStation.url === st.url;
            const prefix = isSel ? `${COLOR_BRIGHT_YELLOW}${BOLD} ❯ ` : '   ';
            const playIcon = isPlayingThis ? `${COLOR_GREEN}▶ ${RESET}` : '  ';
            const name = isSel ? `${BOLD}${COLOR_BRIGHT_YELLOW}${st.name.slice(0, width - 9)}${RESET}` : `${st.name.slice(0, width - 9)}`;
            lines.push(this._padEndVisible(`${prefix}${playIcon}★ ${name}`, width));
          }
        }
        break;

      case 2: // Custom URL / M3U
        lines.push(this._padEndVisible(` ${BOLD}${COLOR_MAGENTA}PLAY CUSTOM STREAM / M3U${RESET}`, width));
        lines.push(this._padEndVisible(` ${COLOR_GRAY}${'─'.repeat(width - 2)}${RESET}`, width));
        lines.push(this._padEndVisible(`  Paste any .m3u, .m3u8, .pls or stream URL:`, width));
        const urlBox = this.isTypingUrl
          ? `  ${COLOR_CYAN}URL: ${COLOR_WHITE}${this.customUrlInput}█${RESET}`
          : `  ${COLOR_GRAY}URL: ${COLOR_WHITE}${this.customUrlInput || '(Press Enter or u to enter URL)'}${RESET}`;
        lines.push(this._padEndVisible(urlBox, width));
        lines.push(this._padEndVisible(` `, width));
        lines.push(this._padEndVisible(`  ${COLOR_GRAY}Press [Enter] to start streaming.${RESET}`, width));
        break;

      case 3: // Equalizer Presets
        lines.push(this._padEndVisible(` ${BOLD}${COLOR_MAGENTA}EQUALIZER PRESETS${RESET}`, width));
        lines.push(this._padEndVisible(` ${COLOR_GRAY}${'─'.repeat(width - 2)}${RESET}`, width));
        for (let i = 0; i < this.eqPresets.length; i++) {
          if (lines.length >= height) break;
          const p = this.eqPresets[i];
          const isSel = i === this.selectedEqIdx;
          const isCurrent = this.mpv.eqPreset === p.name;
          const prefix = isSel ? `${COLOR_BRIGHT_CYAN}${BOLD} ❯ ` : '   ';
          const activeMark = isCurrent ? `${COLOR_GREEN}[ACTIVE] ${RESET}` : '         ';
          const name = isSel ? `${BOLD}${COLOR_BRIGHT_CYAN}${p.name}${RESET}` : p.name;
          lines.push(this._padEndVisible(`${prefix}${activeMark}${name}`, width));
        }
        break;
    }

    // Pad remaining rows
    while (lines.length < height) {
      lines.push(' '.repeat(width));
    }
    return lines;
  }

  _renderRightPanel(width, height) {
    const lines = [];

    // 1. Now Playing Section
    const curStation = this.mpv.currentStation;
    let statusBadge = `${COLOR_GRAY}[⏹ STOPPED]${RESET}`;
    if (this.mpv.isLoading) {
      statusBadge = `${COLOR_YELLOW}[⏳ CONNECTING]${RESET}`;
    } else if (this.mpv.isPaused) {
      statusBadge = `${COLOR_YELLOW}[⏸ PAUSED]${RESET}`;
    } else if (curStation) {
      statusBadge = `${COLOR_BRIGHT_GREEN}[▶ PLAYING]${RESET}`;
    }

    const stName = curStation ? curStation.name : 'No Station Selected';
    lines.push(this._padEndVisible(` ${BOLD}${COLOR_CYAN}NOW PLAYING${RESET}  ${statusBadge}`, width));
    lines.push(this._padEndVisible(` ${COLOR_WHITE}${BOLD}${stName.slice(0, width - 4)}${RESET}`, width));

    // Song Title / Track Metadata
    let trackText = this.mpv.currentTrack || '(Awaiting stream metadata...)';
    if (this._strWidth(trackText) > width - 6) {
      trackText = trackText.slice(0, width - 9) + '...';
    }
    lines.push(this._padEndVisible(` ${COLOR_YELLOW}♪ ${trackText}${RESET}`, width));

    // Volume Bar
    const vol = this.mpv.isMuted ? 0 : this.mpv.volume;
    const volBars = Math.floor(vol / 10);
    const volVisual = '█'.repeat(volBars) + '░'.repeat(10 - volBars);
    const muteStr = this.mpv.isMuted ? ` ${COLOR_RED}[MUTED]${RESET}` : '';
    lines.push(this._padEndVisible(` ${COLOR_GRAY}VOL:${RESET} [${COLOR_CYAN}${volVisual}${RESET}] ${vol}%${muteStr}`, width));

    // Equalizer & Audio Properties Info
    const bassStr = `Bass: ${this.mpv.bass > 0 ? '+' : ''}${this.mpv.bass}dB`;
    const trebStr = `Treb: ${this.mpv.treble > 0 ? '+' : ''}${this.mpv.treble}dB`;
    const bitrateStr = this.mpv.audioBitrate ? `${this.mpv.audioBitrate} kbps` : 'Live Stream';
    lines.push(this._padEndVisible(` ${COLOR_GRAY}EQ:${RESET} ${COLOR_MAGENTA}${this.mpv.eqPreset}${RESET} (${bassStr}, ${trebStr}) · ${COLOR_GRAY}${bitrateStr}${RESET}`, width));
    lines.push(this._padEndVisible(` ${COLOR_GRAY}${'─'.repeat(width - 2)}${RESET}`, width));

    // 2. Audio Spectrum Visualizer
    lines.push(this._padEndVisible(` ${COLOR_BRIGHT_CYAN}${BOLD}AUDIO SPECTRUM EQUALIZER${RESET}`, width));
    const visLines = this.visualizer.renderLines();
    for (const vl of visLines) {
      if (lines.length >= height) break;
      lines.push(this._padEndVisible(` ${vl}`, width));
    }

    // Pad remaining rows
    while (lines.length < height) {
      lines.push(' '.repeat(width));
    }
    return lines;
  }
}

module.exports = TerminalUI;
