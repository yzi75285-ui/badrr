export type Role = "author" | "rational" | "subjective" | "companion";

export interface Book {
  id: string;
  title: string;
  author: string;
  source: string;
  license: string;
  text: string;
  createdAt: string;
}

export interface Message {
  id: string;
  role: Role | "user";
  text: string;
  createdAt: string;
}

export interface Dialogue {
  id: string;
  bookId: string;
  quote: string;
  start: number;
  end: number;
  messages: Message[];
  updatedAt: string;
}

export interface ReadingCard {
  id: string;
  bookId: string;
  quote: string;
  start: number;
  end: number;
  authorNote: string;
  rationalNote: string;
  subjectiveNote: string;
  synthesis: string;
  createdAt: string;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string;
  source: string;
  license: string;
  createdAt: string;
  chars: number;
}
