/**
 * Real-time Spectrum Visualizer for Terminal
 * Simulates dynamic frequency spectrum with gravity peak decay and EQ reaction
 */

class SpectrumVisualizer {
  constructor(numBands = 24, height = 7) {
    this.numBands = numBands;
    this.height = height;
    this.levels = new Array(numBands).fill(0);
    this.peaks = new Array(numBands).fill(0);
    this.peakSpeeds = new Array(numBands).fill(0);
    this.phase = 0;
    this.blocks = [' ', ' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  }

  setDimensions(numBands, height) {
    this.numBands = Math.max(8, Math.min(48, numBands));
    this.height = Math.max(3, Math.min(15, height));
    if (this.levels.length !== this.numBands) {
      this.levels = new Array(this.numBands).fill(0);
      this.peaks = new Array(this.numBands).fill(0);
      this.peakSpeeds = new Array(this.numBands).fill(0);
    }
  }

  update({ isPlaying, isPaused, isLoading, volume = 70, bass = 0, treble = 0 }) {
    this.phase += 0.15;
    const volFactor = volume / 100;

    for (let i = 0; i < this.numBands; i++) {
      let target = 0;

      if (isLoading) {
        // Breathing wave when connecting
        target = (Math.sin(this.phase * 1.5 + i * 0.4) + 1) * 0.35 * this.height;
      } else if (isPlaying && !isPaused && volume > 0) {
        // Frequency band distribution (0 = bass, middle = vocal/instruments, end = highs/cymbals)
        const pos = i / (this.numBands - 1);
        
        // Bass rhythm pulsation (lower bands)
        const bassWeight = Math.max(0, 1 - pos * 1.6);
        const bassKick = Math.pow(Math.max(0, Math.sin(this.phase * 2.2)), 3) * 0.85;
        const bassBoostMul = 1 + (bass / 12) * 0.5;

        // Mid frequencies movement
        const midWeight = Math.exp(-Math.pow((pos - 0.45) * 3, 2));
        const midPulse = (Math.sin(this.phase * 3.1 + i * 0.7) + Math.cos(this.phase * 1.8 - i * 0.5)) * 0.25 + 0.5;

        // High frequencies shimmer (higher bands)
        const highWeight = Math.pow(pos, 1.4);
        const highSparkle = (Math.sin(this.phase * 5.4 + i * 1.3) * 0.5 + 0.5) * 0.7;
        const trebleBoostMul = 1 + (treble / 12) * 0.5;

        // Combined raw energy
        let energy = (bassWeight * bassKick * bassBoostMul * 1.3) +
                     (midWeight * midPulse * 1.0) +
                     (highWeight * highSparkle * trebleBoostMul * 1.1);

        // Add subtle harmonic flutter
        const flutter = (Math.sin(this.phase * 0.8 + i * 0.3) * 0.15);
        energy = Math.max(0.05, energy + flutter);

        target = energy * this.height * volFactor;
        // Clamp to height
        target = Math.min(this.height, Math.max(0, target));
      } else {
        // Decaying to zero when paused or stopped
        target = 0;
      }

      // Smooth level interpolation
      this.levels[i] += (target - this.levels[i]) * 0.45;

      // Peak logic with gravity
      if (this.levels[i] >= this.peaks[i]) {
        this.peaks[i] = this.levels[i];
        this.peakSpeeds[i] = 0;
      } else {
        this.peakSpeeds[i] += 0.08; // gravity
        this.peaks[i] = Math.max(0, this.peaks[i] - this.peakSpeeds[i]);
      }
    }
  }

  renderLines() {
    const lines = [];
    const colorReset = '\x1b[0m';
    const cyan = '\x1b[36m';
    const green = '\x1b[32m';
    const yellow = '\x1b[33m';
    const red = '\x1b[35m';
    const peakColor = '\x1b[37;1m';

    for (let r = this.height - 1; r >= 0; r--) {
      let rowStr = '';
      for (let i = 0; i < this.numBands; i++) {
        const val = this.levels[i];
        const peakVal = this.peaks[i];

        // Color based on height in spectrum (green -> cyan -> yellow -> magenta)
        const rowRatio = r / this.height;
        let bandColor = green;
        if (rowRatio > 0.75) bandColor = red;
        else if (rowRatio > 0.5) bandColor = yellow;
        else if (rowRatio > 0.25) bandColor = cyan;

        // Check if peak is on this row
        const isPeak = Math.floor(peakVal) === r && peakVal > 0.4 && val < r;

        if (isPeak) {
          rowStr += `${peakColor}⎺${colorReset} `;
        } else if (val >= r + 1) {
          // Full block
          rowStr += `${bandColor}█${colorReset} `;
        } else if (val > r) {
          // Partial block
          const frac = val - r;
          const idx = Math.min(this.blocks.length - 1, Math.max(1, Math.floor(frac * this.blocks.length)));
          rowStr += `${bandColor}${this.blocks[idx]}${colorReset} `;
        } else {
          // Empty space
          rowStr += '  ';
        }
      }
      lines.push(rowStr);
    }
    return lines;
  }
}

module.exports = SpectrumVisualizer;
