import { readFile, writeFile } from "node:fs/promises";

export class JsonFile<T> {
  private chain: Promise<unknown> = Promise.resolve();

  public constructor(
    private readonly filePath: string,
    private readonly fallback: T
  ) {}

  private async readRaw(): Promise<T> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return this.fallback;
    }
  }

  private async writeRaw(data: T): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  public async get(): Promise<T> {
    return this.withLock(() => this.readRaw());
  }

  public async set(data: T): Promise<void> {
    return this.withLock(() => this.writeRaw(data));
  }

  public async update(updater: (current: T) => T | Promise<T>): Promise<T> {
    return this.withLock(async () => {
      const current = await this.readRaw();
      const next = await updater(current);
      await this.writeRaw(next);
      return next;
    });
  }

  private async withLock<R>(fn: () => Promise<R>): Promise<R> {
    const previous = this.chain;
    let unlock!: () => void;
    this.chain = new Promise<void>((resolve) => {
      unlock = resolve;
    });

    await previous;
    try {
      return await fn();
    } finally {
      unlock();
    }
  }
}
