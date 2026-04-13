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
    return this.seen.size;
  }
}
