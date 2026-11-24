import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "./store";
import { ALICE, stripGutenberg } from "./seed";
import { GROK_MODEL, discussRound, grokConfigured } from "./grok";
import type { Book, Dialogue, Message, ReadingCard } from "./types";

if (existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));

const port = Number(process.env.MIMIR_PORT || 4317);
const dataDir = resolve(process.env.MIMIR_DATA_DIR || ".data");
const distDir = resolve("dist");
const store = new Store(dataDir);
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};

async function readBody(req: IncomingMessage, max = 2_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, "内容过大。");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON 格式无效。");
  }
}

function textField(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${label}缺失。`);
  const text = value.trim();
  if (!text || text.length > max) throw new HttpError(400, `${label}长度不符合要求。`);
  return text;
}

function optionalText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function localHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(host);
}

function windowAround(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start - 700), Math.min(text.length, end + 700));
}

async function acquireAlice(): Promise<Book> {
  const existing = store.bookBySource(ALICE.source);
  if (existing) return existing;
  const response = await fetch(ALICE.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new HttpError(502, "公有领域文本暂时没有下载下来。");
  const text = stripGutenberg(await response.text());
  if (text.length < 1000) throw new HttpError(502, "下载到的文本不完整。");
  return store.saveBook({ ...ALICE, text: text.slice(0, 1_500_000) });
}

const handler = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const host = req.headers.host ?? "";
    if (!localHost(host)) throw new HttpError(403, "只接受本机或同一局域网的访问。");
    const url = new URL(req.url ?? "/", `http://${host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (path === "/api/health" && method === "GET") {
      return json(res, 200, { status: "ok", model: GROK_MODEL, configured: grokConfigured() });
    }
    if (path === "/api/bootstrap" && method === "GET") {
      return json(res, 200, {
        books: store.listBooks(),
        dialogues: store.listDialogues(),
        cards: store.listCards(),
        settings: { model: GROK_MODEL, configured: grokConfigured() },
      });
    }
    const bookMatch = path.match(/^\/api\/books\/([^/]+)$/);
    if (bookMatch && method === "GET") {
      const book = store.getBook(decodeURIComponent(bookMatch[1]));
      if (!book) throw new HttpError(404, "没有这本书。");
      return json(res, 200, book);
    }
    if (path === "/api/books" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const book = store.saveBook({
        title: textField(body.title, "书名", 200),
        author: textField(body.author, "作者", 200),
        source: typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 300) : "自行上传",
        license: typeof body.license === "string" && body.license.trim() ? body.license.trim().slice(0, 300) : "由用户声明其使用权利",
        text: textField(body.text, "正文", 1_500_000),
      });
      return json(res, 201, { ...book, text: undefined, chars: book.text.length });
    }
    if (path === "/api/books/acquire" && method === "POST") {
      const book = await acquireAlice();
      return json(res, 200, { id: book.id, title: book.title, author: book.author, source: book.source, license: book.license, createdAt: book.createdAt, chars: book.text.length });
    }
    if (path === "/api/speak" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const book = store.getBook(textField(body.bookId, "书", 80));
      if (!book) throw new HttpError(404, "没有这本书。");
      const quote = textField(body.quote, "选段", 4000);
      const start = book.text.indexOf(quote);
      if (start < 0) throw new HttpError(400, "选段不在这本书里。");
      const userText = textField(body.userText, "你的话", 4000);
      const existing = store.listDialogues().find((item) => item.id === body.dialogueId);
      const dialogue: Dialogue = existing ?? {
        id: randomUUID(),
        bookId: book.id,
        quote,
        start,
        end: start + quote.length,
        messages: [],
        updatedAt: new Date().toISOString(),
      };
      const round = await discussRound({
        title: book.title,
        author: book.author,
        quote,
        context: windowAround(book.text, start, start + quote.length),
        userText,
        history: dialogue.messages,
      });
      const at = new Date().toISOString();
      const spoken: Message[] = [
        { id: randomUUID(), role: "user", text: userText, createdAt: at },
        { id: randomUUID(), role: "author", text: round.author, createdAt: at },
      ];
      if (round.rational) spoken.push({ id: randomUUID(), role: "rational", text: round.rational, createdAt: at });
      if (round.subjective) spoken.push({ id: randomUUID(), role: "subjective", text: round.subjective, createdAt: at });
      if (round.companion) spoken.push({ id: randomUUID(), role: "companion", text: round.companion, createdAt: at });
      const messages: Message[] = [...dialogue.messages, ...spoken];
      const saved = { ...dialogue, quote, start, end: start + quote.length, messages, updatedAt: at };
      store.saveDialogue(saved);
      return json(res, 200, saved);
    }
    if (path === "/api/cards" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const book = store.getBook(textField(body.bookId, "书", 80));
      if (!book) throw new HttpError(404, "没有这本书。");
      const quote = textField(body.quote, "选段", 4000);
      const start = book.text.indexOf(quote);
      if (start < 0) throw new HttpError(400, "选段不在这本书里。");
      const card: ReadingCard = {
        id: randomUUID(),
        bookId: book.id,
        quote,
        start,
        end: start + quote.length,
        authorNote: optionalText(body.authorNote, 4000),
        rationalNote: optionalText(body.rationalNote, 4000),
        subjectiveNote: optionalText(body.subjectiveNote, 4000),
        synthesis: textField(body.synthesis, "你的调节", 4000),
        createdAt: new Date().toISOString(),
      };
      store.saveCard(card);
      return json(res, 201, card);
    }
    if (path.startsWith("/api/")) throw new HttpError(404, "没有这个接口。");
    if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "方法不被允许。");
    let file = resolve(distDir, `.${decodeURIComponent(path)}`);
    if (file !== distDir && !file.startsWith(distDir + sep)) throw new HttpError(404, "文件不存在。");
    if (!existsSync(file) || !statSync(file).isFile()) file = resolve(distDir, "index.html");
    if (!existsSync(file)) return json(res, 503, { error: "网页尚未构建。开发时请打开 http://127.0.0.1:5178 。" });
    const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
    const bytes = readFileSync(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Content-Length": bytes.length });
    res.end(method === "HEAD" ? undefined : bytes);
  } catch (error) {
    if (res.headersSent) return;
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "操作没有完成。";
    json(res, status, { error: message });
  }
};

const server = createServer((req, res) => {
  void handler(req, res);
});
server.listen(port, "0.0.0.0", () => {
  console.log(`弥知：http://127.0.0.1:${port}  ·  同一局域网也可打开  ·  模型 ${GROK_MODEL}`);
  void acquireAlice()
    .then((book) => console.log(`已备好公有领域书：${book.title}`))
    .catch((error: unknown) => console.log(`公有领域书稍后可再获取：${error instanceof Error ? error.message : "下载未完成"}`));
});
