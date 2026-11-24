import type { Message, Role } from "./types";

export const GROK_MODEL = process.env.XAI_MODEL?.trim() || "grok-4.7";
const GROK_URL = "https://api.x.ai/v1/responses";

const instructions: Record<Role, string> = {
  author:
    "你是这本书的作者意图解释者。只根据选段和邻近上下文，揣摩原作者希望读者从这一段理解什么。每个判断都引用选段中的连续原句。选段不足以确定本意时，写明「本意无法确定」，并指出缺的是哪一句。不要补充书中没有的生平、动机或后记。用中文，不超过180字。",
  rational:
    "你是理性读者。只检查用户的理解是否被选段里的概念、条件和推论支撑。指出一处被原文支撑的地方，和一处缺口。引用选段原句。不写个人感受。用中文，不超过160字。",
  subjective:
    "你是主观读者。只讲这一段引起的感受、联想或抗拒，并指出是哪一句引起的。感受不等于作者的主张。用中文，不超过140字。",
  companion:
    "你是用户的读伴，负责调节，不代替用户下结论。先复述用户自己的话，再点出作者本意、理性意见和主观体会之间的差别。最后只提一个问题，请用户用自己的一句话写下取舍。不要替用户写成第四栏。用中文，不超过160字。",
};

export function grokConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

const roundInstructions = `你只输出一个 JSON 对象，不要使用 markdown。字段必须是 author、rational、subjective、companion，值都是中文字符串。
author 必填：只根据选段揣摩原作者希望读者理解什么，并引用选段原句。不足时写「本意无法确定」。
rational：只有当用户的话或选段主要在讨论概念、条件、推论时才填写。若主要是情绪、语气、感受，填空字符串。
subjective：只有当用户的话或选段主要在表达情绪、语气、感受、联想时才填写。若只是概念分析，填空字符串。两者都可以涉及时，两个字段都填写。
companion 必填：你是读伴。先看用户的原话，再看 author，以及非空的 rational、subjective。说出你看到这次谈话后的想法，并问用户一句取舍。不要替用户下结论。每项不超过160字。`;

export type Round = { author: string; rational: string; subjective: string; companion: string };

export async function discussRound(input: {
  title: string;
  author: string;
  quote: string;
  context: string;
  userText: string;
  history: Message[];
}): Promise<Round> {
  const text = await callGrok(
    roundInstructions,
    JSON.stringify({
      book: input.title,
      author: input.author,
      quote: input.quote,
      nearby: input.context,
      history: input.history.slice(-8).map((item) => ({ role: item.role, text: item.text })),
      user: input.userText,
    }),
  );
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Grok 4.7 没有按约定返回谈话。你的原话还在输入框里。");
  const data = JSON.parse(text.slice(start, end + 1)) as Partial<Round>;
  const author = String(data.author ?? "").trim();
  if (!author) throw new Error("Grok 4.7 没有给出作者的回应。");
  return {
    author,
    rational: String(data.rational ?? "").trim(),
    subjective: String(data.subjective ?? "").trim(),
    companion: String(data.companion ?? "").trim(),
  };
}

export async function askGrok(input: {
  role: Role;
  title: string;
  author: string;
  quote: string;
  context: string;
  userText: string;
  history: Message[];
}): Promise<string> {
  return callGrok(
    instructions[input.role],
    JSON.stringify({
      book: input.title,
      author: input.author,
      quote: input.quote,
      nearby: input.context,
      history: input.history.slice(-8).map((item) => ({ role: item.role, text: item.text })),
      user: input.userText,
    }),
  );
}

async function callGrok(instructionsText: string, input: string): Promise<string> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    throw new Error("Grok 4.7 还没有可用的 XAI_API_KEY。这台电脑现有的其他密钥仍保持原样，不能当作 Grok 的密钥。");
  }
  const response = await fetch(GROK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: GROK_MODEL,
      store: false,
      max_output_tokens: 1200,
      instructions: instructionsText,
      input,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403) throw new Error("Grok 4.7 拒绝了当前的 XAI 密钥或权限。");
    if (response.status === 429) throw new Error("Grok 4.7 请求过多或额度不足。");
    throw new Error(`Grok 4.7 没有完成回复（HTTP ${response.status}）。`);
  }
  const payload: unknown = await response.json();
  const text = extractText(payload);
  if (!text) throw new Error("Grok 4.7 没有返回可读文字。你的原话还在输入框里。");
  return text;
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const envelope = payload as {
    output_text?: string;
    status?: string;
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };
  if (envelope.status && envelope.status !== "completed" && envelope.status !== "incomplete") return "";
  if (envelope.output_text?.trim()) return envelope.output_text.trim();
  return (
    envelope.output
      ?.filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text" || item.type === "text")
      .map((item) => item.text ?? "")
      .join("")
      .trim() ?? ""
  );
}
