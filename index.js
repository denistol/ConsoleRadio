#!/usr/bin/env node

const path = require('path');
const MpvController = require('./src/mpv');
const StationManager = require('./src/stations');
const SpectrumVisualizer = require('./src/visualizer');
const TerminalUI = require('./src/tui');

async function main() {
  const mpv = new MpvController();
  const stations = new StationManager(path.join(__dirname, 'assets'));
  const visualizer = new SpectrumVisualizer(24, 7);

  const tui = new TerminalUI({
    mpv,
    stations,
    visualizer
  });

  // Emergency cleanup handlers
  const cleanup = () => {
    tui.stop();
    mpv.destroy();
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    cleanup();
    console.error('ConsoleRadio error:', err);
    process.exit(1);
  });

  try {
    // Start MPV player daemon
    await mpv.start();

    // Start full-screen TUI
    tui.start();
  } catch (err) {
    cleanup();
    console.error('Failed to initialize ConsoleRadio:', err.message);
    process.exit(1);
  }
}

main();
