// Jitter buffer: starts playing once PREBUFFER seconds are queued, plays
// silence on underrun (then prebuffers again), and drops the oldest audio
// beyond MAX_BUFFER so latency can't grow without bound.

const PREBUFFER = 0.15;
const MAX_BUFFER = 1.5;

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0;
    this.queued = 0;
    this.playing = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'push') {
        this.chunks.push(data.samples);
        this.queued += data.samples.length;
        const max = MAX_BUFFER * sampleRate;
        while (this.queued - this.offset > max && this.chunks.length > 1) {
          this.queued -= this.chunks.shift().length;
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
    const out = outputs[0][0];
    const available = this.queued - this.offset;
    if (!this.playing && available >= PREBUFFER * sampleRate) this.playing = true;
    if (!this.playing) {
      out.fill(0);
      return true;
    }
    let i = 0;
    while (i < out.length && this.chunks.length) {
      const chunk = this.chunks[0];
      const n = Math.min(out.length - i, chunk.length - this.offset);
      out.set(chunk.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.queued -= chunk.length;
        this.offset = 0;
      }
    }
    if (i < out.length) {
      // Underrun (source paused or network hiccup): silence, then prebuffer.
      out.fill(0, i);
      this.playing = false;
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
