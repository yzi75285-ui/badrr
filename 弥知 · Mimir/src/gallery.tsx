export const markIds = ["bloom", "pages", "fold", "seed", "tri", "fan", "ring", "leaf", "pair", "burst"] as const;
export type MarkId = (typeof markIds)[number];

export const markNames: Record<MarkId, string> = {
  bloom: "花开",
  pages: "双页",
  fold: "折角",
  seed: "种子",
  tri: "三锋",
  fan: "扇页",
  ring: "缺口",
  leaf: "一叶",
  pair: "对望",
  burst: "星页",
};

export const MARKS = markIds.map((id) => ({ id, name: markNames[id] }));

export function readMark(): MarkId {
  const saved = localStorage.getItem("mizhi-mark");
  return markIds.includes(saved as MarkId) ? (saved as MarkId) : "bloom";
}

export function MarkGlyph({ id }: { id: MarkId }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths(id).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function paths(id: MarkId): string[] {
  switch (id) {
    case "bloom":
      return ["M12 3.2c2.2 2.4 2.4 6.2 0 8.8c-2.4-2.6-2.2-6.4 0-8.8Z", "M20.2 8.2c-1 3.2-4.2 5.2-8.2 3.8c4-1.4 7.2-.6 8.2-3.8Z", "M19.4 17.2c-3 .8-6.2-.6-7.4-4.2c1.2 3.6 4.4 5 7.4 4.2Z", "M8.4 20.6c-1.6-2.8-.4-6.4 2.6-8.2c-3 1.8-4.2 5.4-2.6 8.2Z", "M3.2 12.8c2.6-1.8 6.2-1 8.4 1.6c-2.2-2.6-5.8-3.4-8.4-1.6Z"];
    case "pages":
      return ["M12 4c3.4 2.2 5.2 6.4 4.2 11.2C13.6 12.2 12.2 8.4 12 4Z", "M12 4C8.6 6.2 6.8 10.4 7.8 15.2C10.4 12.2 11.8 8.4 12 4Z"];
    case "fold":
      return ["M6 5h8l4 4v10H6V5Z", "M14 5v4h4"];
    case "seed":
      return ["M12 4.2a7.8 7.8 0 1 0 6.4 3.2", "M12 12c1.6-2.8 1.4-5.2 0-7.2c-1.4 2-1.6 4.4 0 7.2Z"];
    case "tri":
      return ["M12 3.2c1.5 2.6 1.4 5.4 0 8.2c-1.4-2.8-1.5-5.6 0-8.2Z", "M5.2 18.2c2.6-1.6 5-1.2 6.8.6c-1.8-1.8-4.2-2.2-6.8-.6Z", "M18.8 18.2c-2.6-1.6-5-1.2-6.8.6c1.8-1.8 4.2-2.2 6.8-.6Z"];
    case "fan":
      return ["M12 16c-1.2-4.6-.2-8.2 2.2-11.2C13.2 8.4 12.6 12.2 12 16Z", "M12 16c.2-4.8 2.2-8.4 5.2-10.8C15.6 8.6 13.6 12.2 12 16Z", "M12 16c1.6-4.4 4.4-7.2 8-8.6C17.6 10 14.6 12.8 12 16Z", "M12 16c-2.2-4.2-2.8-8-1.2-11.4C9.6 8.2 10.4 12 12 16Z"];
    case "ring":
      return ["M12 5.2a6.8 6.8 0 1 1-6.2 9.4", "M12 8.4a3.6 3.6 0 1 0 3.2 5.4"];
    case "leaf":
      return ["M12 3c4.8 3.2 6.2 8.4 4.6 14.2C12.8 14.2 10.4 8.6 12 3Z", "M12 6.5c.2 3.2.8 6.2 2.2 8.8"];
    case "pair":
      return ["M8.2 6.2c2.4 1.6 3.2 5.2 2.2 9.4C8.2 13.2 6.6 9.2 8.2 6.2Z", "M15.8 6.2c-2.4 1.6-3.2 5.2-2.2 9.4c2.2-2.4 3.8-6.4 2.2-9.4Z"];
    case "burst":
      return ["M12 2.4c1.2 3 1.1 6.2 0 9.2c-1.1-3-1.2-6.2 0-9.2Z", "M21.2 8c-3.2 1-5.6 3.2-6.8 6.4c1.2-3.2 3.6-5.4 6.8-6.4Z", "M18.6 19.4c-2.2-2.4-5.4-3.2-8.6-2.4c3.2-.8 6.4 0 8.6 2.4Z", "M5.2 18.8c.6-3.2 2.8-5.8 6-7.2c-3.2 1.4-5.4 4-6 7.2Z", "M3.2 9.2c3 .4 5.6 2.2 7.2 4.8C8.8 11.4 6.2 9.6 3.2 9.2Z", "M12 14.2a2.2 2.2 0 1 0 .1 0Z"];
  }
}
