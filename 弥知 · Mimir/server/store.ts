import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Book, BookSummary, Dialogue, ReadingCard } from "./types";
import { XUE_ER } from "./seed";

const now = () => new Date().toISOString();

export class Store {
  readonly db: DatabaseSync;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, "reading.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dialogues (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.seed();
  }

  close() {
    this.db.close();
  }

  private seed() {
    if (this.db.prepare("SELECT value FROM meta WHERE id='seeded'").get()) return;
    if (!this.getBook(XUE_ER.id)) {
      const book: Book = { ...XUE_ER, createdAt: now() };
      this.put("books", book.id, book);
    }
    this.db.prepare("INSERT OR IGNORE INTO meta (id,value) VALUES ('seeded','1')").run();
  }

  listBooks(): BookSummary[] {
    return this.list<Book>("books").map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      source: book.source,
      license: book.license,
      createdAt: book.createdAt,
      chars: book.text.length,
    }));
  }

  getBook(id: string): Book | undefined {
    return this.get<Book>("books", id);
  }

  bookBySource(source: string): Book | undefined {
    return this.list<Book>("books").find((book) => book.source === source);
  }

  saveBook(input: Omit<Book, "id" | "createdAt"> & { id?: string }): Book {
    const book: Book = {
      id: input.id ?? randomUUID(),
      title: input.title,
      author: input.author,
      source: input.source,
      license: input.license,
      text: input.text,
      createdAt: now(),
    };
    this.put("books", book.id, book);
    return book;
  }

  listDialogues(): Dialogue[] {
    return this.list<Dialogue>("dialogues");
  }

  saveDialogue(dialogue: Dialogue) {
    this.put("dialogues", dialogue.id, dialogue);
  }

  listCards(): ReadingCard[] {
    return this.list<ReadingCard>("cards");
  }

  saveCard(card: ReadingCard) {
    this.put("cards", card.id, card);
  }

  private list<T>(table: "books" | "dialogues" | "cards"): T[] {
    return this.db
      .prepare(`SELECT json FROM ${table} ORDER BY rowid DESC`)
      .all()
      .map((row) => JSON.parse(String(row.json)) as T);
  }

  private get<T>(table: "books" | "dialogues" | "cards", id: string): T | undefined {
    const row = this.db.prepare(`SELECT json FROM ${table} WHERE id=?`).get(id);
    return row ? (JSON.parse(String(row.json)) as T) : undefined;
  }

  private put(table: "books" | "dialogues" | "cards", id: string, value: unknown) {
    this.db
      .prepare(`INSERT INTO ${table} (id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json`)
      .run(id, JSON.stringify(value));
  }
}
