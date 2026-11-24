import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import type { PublicMedia, TaskRecord } from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: false });

function load(name: string): ValidateFunction {
  const file = fileURLToPath(new URL(`../../contracts/${name}`, import.meta.url));
  const schema = JSON.parse(readFileSync(file, "utf8")) as object;
  return ajv.compile(schema);
}

const validateMediaSchema = load("media.schema.json");
const validateTaskSchema = load("task.schema.json");

function detail(errors: ErrorObject[] | null | undefined): string {
  return ajv.errorsText(errors ?? [], { separator: "; " });
}

export function assertMedia(value: unknown): asserts value is PublicMedia {
  if (!validateMediaSchema(value)) {
    throw new Error(`素材记录不符合契约：${detail(validateMediaSchema.errors)}`);
  }
}

export function assertTask(value: unknown): asserts value is TaskRecord {
  if (!validateTaskSchema(value)) {
    throw new Error(`任务记录不符合契约：${detail(validateTaskSchema.errors)}`);
  }
}
