/**
 * FIFO task queue for sequential async execution.
 * One task at a time; when a task rejects, the returned Promise rejects
 * but the queue continues to the next task.
 */
export class SequentialQueue {
  private tasks: Array<() => Promise<unknown>> = [];
  private running = false;

  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.tasks.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.running = false;
          this.processNext();
        }
      });
      if (!this.running) this.processNext();
    });
  }

  private processNext(): void {
    if (this.running || this.tasks.length === 0) return;
    this.running = true;
    const fn = this.tasks.shift()!;
    fn();
  }
}
