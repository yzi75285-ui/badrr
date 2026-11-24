import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Asset } from '../shared/contracts.js';

export class AssetStore {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'khepri.sqlite'));
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL,
        idempotency_key TEXT UNIQUE, payload TEXT NOT NULL
      );`);
  }

  list(): Asset[] {
    return this.db.prepare('SELECT payload FROM assets ORDER BY created_at DESC, id DESC').all()
      .map((row) => JSON.parse(String(row.payload)) as Asset);
  }

  get(id: string): Asset | null {
    const row = this.db.prepare('SELECT payload FROM assets WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.payload)) as Asset : null;
  }

  byKey(key: string): Asset | null {
    const row = this.db.prepare('SELECT payload FROM assets WHERE idempotency_key = ?').get(key);
    return row ? JSON.parse(String(row.payload)) as Asset : null;
  }

  insert(asset: Asset, key?: string): void {
    this.db.prepare('INSERT INTO assets(id, created_at, status, idempotency_key, payload) VALUES(?, ?, ?, ?, ?)')
      .run(asset.id, asset.createdAt, asset.status, key ?? null, JSON.stringify(asset));
  }

  save(asset: Asset): void {
    this.db.prepare('UPDATE assets SET status = ?, payload = ? WHERE id = ?')
      .run(asset.status, JSON.stringify(asset), asset.id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  }

  close(): void { this.db.close(); }
}
