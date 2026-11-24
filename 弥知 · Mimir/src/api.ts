import type { Book, BookSummary, Bootstrap, Dialogue, ReadingCard } from "./types";

export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("连不上本机的弥知。请确认程序正在运行。");
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "操作没有完成。");
  return data as T;
}

export const loadBootstrap = () => api<Bootstrap>("/bootstrap");
export const loadBook = (id: string) => api<Book>(`/books/${encodeURIComponent(id)}`);
export const uploadBook = (input: { title: string; author: string; text: string }) =>
  api<BookSummary>("/books", { ...input, source: "自行上传", license: "由用户声明其使用权利" });
export const acquireAlice = () => api<BookSummary>("/books/acquire", { catalog: "alice" });
export const speak = (input: {
  bookId: string;
  dialogueId?: string;
  quote: string;
  userText: string;
}) => api<Dialogue>("/speak", input);
export const saveCard = (input: Omit<ReadingCard, "id" | "createdAt" | "start" | "end">) =>
  api<ReadingCard>("/cards", input);
