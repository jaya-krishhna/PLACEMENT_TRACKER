import type { ZodType } from "zod";

export interface LLMExtractOptions<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
}

export interface LLMResultMeta {
  provider: string;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly modelName: string;
  extract<T>(opts: LLMExtractOptions<T>): Promise<T>;
  lastResultMeta?: LLMResultMeta;
}

export class LLMError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "LLMError";
  }
}

export class RateLimitError extends LLMError {
  constructor(message: string, public readonly retryAfterMs: number = 60_000) {
    super(message, 429);
    this.name = "RateLimitError";
  }
}

export class ServerError extends LLMError {
  constructor(message: string, status = 500) {
    super(message, status);
    this.name = "ServerError";
  }
}

export class SchemaValidationError extends LLMError {
  constructor(message: string, public readonly rawText?: string) {
    super(message, 422);
    this.name = "SchemaValidationError";
  }
}
