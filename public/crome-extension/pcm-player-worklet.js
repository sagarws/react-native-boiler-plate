// Jitter buffer (stereo): starts playing once PREBUFFER seconds are queued,
// plays silence on underrun (then prebuffers again), and drops the oldest
// audio beyond MAX_BUFFER so latency can't grow without bound.
//
// Chunks arrive as interleaved stereo Float32 (mono is duplicated by
// offscreen.js before it gets here).

const PREBUFFER = 0.15;
const MAX_BUFFER = 1.5;

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0; // in frames, within chunks[0]
    this.queued = 0; // frames
    this.playing = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'push') {
        this.chunks.push(data.samples);
        this.queued += data.samples.length / 2;
        const max = MAX_BUFFER * sampleRate;
        while (this.queued - this.offset > max && this.chunks.length > 1) {
          this.queued -= this.chunks.shift().length / 2;
          this.offset = 0;
        }
      } else if (data.type === 'flush') {
        this.chunks = [];
        this.offset = 0;
        this.queued = 0;
        this.playing = false;
      }
    };
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    const frames = left.length;
    const available = this.queued - this.offset;
    if (!this.playing && available >= PREBUFFER * sampleRate) this.playing = true;
    if (!this.playing) {
      left.fill(0);
      right?.fill(0);
      return true;
    }
    let i = 0;
    while (i < frames && this.chunks.length) {
      const chunk = this.chunks[0];
      const chunkFrames = chunk.length / 2;
      const n = Math.min(frames - i, chunkFrames - this.offset);
      for (let k = 0; k < n; k++) {
        const src = (this.offset + k) * 2;
        left[i + k] = chunk[src];
        if (right) right[i + k] = chunk[src + 1];
      }
      i += n;
      this.offset += n;
      if (this.offset >= chunkFrames) {
        this.chunks.shift();
        this.queued -= chunkFrames;
        this.offset = 0;
      }
    }
    if (i < frames) {
      // Underrun (source paused or network hiccup): silence, then prebuffer.
      left.fill(0, i);
      right?.fill(0, i);
      this.playing = false;
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
