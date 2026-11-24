export class IngestQueue {
  private pending: string[] = [];
  private draining = false;
  private waiters: Array<() => void> = [];

  constructor(private readonly handler: (id: string) => Promise<void>) {}

  enqueue(id: string): void {
    if (!this.pending.includes(id)) this.pending.push(id);
    void this.drain();
  }

  idle(): Promise<void> {
    if (!this.draining && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const id = this.pending.shift();
        if (!id) break;
        try {
          await this.handler(id);
        } catch (error) {
          console.error("ingest", id, error);
        }
      }
    } finally {
      this.draining = false;
      if (this.pending.length > 0) {
        void this.drain();
        return;
      }
      const waiters = this.waiters.splice(0);
      for (const waiter of waiters) waiter();
    }
  }
}
