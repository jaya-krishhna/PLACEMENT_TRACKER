import {
  type LLMProvider,
  type LLMExtractOptions,
  type LLMResultMeta,
  RateLimitError,
  ServerError,
  SchemaValidationError,
  LLMError,
} from "./types";
import { logger } from "../lib/logger";

function parseRetryAfter(header: string | null): number {
  if (!header) return 60_000;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return Math.max(1000, seconds * 1000);
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(1000, date - Date.now());
  }
  return 60_000;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly modelName: string;
  private readonly apiKey: string;
  lastResultMeta?: LLMResultMeta;

  constructor(opts: { apiKey: string; model: string }) {
    if (!opts.apiKey) {
      throw new Error("GeminiProvider requires an apiKey");
    }
    if (!opts.model) {
      throw new Error("GeminiProvider requires a model name");
    }
    this.apiKey = opts.apiKey;
    this.modelName = opts.model;
  }

  async extract<T>(opts: LLMExtractOptions<T>): Promise<T> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.modelName,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const body = {
      systemInstruction: {
        parts: [{ text: opts.system }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: opts.user }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    };

    const maxRetries = 2;
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startTime = Date.now();
      try {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 35_000);

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));

        const duration = Date.now() - startTime;

        if (res.status === 429) {
          const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
          logger.warn(
            { model: this.modelName, duration, status: 429 },
            "Gemini rate limit encountered",
          );
          throw new RateLimitError("Gemini rate limit exceeded (429)", retryAfterMs);
        }

        if (res.status >= 500) {
          logger.warn(
            { model: this.modelName, duration, status: res.status, attempt },
            "Gemini 5xx server error",
          );
          if (attempt < maxRetries) {
            lastError = new ServerError(`Gemini server error (${res.status})`, res.status);
            continue;
          }
          throw new ServerError(`Gemini server error (${res.status})`, res.status);
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          logger.error(
            { model: this.modelName, duration, status: res.status },
            "Gemini API request failed",
          );
          throw new LLMError(`Gemini API error: ${res.status} ${errText}`, res.status);
        }

        const json = (await res.json()) as any;
        const candidateText =
          json?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!candidateText) {
          throw new SchemaValidationError("Gemini returned empty candidate text");
        }

        let parsedJson: any;
        try {
          parsedJson = JSON.parse(candidateText);
        } catch {
          throw new SchemaValidationError(
            "Gemini response candidate is not valid JSON",
            candidateText,
          );
        }

        const parseResult = opts.schema.safeParse(parsedJson);
        if (!parseResult.success) {
          throw new SchemaValidationError(
            `Zod validation failed: ${parseResult.error.message}`,
            candidateText,
          );
        }

        this.lastResultMeta = {
          provider: this.name,
          model: this.modelName,
        };

        logger.info(
          { model: this.modelName, duration, status: 200 },
          "Gemini extraction succeeded",
        );

        return parseResult.data;
      } catch (err: any) {
        lastError = err;
        if (err instanceof RateLimitError || err instanceof SchemaValidationError) {
          // Do not retry 429 or schema validation inside GeminiProvider; let FallbackProvider handle them
          throw err;
        }
        if (attempt === maxRetries) {
          throw err;
        }
      }
    }

    throw lastError || new LLMError("Gemini extraction failed after retries");
  }
}
