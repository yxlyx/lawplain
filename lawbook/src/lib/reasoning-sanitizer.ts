/** Stateful filter for model reasoning. Handles tags split across stream chunks. */
export class ReasoningSanitizer {
  private pending = "";
  private thinking = false;

  snapshot(): { pending: string; thinking: boolean } {
    return { pending: this.pending, thinking: this.thinking };
  }

  restore(state: { pending: string; thinking: boolean }): void {
    this.pending = state.pending;
    this.thinking = state.thinking;
  }

  push(chunk: string): string {
    this.pending += chunk;
    let output = "";
    const open = "<think>";
    const close = "</think>";

    while (this.pending) {
      const lower = this.pending.toLowerCase();
      if (this.thinking) {
        const end = lower.indexOf(close);
        if (end < 0) {
          this.pending = this.pending.slice(
            Math.max(0, this.pending.length - (close.length - 1)),
          );
          return output;
        }
        this.pending = this.pending.slice(end + close.length);
        this.thinking = false;
        continue;
      }

      const start = lower.indexOf(open);
      if (start >= 0) {
        output += this.pending.slice(0, start);
        this.pending = this.pending.slice(start + open.length);
        this.thinking = true;
        continue;
      }

      let held = 0;
      const max = Math.min(open.length - 1, this.pending.length);
      for (let n = max; n > 0; n--) {
        if (open.startsWith(lower.slice(-n))) {
          held = n;
          break;
        }
      }
      output += this.pending.slice(0, this.pending.length - held);
      this.pending = this.pending.slice(this.pending.length - held);
      return output;
    }
    return output;
  }

  finish(): string {
    if (this.thinking) {
      this.pending = "";
      return "";
    }
    const output = this.pending;
    this.pending = "";
    return output;
  }
}

export function sanitizeAnswer(text: string): string {
  const sanitizer = new ReasoningSanitizer();
  return sanitizer.push(text) + sanitizer.finish();
}
