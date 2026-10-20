import {
  type LLMProvider,
  type LLMExtractOptions,
  type LLMResultMeta,
  RateLimitError,
  ServerError,
  SchemaValidationError,
} from "./types";

export type FakeResponseFn<T = any> = (opts: LLMExtractOptions<T>) => any | Promise<any>;

export class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly modelName: string;
  lastResultMeta?: LLMResultMeta;

  private responseFn?: FakeResponseFn;
  public callCount = 0;

  constructor(opts?: {
    model?: string;
    response?: any | FakeResponseFn;
  }) {
    this.modelName = opts?.model || "fake-model-v1";
    if (typeof opts?.response === "function") {
      this.responseFn = opts.response;
    } else if (opts?.response !== undefined) {
      this.responseFn = () => opts.response;
    }
  }

  setResponse(response: any | FakeResponseFn) {
    if (typeof response === "function") {
      this.responseFn = response;
    } else {
      this.responseFn = () => response;
    }
  }

  async extract<T>(opts: LLMExtractOptions<T>): Promise<T> {
    this.callCount++;

    let raw: any;
    if (this.responseFn) {
      raw = await this.responseFn(opts);
    } else {
      // Default sample job confirmation extraction
      raw = {
        is_job_related: true,
        email_type: "CONFIRMATION",
        company: "Acme Corp",
        role: "Full Stack Engineer",
        suggested_status: "APPLIED",
        stage_detail: "Application received",
        next_at: null,
        next_at_has_time: false,
        next_type: null,
        action_required: false,
        action_note: null,
        rejection_reason: null,
        location: "Remote",
        package_lpa: null,
        job_link: null,
        contact_name: "Jane Recruiter",
        contact_email_or_phone: "jane@acme.com",
        summary: "Your application for Full Stack Engineer has been received.",
        confidence: 0.95,
      };
    }

    if (raw instanceof Error) {
      throw raw;
    }

    // Validate with provided schema
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) {
      throw new SchemaValidationError(
        `FakeProvider Zod validation error: ${parsed.error.message}`,
        JSON.stringify(raw),
      );
    }

    this.lastResultMeta = {
      provider: this.name,
      model: this.modelName,
    };

    return parsed.data;
  }
}
