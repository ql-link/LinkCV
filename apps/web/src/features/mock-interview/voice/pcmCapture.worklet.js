// Average incoming mono samples into 16 kHz PCM16, keeping phase across render quanta.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(320);
    this.index = 0;
    this.port.onmessage = () => {
      if (this.index) this.port.postMessage(this.frame.slice(0, this.index).buffer);
      this.index = 0;
      this.port.postMessage("flushed");
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let mono = 0;
      for (const channel of channels) mono += channel[i];
      this.sum += mono / channels.length;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.frame[this.index++] = Math.round(value * (value < 0 ? 32768 : 32767));
        this.sum = 0;
        this.count = 0;
        if (this.index === this.frame.length) {
          this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
          this.frame = new Int16Array(320);
          this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("mock-interview-pcm", PcmCapture);
