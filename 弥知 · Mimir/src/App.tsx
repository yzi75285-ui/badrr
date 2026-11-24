import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { acquireAlice, loadBook, loadBootstrap, saveCard, speak, uploadBook } from "./api";
import type { Book, Bootstrap, Dialogue, ReadingCard, Role } from "./types";
import { roleLabels } from "./types";
import { MARKS, MarkGlyph, readMark, type MarkId } from "./gallery";
import { Dawn } from "./Dawn";

const MarkChoice = createContext<{ id: MarkId; choose: (id: MarkId) => void }>({
  id: "bloom",
  choose: () => undefined,
});

type Screen =
  | { name: "shelf" }
  | { name: "reader"; bookId: string }
  | { name: "cards" }
  | { name: "card"; cardId: string }
  | { name: "marks" };

export function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [screen, setScreen] = useState<Screen>({ name: "shelf" });
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [markId, setMarkId] = useState<MarkId>(() => readMark());
  const [opened, setOpened] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const chooseMark = (id: MarkId) => {
    localStorage.setItem("mizhi-mark", id);
    setMarkId(id);
    back({ name: "shelf" });
  };
  const reload = useCallback(async () => {
    const next = await loadBootstrap();
    setData(next);
    setError("");
  }, []);
  useEffect(() => {
    void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "没有打开。"));
  }, [reload]);
  function go(next: Screen) {
    setDir("forward");
    setScreen(next);
  }
  function back(next: Screen) {
    setDir("back");
    setScreen(next);
  }
  const tab = screen.name === "cards" || screen.name === "card" ? "cards" : "shelf";

  return (
    <MarkChoice.Provider value={{ id: markId, choose: chooseMark }}>
    {!opened && <Dawn onDone={() => setOpened(true)} />}
    <div className="app">
      <aside className="rail">
        <button className="brand" onClick={() => go({ name: "marks" })}>
          <span className="mark" aria-hidden="true"><LivingMark /></span>
          <span><strong>弥知</strong><small>READING</small></span>
        </button>
        <nav className="side-nav">
          <button className={tab === "shelf" ? "active" : ""} onClick={() => go({ name: "shelf" })}>书架</button>
          <button className={tab === "cards" ? "active" : ""} onClick={() => go({ name: "cards" })}>读后卡片</button>
        </nav>
        <p className="model-note">四个角色都使用 {data?.settings.model ?? "Grok 4.7"}。{data?.settings.configured ? "密钥已连接。" : "尚未连接 XAI 密钥。系统里已有的其他密钥保持不动。"}</p>
      </aside>
      <main className="stage">
        <div key={`${screen.name}-${"bookId" in screen ? screen.bookId : ""}-${"cardId" in screen ? screen.cardId : ""}`} className={`screen ${dir}`}>
          {!data ? <div className="page"><LivingMark hot /><p>{error || "正在打开书架…"}</p>{error && <button className="btn primary" onClick={() => void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "没有打开。"))}>重新连接</button>}</div> : null}
          {data && screen.name === "shelf" && <Shelf data={data} reload={reload} open={(id) => go({ name: "reader", bookId: id })} openMarks={() => go({ name: "marks" })} replay={() => setOpened(false)} />}
          {data && screen.name === "reader" && <Reader bookId={screen.bookId} data={data} reload={reload} back={() => back({ name: "shelf" })} openCards={() => go({ name: "cards" })} />}
          {data && screen.name === "marks" && <Marks back={() => back({ name: "shelf" })} />}
          {data && screen.name === "cards" && <Cards data={data} open={(id) => go({ name: "card", cardId: id })} />}
          {data && screen.name === "card" && <CardPage card={data.cards.find((item) => item.id === screen.cardId)} book={data.books.find((item) => item.id === data.cards.find((card) => card.id === screen.cardId)?.bookId)} back={() => back({ name: "cards" })} />}
        </div>
      </main>
      <nav className="tabbar" aria-label="主导航">
        <button className={tab === "shelf" ? "active" : ""} onClick={() => go({ name: "shelf" })}>
          <LivingMark />
          <span>书架</span>
        </button>
        <button className={tab === "cards" ? "active" : ""} onClick={() => go({ name: "cards" })}>
          <LivingMark />
          <span>卡片</span>
        </button>
      </nav>
    </div>
    </MarkChoice.Provider>
  );
}

function LivingMark({ hot = false, calm = false }: { hot?: boolean; calm?: boolean }) {
  const { id } = useContext(MarkChoice);
  return (
    <span className={`mark-live${hot ? " hot" : ""}${calm ? " calm" : ""}`} aria-hidden="true">
      <MarkGlyph id={id} />
    </span>
  );
}

function Marks({ back }: { back: () => void }) {
  const { id, choose } = useContext(MarkChoice);
  return (
    <div className="page">
      <button className="back" onClick={back}>书架</button>
      <h1 className="large-title">十个图案</h1>
      <p className="lede">点一个，侧栏、封面和底部标签都会换成它，并保持缓慢变形。</p>
      <div className="mark-grid">
        {MARKS.map((item) => (
          <button key={item.id} className={item.id === id ? "mark-choice on" : "mark-choice"} onClick={() => choose(item.id)}>
            <span className="mark"><MarkGlyph id={item.id} /></span>
            <b>{item.name}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

type CoverShape = "rect" | "square" | "round";
interface BookCase {
  id: string;
  name: string;
  bookIds: string[];
}
const COVER_SHAPES: { id: CoverShape; name: string }[] = [
  { id: "rect", name: "长方形" },
  { id: "square", name: "正方形" },
  { id: "round", name: "圆形" },
];
const CLOTH = ["#e7d3bf", "#d9c7b8", "#ecd8c4", "#d5c4ae", "#e4cfc0"];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function clothFor(books: { id: string }[], id: string): string {
  const index = Math.max(0, books.findIndex((item) => item.id === id));
  return CLOTH[index % CLOTH.length];
}

function HoldButton({ className, style, label, caseId, onTap, onHold, onDrag, children }: {
  className?: string;
  style?: CSSProperties;
  label: string;
  caseId?: string;
  onTap: () => void;
  onHold: () => void;
  onDrag?: (phase: "move" | "end", point: { x: number; y: number }) => void;
  children: ReactNode;
}) {
  const press = useRef({ timer: 0, held: false, dragging: false, x: 0, y: 0 });
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label}
      data-case={caseId}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 捕获失败时仍靠松手判断 */ }
        press.current.held = false;
        press.current.dragging = false;
        press.current.x = event.clientX;
        press.current.y = event.clientY;
        window.clearTimeout(press.current.timer);
        press.current.timer = window.setTimeout(() => { press.current.held = true; }, 420);
      }}
      onPointerMove={(event) => {
        const dx = event.clientX - press.current.x;
        const dy = event.clientY - press.current.y;
        if (!press.current.held) {
          if (dx * dx + dy * dy > 144) window.clearTimeout(press.current.timer);
          return;
        }
        if (!onDrag || (dx * dx + dy * dy < 36 && !press.current.dragging)) return;
        press.current.dragging = true;
        onDrag("move", { x: event.clientX, y: event.clientY });
      }}
      onPointerUp={(event) => {
        window.clearTimeout(press.current.timer);
        if (press.current.dragging) onDrag?.("end", { x: event.clientX, y: event.clientY });
        else if (press.current.held) onHold();
      }}
      onPointerCancel={() => window.clearTimeout(press.current.timer)}
      onClick={() => {
        if (press.current.held || press.current.dragging) {
          press.current.held = false;
          press.current.dragging = false;
          return;
        }
        onTap();
      }}
    >
      {children}
    </button>
  );
}

function useOpeningLine(bookId: string): string {
  const [line, setLine] = useState("");
  useEffect(() => {
    let alive = true;
    setLine("");
    void loadBook(bookId).then((full) => {
      if (!alive) return;
      const paragraph = full.text.split(/\n+/).map((item) => item.trim()).find(Boolean) ?? "";
      setLine(paragraph.slice(0, 42));
    }).catch(() => { if (alive) setLine(""); });
    return () => { alive = false; };
  }, [bookId]);
  return line;
}

function LooseBook({ book, cloth, shape, onOpen, onHold, onDrag }: {
  book: Bootstrap["books"][number];
  cloth: string;
  shape: CoverShape;
  onOpen: () => void;
  onHold: () => void;
  onDrag: (phase: "move" | "end", point: { x: number; y: number }) => void;
}) {
  const line = useOpeningLine(book.id);
  return (
    <HoldButton
      className={`cover shelf-book shape-${shape}`}
      style={{ ["--cloth" as string]: cloth }}
      label={`${book.title}，点一下阅读，长按后拖进书匣`}
      onTap={onOpen}
      onHold={onHold}
      onDrag={onDrag}
    >
      <LivingMark calm />
      <span className="title"><b>{book.title}</b><small>{book.author}</small></span>
      <small className="cover-foot">{line || book.license}</small>
    </HoldButton>
  );
}

function Shelf({ data, reload, open, openMarks, replay }: { data: Bootstrap; reload: () => Promise<void>; open: (id: string) => void; openMarks: () => void; replay: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [shapes, setShapes] = useState<Record<string, CoverShape>>(() => readJson("mizhi-shapes", {}));
  const [cases, setCases] = useState<BookCase[]>(() => readJson("mizhi-bookcases", []));
  const [menuId, setMenuId] = useState<string | null>(null);
  const [caseName, setCaseName] = useState("");
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [lift, setLift] = useState<{ id: string; ox: number; oy: number; w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<{ kind: "book" | "case"; id: string; x: number; y: number; over: string | null } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const point = useRef({ x: 0, y: 0 });
  const frames = useRef(new Map<string, DOMRect>());
  const housed = new Set(cases.flatMap((item) => item.bookIds));
  const loose = data.books.filter((book) => !housed.has(book.id));
  const menuBook = data.books.find((book) => book.id === menuId);
  useEffect(() => {
    if (localStorage.getItem("mizhi-demo-v1")) return;
    const bySource = (source: string) => data.books.find((book) => book.source === source);
    const xue = data.books.find((book) => book.id === "seed-xue-er");
    const dao = bySource("demo:daode");
    const shi = bySource("demo:shijing");
    const tang = bySource("demo:jingye");
    const chun = bySource("demo:chunxiao");
    const min = bySource("demo:minnong");
    const deng = bySource("demo:denglou");
    if (!xue || !dao || !shi || !tang || !chun || !min || !deng) return;
    const nextCases: BookCase[] = [
      { id: "case-classics", name: "经籍", bookIds: [xue.id, dao.id] },
      { id: "case-poetry", name: "诗册", bookIds: [shi.id, tang.id] },
      { id: "case-field", name: "田园", bookIds: [chun.id, min.id] },
    ];
    const nextShapes: Record<string, CoverShape> = {
      [xue.id]: "square",
      [dao.id]: "round",
      [shi.id]: "rect",
      [tang.id]: "square",
      [chun.id]: "rect",
      [min.id]: "round",
      [deng.id]: "square",
    };
    setCases(nextCases);
    setShapes(nextShapes);
    localStorage.setItem("mizhi-bookcases", JSON.stringify(nextCases));
    localStorage.setItem("mizhi-shapes", JSON.stringify(nextShapes));
    localStorage.setItem("mizhi-demo-v1", "1");
  }, [data.books]);
  function saveShapes(next: Record<string, CoverShape>) {
    setShapes(next);
    localStorage.setItem("mizhi-shapes", JSON.stringify(next));
  }
  function saveCases(next: BookCase[]) {
    setCases(next);
    localStorage.setItem("mizhi-bookcases", JSON.stringify(next));
  }
  function shapeOf(id: string): CoverShape {
    return shapes[id] ?? "rect";
  }
  function place(bookId: string, caseId: string) {
    setCases((current) => {
      const next = current.map((item) => ({
        ...item,
        bookIds: item.id === caseId ? [...item.bookIds.filter((id) => id !== bookId), bookId] : item.bookIds.filter((id) => id !== bookId),
      }));
      localStorage.setItem("mizhi-bookcases", JSON.stringify(next));
      return next;
    });
    setMenuId(null);
    setCaseName("");
  }
  function caseUnder(x: number, y: number): string | null {
    const node = document.elementFromPoint(x, y);
    return node?.closest<HTMLElement>("[data-case]")?.dataset.case ?? null;
  }
  function removeFromCases(bookId: string) {
    setCases((current) => {
      const next = current.map((item) => ({ ...item, bookIds: item.bookIds.filter((id) => id !== bookId) }));
      localStorage.setItem("mizhi-bookcases", JSON.stringify(next));
      return next;
    });
    setMenuId(null);
  }
  function onBookDrag(bookId: string, phase: "move" | "end", point: { x: number; y: number }) {
    const over = caseUnder(point.x, point.y);
    if (phase === "end") {
      if (over) place(bookId, over);
      else removeFromCases(bookId);
      setDrag(null);
      return;
    }
    setDrag({ kind: "book", id: bookId, ...point, over });
  }
  function shiftCase(fromId: string, toId: string) {
    const board = boardRef.current;
    if (board) {
      const nextFrames = new Map<string, DOMRect>();
      board.querySelectorAll<HTMLElement>("[data-case-tile]").forEach((el) => {
        const id = el.dataset.caseTile;
        if (id) nextFrames.set(id, el.getBoundingClientRect());
      });
      frames.current = nextFrames;
    }
    setCases((current) => {
      const next = [...current];
      const from = next.findIndex((item) => item.id === fromId);
      const to = next.findIndex((item) => item.id === toId);
      if (from < 0 || to < 0 || from === to) return current;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      localStorage.setItem("mizhi-bookcases", JSON.stringify(next));
      return next;
    });
  }
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    board.querySelectorAll<HTMLElement>("[data-case-tile]").forEach((el) => {
      const id = el.dataset.caseTile;
      const prev = id ? frames.current.get(id) : undefined;
      if (!id || !prev || id === lift?.id) return;
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 320ms cubic-bezier(0.2, 0.85, 0.2, 1)";
        el.style.transform = "";
      });
    });
  }, [cases, lift?.id]);
  function onSlotDown(id: string, event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY, ox: event.clientX - rect.left, oy: event.clientY - rect.top, w: rect.width, h: rect.height };
    let active = false;
    let landed = "";
    const timer = window.setTimeout(() => {
      active = true;
      point.current = { x: origin.x - origin.ox, y: origin.y - origin.oy };
      setOpenCase(null);
      setEditing(true);
      setLift({ id, ox: origin.ox, oy: origin.oy, w: origin.w, h: origin.h });
    }, 420);
    const move = (e: PointerEvent) => {
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (!active) {
        if (dx * dx + dy * dy > 144) window.clearTimeout(timer);
        return;
      }
      point.current = { x: e.clientX - origin.ox, y: e.clientY - origin.oy };
      if (floatRef.current) {
        floatRef.current.style.left = `${point.current.x}px`;
        floatRef.current.style.top = `${point.current.y}px`;
      }
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-case-tile]")?.dataset.caseTile;
      if (over && over !== id && over !== landed) {
        landed = over;
        shiftCase(id, over);
      }
    };
    const up = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (active) setLift(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      await task();
      await reload();
      setMessage(done);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "没有完成。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page" onClick={(event) => {
      if (!editing) return;
      if ((event.target as HTMLElement).closest(".case-board, .edit-bar, .bookcase")) return;
      setEditing(false);
    }}>
      <button className="eyebrow mark-link" onClick={openMarks}>弥知 · 十个图案</button>
      <button className="eyebrow mark-link dawn-replay" onClick={replay}>再看开场</button>
      <h1 className="large-title">书架</h1>
      <p className="lede">点一下读书。书在书匣里时，先点开书匣，再点那本书。长按书匣可以排列，长按书可以拖进或拖出书匣。</p>
      <p className="status-line">{data.settings.model}{data.settings.configured ? " 已连接" : " 尚未连接"}</p>
      <div className="toolbar">
        <button className="btn primary" disabled={busy} onClick={() => void run(() => acquireAlice(), "已放入《爱丽丝》。")}>获取公有领域的《爱丽丝》</button>
        <button className="btn secondary" disabled={busy} onClick={() => fileRef.current?.click()}>上传 txt</button>
        <input ref={fileRef} className="hidden-file" type="file" accept=".txt,text/plain" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void run(async () => {
            const text = await file.text();
            await uploadBook({ title: file.name.replace(/\.txt$/i, ""), author: "未署名", text });
          }, "这本书已放上书架。");
        }} />
      </div>
      {message && <div className="notice">{message}</div>}
      {editing && (
        <div className="edit-bar">
          <span>拖动排列书匣</span>
          <button type="button" className="text-button" onClick={() => setEditing(false)}>完成</button>
        </div>
      )}
      <div ref={boardRef} className={`case-board${editing ? " editing" : ""}`}>
        {cases.map((box, index) => {
          const books = box.bookIds.map((id) => data.books.find((item) => item.id === id)).filter((item): item is Bootstrap["books"][number] => Boolean(item));
          if (openCase === box.id) {
            return (
              <section key={box.id} className={`bookcase${drag?.over === box.id ? " over" : ""}`} data-case={box.id} data-case-tile={box.id}>
                <header>
                  <span>书匣</span>
                  <b>{box.name}</b>
                  <small>{books.length} 本</small>
                  <button type="button" className="text-button" onClick={() => setOpenCase(null)}>收起</button>
                </header>
                <div className="bookcase-lid">
                  {books.length === 0 ? <p>这个匣还空着。把书拖进来。</p> : books.map((book) => (
                    <HoldButton
                      key={book.id}
                      className={`mini-book shape-${shapeOf(book.id)}`}
                      style={{ ["--cloth" as string]: clothFor(data.books, book.id) }}
                      label={`${book.title}，在${box.name}里`}
                      onTap={() => open(book.id)}
                      onHold={() => setMenuId(book.id)}
                      onDrag={(phase, point) => onBookDrag(book.id, phase, point)}
                    >
                      <b>{book.title}</b>
                    </HoldButton>
                  ))}
                </div>
              </section>
            );
          }
          return (
            <div
              key={box.id}
              className={`app-slot${lift?.id === box.id ? " placeholder" : ""}`}
              data-case={box.id}
              data-case-tile={box.id}
              onPointerDown={(event) => onSlotDown(box.id, event)}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest(".spine")) return;
                if (editing || lift) return;
                setOpenCase(box.id);
              }}
            >
              <div className="app-jiggle" style={{ animationDelay: `${(index % 4) * 40}ms` }}>
                <div className={`case-square${drag?.over === box.id ? " over" : ""}`}>
                  <span className="case-spines">
                    {books.map((book) => (
                      <button
                        key={book.id}
                        type="button"
                        className="spine"
                        style={{ ["--cloth" as string]: clothFor(data.books, book.id) }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (editing) return;
                          setOpenCase(box.id);
                        }}
                      >
                        <b>{book.title}</b>
                      </button>
                    ))}
                  </span>
                </div>
                <span className="case-name">{box.name}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className={`loose-shelf${drag?.kind === "book" && !drag.over ? " hot" : ""}`}>
        {loose.map((book) => (
          <LooseBook key={book.id} book={book} cloth={clothFor(data.books, book.id)} shape={shapeOf(book.id)} onOpen={() => open(book.id)} onHold={() => setMenuId(book.id)} onDrag={(phase, point) => onBookDrag(book.id, phase, point)} />
        ))}
      </div>
      {lift && (() => {
        const box = cases.find((item) => item.id === lift.id);
        const books = box?.bookIds.map((id) => data.books.find((item) => item.id === id)).filter((item): item is Bootstrap["books"][number] => Boolean(item)) ?? [];
        return (
          <div ref={floatRef} className="case-float" style={{ width: lift.w, height: lift.h, left: point.current.x, top: point.current.y }}>
            <div className="case-square">
              <span className="case-spines">
                {books.map((book) => (
                  <span key={book.id} className="spine" style={{ ["--cloth" as string]: clothFor(data.books, book.id) }}><b>{book.title}</b></span>
                ))}
              </span>
            </div>
            <span className="case-name">{box?.name}</span>
          </div>
        );
      })()}
      {drag?.kind === "book" && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>{data.books.find((item) => item.id === drag.id)?.title}</div>
      )}
      {menuBook && (
        <div className="option-mask" onClick={() => setMenuId(null)}>
          <div className="option-sheet" role="dialog" aria-label={`${menuBook.title}的选项`} onClick={(event) => event.stopPropagation()}>
            <strong>{menuBook.title}</strong>
            <p>封面形状</p>
            <div className="shape-picks">
              {COVER_SHAPES.map((item) => (
                <button key={item.id} type="button" aria-label={item.name} className={shapeOf(menuBook.id) === item.id ? "on" : ""} onClick={() => saveShapes({ ...shapes, [menuBook.id]: item.id })}>
                  <i className={`shape-swatch shape-${item.id}`} />
                </button>
              ))}
            </div>
            <p>书匣</p>
            <input value={caseName} placeholder="新匣的名字" onChange={(event) => setCaseName(event.target.value)} />
            <button type="button" className="btn secondary" onClick={() => {
              const name = caseName.trim().slice(0, 24) || (cases.length ? `书匣 ${cases.length + 1}` : "书匣");
              const next = cases.map((item) => ({ ...item, bookIds: item.bookIds.filter((id) => id !== menuBook.id) }));
              next.push({ id: crypto.randomUUID(), name, bookIds: [menuBook.id] });
              saveCases(next);
              setMenuId(null);
              setCaseName("");
            }}>放进新书匣</button>
            {cases.map((box) => (
              <button key={box.id} type="button" className="btn secondary" onClick={() => place(menuBook.id, box.id)}>放入{box.name}</button>
            ))}
            {cases.some((box) => box.bookIds.includes(menuBook.id)) && (
              <button type="button" className="btn secondary" onClick={() => {
                saveCases(cases.map((item) => ({ ...item, bookIds: item.bookIds.filter((id) => id !== menuBook.id) })));
                setMenuId(null);
              }}>从匣中取出</button>
            )}
            <button type="button" className="text-button" onClick={() => setMenuId(null)}>完成</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Reader({ bookId, data, reload, back, openCards }: { bookId: string; data: Bootstrap; reload: () => Promise<void>; back: () => void; openCards: () => void }) {
  const [book, setBook] = useState<Book | null>(null);
  const [passage, setPassage] = useState<{ quote: string; top: number; left: number } | null>(null);
  const [hits, setHits] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cardOpen, setCardOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [float, setFloat] = useState<{ x: number; y: number } | null>(() => {
    const saved = localStorage.getItem("mizhi-float");
    return saved ? (JSON.parse(saved) as { x: number; y: number }) : null;
  });
  const drag = useRef({ active: false, moved: false, timer: 0, x: 0, y: 0, left: 0, top: 0 });
  useEffect(() => {
    if (!tocOpen) return;
    document.querySelector(".toc-group.current")?.scrollIntoView({ block: "start" });
  }, [tocOpen, page]);
  useEffect(() => {
    void loadBook(bookId).then(setBook).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "书没有打开。"));
  }, [bookId]);
  useEffect(() => {
    if (!book) return;
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const selected = window.getSelection();
        const quote = selected?.toString().replace(/\s+/g, "").trim() ?? "";
        const node = selected?.anchorNode;
        const article = document.querySelector(".article");
        if (!quote || quote.length < 2 || !book.text.includes(quote) || !node || !article?.contains(node) || !selected?.rangeCount) return;
        const rect = selected.getRangeAt(0).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const left = Math.min(window.innerWidth - 92, Math.max(92, rect.left + rect.width / 2));
        const top = Math.max(72, Math.min(window.innerHeight - 140, rect.top));
        setPassage({ quote, top, left });
      }, 160);
    };
    document.addEventListener("selectionchange", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.clearTimeout(timer);
    };
  }, [book]);
  const dialogue = data.dialogues.find((item) => item.bookId === bookId && passage && item.quote === passage.quote);
  const paragraphs = useMemo(() => (book ? paragraphsOf(book.text) : []), [book]);
  const pages = useMemo(() => paginate(paragraphs), [paragraphs]);
  const current = pages[Math.min(page, Math.max(pages.length - 1, 0))] ?? [];
  function onSelect() {
    const selected = window.getSelection();
    const quote = selected?.toString().trim() ?? "";
    if (!quote || quote.length < 2 || !book?.text.includes(quote)) {
      setPassage(null);
      return;
    }
    const rect = selected?.getRangeAt(0).getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(window.innerWidth - 92, Math.max(92, rect.left + rect.width / 2));
    const top = Math.max(72, Math.min(window.innerHeight - 140, rect.top));
    setPassage({ quote, top, left });
  }
  async function send() {
    if (!passage || !draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      await speak({ bookId, dialogueId: dialogue?.id, quote: passage.quote, userText: draft.trim() });
      setDraft("");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Grok 4.7 没有回复。");
    } finally {
      setBusy(false);
    }
  }
  function openHit(hit: string) {
    const index = pages.findIndex((items) => items.some((item) => item.text.includes(hit)));
    if (index >= 0) setPage(index);
    setPassage({ quote: hit, top: 120, left: Math.min(window.innerWidth / 2, 220) });
    setOpen(true);
  }
  async function listen() {
    if (!book) return;
    setListening(true);
    setError("");
    try {
      const said = await hear();
      const found = locate(book.text, said);
      if (!found.length) {
        setError(`没有在这篇文章里定位到「${said}」。`);
        setHits([]);
        return;
      }
      setHits(found);
      openHit(found[0]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "语音没有完成。");
    } finally {
      setListening(false);
    }
  }
  function pointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 合成事件或不支持捕获时，长按计时仍然继续 */ }
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current.moved = false;
    drag.current.active = false;
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    drag.current.left = rect.left;
    drag.current.top = rect.top;
    window.clearTimeout(drag.current.timer);
    if (!drag.current.active) drag.current.timer = window.setTimeout(() => { drag.current.active = true; }, 420);
  }
  function pointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current.active) return;
    drag.current.moved = true;
    setFloat({
      x: Math.min(window.innerWidth - 64, Math.max(8, drag.current.left + event.clientX - drag.current.x)),
      y: Math.min(window.innerHeight - 80, Math.max(8, drag.current.top + event.clientY - drag.current.y)),
    });
  }
  function pointerUp() {
    window.clearTimeout(drag.current.timer);
    if (drag.current.active && drag.current.moved) {
      setFloat((value) => {
        if (value) localStorage.setItem("mizhi-float", JSON.stringify(value));
        return value;
      });
    }
    const talk = !drag.current.active && !drag.current.moved;
    drag.current.active = false;
    if (talk) void listen();
  }
  return (
    <div className="reader-shell">
      <article className="reader">
        <div className="read-bar">
          <button className="back" onClick={back}>书架</button>
          <strong>{book?.title ?? "阅读"}</strong>
          {passage ? (
            <button className="back talk" onClick={() => setOpen(true)}>谈这段</button>
          ) : (
            <span />
          )}
        </div>
        {book ? (
          <>
            <p className="meta">{book.author} · {book.license}</p>
            <h1 className="book-title">{book.title}</h1>
            <div
              className="article"
              onMouseUp={onSelect}
              onTouchStart={(event) => {
                drag.current.x = event.changedTouches[0].clientX;
              }}
              onTouchEnd={(event) => {
                onSelect();
                const startX = drag.current.x;
                const dx = event.changedTouches[0].clientX - startX;
                if (Math.abs(dx) > 60 && !window.getSelection()?.toString()) {
                  setPage((value) => (dx < 0 ? Math.min(pages.length - 1, value + 1) : Math.max(0, value - 1)));
                }
              }}
            >
              {current.map((paragraph) => (
                <p key={paragraph.start} id={`p-${paragraph.start}`} className={hits.some((hit) => paragraph.text.includes(hit)) || (passage && paragraph.text.includes(passage.quote)) ? "hit" : ""}>{paragraph.text}</p>
              ))}
            </div>
            {hits.length > 0 && (
              <div className="hit-list">
                {hits.map((hit) => (
                  <button key={hit} className="quote-chip" onClick={() => openHit(hit)}>{formatQuote(hit)}</button>
                ))}
              </div>
            )}
            {error && !open && <p className="error">{error}</p>}
            <div className="pager">
              <button className="btn secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button>
              <button className="btn secondary" onClick={() => setTocOpen(true)}>目录 {page + 1}/{pages.length || 1}</button>
              <button className="btn secondary" disabled={page >= pages.length - 1} onClick={() => setPage((value) => Math.min(pages.length - 1, value + 1))}>下一页</button>
            </div>
          </>
        ) : <p>{error || "正在打开书页…"}</p>}
      </article>
      {passage && !open && (
        <button className="selection-menu" style={{ top: passage.top, left: passage.left }} onClick={() => setOpen(true)}>与读伴谈这段</button>
      )}
      {open && passage && (
        <aside className="companion">
          <header>
            <div><strong>读伴</strong><div className="meta">{data.settings.model}</div></div>
            <button className="text-button" onClick={() => setOpen(false)}>收起</button>
          </header>
          <p className="quote-chip">{formatQuote(passage.quote)}</p>
          <p className="hint">先发给作者。理性读者和主观读者按这段的内容决定是否开口，读伴在他们之后说。</p>
          <div className="thread">
            {dialogue?.messages.map((message) => (
              <div key={message.id} className={message.role === "user" ? "bubble user" : "bubble agent"}>
                <small>{message.role === "user" ? "你" : roleLabels[message.role]}</small>
                {message.text}
              </div>
            ))}
            {busy && <div className="bubble agent"><LivingMark hot /> Grok 4.7 正在读这一段</div>}
          </div>
          {error && <div className="error">{error}</div>}
          <div className="compose">
            <textarea value={draft} rows={3} placeholder="写下你对这段的理解。默认先发给作者。" onChange={(event) => setDraft(event.target.value)} />
            <button className="btn primary full" disabled={busy || !draft.trim()} onClick={() => void send()}>发给作者</button>
            <button className="btn secondary full" onClick={() => setCardOpen(true)}>写成读后卡片</button>
          </div>
          {cardOpen && (
            <div className="card-sheet">
              <CardForm quote={passage.quote} dialogue={dialogue} bookId={bookId} onClose={() => setCardOpen(false)} onSaved={async () => { setCardOpen(false); await reload(); openCards(); }} />
            </div>
          )}
        </aside>
      )}
      {tocOpen && (
        <div className="card-sheet toc">
          <header className="toc-head">
            <div>
              <p className="eyebrow">{book?.title ?? "阅读"}</p>
              <h2>目录</h2>
              <p className="toc-summary">共 {pages.length} 页 · {paragraphs.length} 段 · 正在第 {Math.min(page, pages.length - 1) + 1} 页</p>
            </div>
            <button className="text-button" onClick={() => setTocOpen(false)}>完成</button>
          </header>
          <div className="toc-list">
            {pages.map((items, index) => (
              <section key={items[0]?.start ?? index} className={index === page ? "toc-group current" : "toc-group"}>
                <h3>第 {index + 1} 页{index === page ? " · 当前" : ""}</h3>
                {items.map((paragraph) => {
                  const entry = tocEntry(paragraph.text);
                  return (
                    <button
                      key={paragraph.start}
                      className="toc-row"
                      onClick={() => {
                        setPage(index);
                        setTocOpen(false);
                        window.setTimeout(() => document.getElementById(`p-${paragraph.start}`)?.scrollIntoView({ block: "center" }), 40);
                      }}
                    >
                      <span className="toc-copy">
                        <b>{entry.title}</b>
                        {entry.preview ? <small>{entry.preview}</small> : null}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      )}
      <button
        className={`float-mark${listening ? " on" : ""}`}
        style={float ? { left: float.x, top: float.y } : undefined}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="点一下开始语音定位，长按后可以拖动。"
      >
        <LivingMark hot={listening} />
      </button>
    </div>
  );
}

function tocEntry(text: string): { title: string; preview: string } {
  const trimmed = text.trim();
  const speaker = trimmed.match(/^([^：「」""]{1,16})[：:]/);
  if (speaker) {
    const preview = trimmed.slice(speaker[0].length).replace(/^[「"\s]+/, "").replace(/[」"]$/, "");
    return { title: speaker[1], preview: preview.slice(0, 42) };
  }
  return { title: trimmed.slice(0, 16), preview: trimmed.slice(16, 58) };
}

function formatQuote(quote: string): string {
  const text = quote.replace(/\s+/g, " ").trim();
  const shown = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  if (shown.startsWith("「") || shown.startsWith("\"")) return shown;
  return `「${shown}」`;
}

function latest(dialogue: Dialogue | undefined, role: Role): string {
  return [...(dialogue?.messages ?? [])].reverse().find((message) => message.role === role)?.text ?? "";
}

function CardForm({ quote, dialogue, bookId, onClose, onSaved }: { quote: string; dialogue?: Dialogue; bookId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [authorNote, setAuthorNote] = useState(latest(dialogue, "author"));
  const [rationalNote, setRationalNote] = useState(latest(dialogue, "rational"));
  const [subjectiveNote, setSubjectiveNote] = useState(latest(dialogue, "subjective"));
  const [synthesis, setSynthesis] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="card-form" onSubmit={(event) => {
      event.preventDefault();
      setBusy(true);
      setError("");
      void saveCard({ bookId, quote, authorNote, rationalNote, subjectiveNote, synthesis })
        .then(() => onSaved())
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "卡片没有保存。"))
        .finally(() => setBusy(false));
    }}>
      <label>作者本意<textarea rows={2} value={authorNote} placeholder="作者还没说话时，可以先空着。" onChange={(event) => setAuthorNote(event.target.value)} /></label>
      <label>理性意见<textarea rows={2} value={rationalNote} placeholder="理性读者还没说话时，可以先空着。" onChange={(event) => setRationalNote(event.target.value)} /></label>
      <label>主观体会<textarea rows={2} value={subjectiveNote} placeholder="主观读者还没说话时，可以先空着。" onChange={(event) => setSubjectiveNote(event.target.value)} /></label>
      <label>你的调节<textarea rows={3} required value={synthesis} placeholder="只用你自己的话写下取舍。" onChange={(event) => setSynthesis(event.target.value)} /></label>
      {error && <div className="error">{error}</div>}
      <div className="card-actions">
        <button className="btn primary" disabled={busy || synthesis.trim().length < 2}>保存到书架日记</button>
        <button className="btn secondary" type="button" onClick={onClose}>取消</button>
      </div>
    </form>
  );
}

function Cards({ data, open }: { data: Bootstrap; open: (id: string) => void }) {
  const groups = useMemo(() => {
    const order: string[] = [];
    for (const card of data.cards) if (!order.includes(card.bookId)) order.push(card.bookId);
    return order.map((bookId) => ({
      bookId,
      title: data.books.find((item) => item.id === bookId)?.title ?? "一本书",
      cards: data.cards.filter((item) => item.bookId === bookId),
    }));
  }, [data.books, data.cards]);
  const [boxId, setBoxId] = useState<string | null>(null);
  const box = groups.find((item) => item.bookId === boxId);
  return (
    <div className="page">
      <p className="eyebrow">日记</p>
      <h1 className="large-title">读后卡片</h1>
      <p className="lede">每本书一个卡片匣。点开后，卡片像唱片一样左右翻。</p>
      {groups.length === 0 ? (
        <div className="empty">
          <LivingMark />
          <h2>还没有读后卡片</h2>
          <p>在书里选中一段，谈完后写成卡片。</p>
        </div>
      ) : (
        <div className="card-cases">
          {groups.map((group) => (
            <button key={group.bookId} type="button" className="card-case" onClick={() => setBoxId(group.bookId)}>
              <span className="case-discs" aria-hidden="true">
                {group.cards.slice(0, 3).map((card) => <i key={card.id}></i>)}
              </span>
              <span className="card-case-copy">
                <b>{group.title}</b>
                <small>{group.cards.length} 张</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {box && <CdPopup title={box.title} cards={box.cards} cloth={clothFor(data.books, box.bookId)} onClose={() => setBoxId(null)} onOpen={open} />}
    </div>
  );
}

function CdPopup({ title, cards, cloth, onClose, onOpen }: {
  title: string;
  cards: ReadingCard[];
  cloth: string;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const gesture = useRef({ x: 0, moved: false });
  const current = Math.min(index, Math.max(cards.length - 1, 0));
  const card = cards[current];
  function step(delta: number) {
    if (cards.length < 2) return;
    setIndex((value) => (Math.min(value, cards.length - 1) + delta + cards.length) % cards.length);
  }
  if (!card) return null;
  return (
    <div className="cd-pop" role="dialog" aria-modal="true" aria-label={`${title}的卡片匣`}>
      <div className="cd-sheet">
        <header>
          <div>
            <span>卡片匣</span>
            <strong>{title}</strong>
          </div>
          <button type="button" className="text-button" onClick={onClose}>完成</button>
        </header>
        <div
          className="cd-stage"
          onPointerDown={(event) => { gesture.current = { x: event.clientX, moved: false }; }}
          onPointerUp={(event) => {
            const dx = event.clientX - gesture.current.x;
            if (Math.abs(dx) > 42) {
              gesture.current.moved = true;
              step(dx < 0 ? 1 : -1);
            }
          }}
        >
          {cards.map((item, itemIndex) => {
            let offset = itemIndex - current;
            if (offset > cards.length / 2) offset -= cards.length;
            if (offset < -cards.length / 2) offset += cards.length;
            if (Math.abs(offset) > 2) return null;
            return (
              <button
                key={item.id}
                type="button"
                className="disc"
                style={{ ["--cloth" as string]: cloth, transform: `translateX(${offset * 74}%) scale(${offset === 0 ? 1 : 0.66})`, zIndex: 8 - Math.abs(offset) }}
                onClick={() => {
                  if (gesture.current.moved) {
                    gesture.current.moved = false;
                    return;
                  }
                  if (offset === 0) onOpen(item.id);
                  else setIndex(itemIndex);
                }}
              >
                <b>{item.synthesis}</b>
              </button>
            );
          })}
        </div>
        <p className="disc-caption">{card.synthesis}</p>
        <p className="disc-quote">{card.quote}</p>
        <div className="disc-nav">
          <button type="button" className="btn secondary" disabled={cards.length < 2} onClick={() => step(-1)}>上一张</button>
          <span>{current + 1} / {cards.length}</span>
          <button type="button" className="btn secondary" disabled={cards.length < 2} onClick={() => step(1)}>下一张</button>
        </div>
        <button type="button" className="btn primary full" onClick={() => onOpen(card.id)}>看全文</button>
      </div>
    </div>
  );
}

function CardPage({ card, book, back }: { card?: ReadingCard; book?: { title: string }; back: () => void }) {
  if (!card) return <div className="page"><button className="back" onClick={back}>‹ 卡片</button><p>这张卡片不在当前书架上。</p></div>;
  return (
    <div className="card-page">
      <button className="back" onClick={back}>‹ 卡片</button>
      <p className="meta">{book?.title}</p>
      <h1 className="book-title">{card.synthesis}</h1>
      <section><h2>原文</h2><p>{card.quote}</p></section>
      <section><h2>作者本意</h2><p>{card.authorNote}</p></section>
      <section><h2>理性意见</h2><p>{card.rationalNote}</p></section>
      <section><h2>主观体会</h2><p>{card.subjectiveNote}</p></section>
    </div>
  );
}

function paginate(paragraphs: { start: number; text: string }[]) {
  const pages: { start: number; text: string }[][] = [];
  let page: { start: number; text: string }[] = [];
  let count = 0;
  for (const paragraph of paragraphs) {
    if (page.length && count + paragraph.text.length > 320) {
      pages.push(page);
      page = [];
      count = 0;
    }
    page.push(paragraph);
    count += paragraph.text.length;
  }
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}

function locate(text: string, spoken: string): string[] {
  const compact = (value: string) => value.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
  const speech = compact(spoken);
  if (speech.length < 2) return [];
  const found: string[] = [];
  for (const paragraph of paragraphsOf(text)) {
    const body = compact(paragraph.text);
    if (body.length < 4) continue;
    const matched = speech.includes(body) || (speech.length >= 4 && body.includes(speech)) || sharesRun(speech, body, Math.min(6, speech.length));
    if (matched) found.push(paragraph.text);
  }
  return found;
}

function sharesRun(left: string, right: string, size: number): boolean {
  if (size < 2 || left.length < size || right.length < size) return false;
  for (let index = 0; index <= left.length - size; index += 1) {
    if (right.includes(left.slice(index, index + size))) return true;
  }
  return false;
}

function hear(): Promise<string> {
  const host = window as Window & { SpeechRecognition?: new () => SpeechHandle; webkitSpeechRecognition?: new () => SpeechHandle };
  const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  if (!Ctor) return Promise.reject(new Error("这台浏览器没有语音识别。iPhone 请用 Safari，电脑请用 Chrome。"));
  const recognition = new Ctor();
  recognition.lang = "zh-CN";
  return new Promise((resolve, reject) => {
    recognition.onresult = (event) => resolve(event.results[0][0].transcript);
    recognition.onerror = () => reject(new Error("没有听清，请再试一次。"));
    recognition.start();
  });
}

type SpeechHandle = {
  lang: string;
  onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};

function paragraphsOf(text: string): { start: number; text: string }[] {
  const result: { start: number; text: string }[] = [];
  let cursor = 0;
  for (const block of text.split(/\n+/)) {
    const start = text.indexOf(block, cursor);
    if (block.trim()) result.push({ start, text: block.trim() });
    cursor = Math.max(cursor, start + block.length);
  }
  return result;
}
