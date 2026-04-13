export class DedupStore {
  private seen = new Map<string, number>(); // id → expiry timestamp

  add(id: string, ttlMs = 2 * 60 * 60 * 1000): void {
    this.seen.set(id, Date.now() + ttlMs);
  }

  has(id: string): boolean {
    const expiry = this.seen.get(id);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.seen.delete(id);
      return false;
    }
    return true;
  }

  size(): number {
    const now = Date.now();
    for (const [id, expiry] of this.seen) {
      if (now > expiry) this.seen.delete(id);
    }
    return this.seen.size;
  }
}
