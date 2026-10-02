// 面试官语音播放队列：回合 SSE 里的 interviewer.audio 按 seq 顺序到达（base64 mp3），逐段顺序播放。
// 合成失败（interviewer.audio_failed）或浏览器无法播放时只丢弃该段，字幕照常显示，面试不中断。
export class InterviewerAudioQueue {
  private queue: string[] = [];
  private playing: HTMLAudioElement | null = null;
  private waiters: Array<() => void> = [];
  private stopped = false;

  enqueue(base64Mp3: string) {
    if (this.stopped) return;
    this.queue.push(base64Mp3);
    if (!this.playing) this.playNext();
  }

  get busy() {
    return this.playing !== null || this.queue.length > 0;
  }

  // 队列播完（或被打断）后 resolve；没有任何音频时立即 resolve
  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  // 打断当前播报并清空队列（用户开口、离开页面）；之后可继续 enqueue 新一轮
  interrupt() {
    this.queue = [];
    const audio = this.playing;
    this.playing = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    this.flush();
  }

  // 页面卸载：打断并拒绝后续播放
  dispose() {
    this.stopped = true;
    this.interrupt();
  }

  private playNext() {
    const next = this.queue.shift();
    if (next === undefined) {
      this.playing = null;
      this.flush();
      return;
    }
    if (typeof Audio === "undefined") {
      this.playNext();
      return;
    }
    const audio = new Audio(`data:audio/mpeg;base64,${next}`);
    this.playing = audio;
    const advance = () => {
      if (this.playing !== audio) return;
      this.playing = null;
      this.playNext();
    };
    audio.onended = advance;
    audio.onerror = advance;
    // 自动播放被浏览器拦截时 play() 会 reject：跳过该段，不阻塞后续作答
    void audio.play().catch(advance);
  }

  private flush() {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }
}
