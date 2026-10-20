import {
  type LLMProvider,
  type LLMExtractOptions,
  type LLMResultMeta,
  RateLimitError,
  ServerError,
  SchemaValidationError,
} from "./types";
import { logger } from "../lib/logger";

export class FallbackProvider implements LLMProvider {
  readonly name = "fallback-chain";
  readonly modelName: string;
  readonly primary: LLMProvider;
  readonly fallback: LLMProvider | null;
  lastResultMeta?: LLMResultMeta;

  // In-memory cooldown state per provider
  private readonly cooldowns = new Map<LLMProvider, number>();

  constructor(primary: LLMProvider, fallback?: LLMProvider | null) {
    this.primary = primary;
    this.fallback = fallback || null;
    this.modelName = primary.modelName;
  }

  isCoolingDown(provider: LLMProvider): boolean {
    const until = this.cooldowns.get(provider);
    if (!until) return false;
    if (Date.now() >= until) {
      this.cooldowns.delete(provider);
      return false;
    }
    return true;
  }

  getCooldownRemainingMs(provider: LLMProvider): number {
    const until = this.cooldowns.get(provider);
    if (!until) return 0;
    return Math.max(0, until - Date.now());
  }

  setCooldown(provider: LLMProvider, durationMs: number): void {
    const ms = Math.max(1000, durationMs);
    this.cooldowns.set(provider, Date.now() + ms);
    logger.warn(
      { provider: provider.name, model: provider.modelName, cooldownMs: ms },
      "Set provider cooldown in memory",
    );
  }

  clearCooldowns(): void {
    this.cooldowns.clear();
  }

  async extract<T>(opts: LLMExtractOptions<T>): Promise<T> {
    const primaryCooling = this.isCoolingDown(this.primary);

    // 1. If primary is cooling down, attempt fallback directly
    if (primaryCooling) {
      if (!this.fallback) {
        const remaining = this.getCooldownRemainingMs(this.primary);
        throw new RateLimitError(
          `Primary provider is cooling down (${Math.ceil(remaining / 1000)}s remaining) and no fallback configured`,
          remaining,
        );
      }

      if (this.isCoolingDown(this.fallback)) {
        const pRem = this.getCooldownRemainingMs(this.primary);
        const fRem = this.getCooldownRemainingMs(this.fallback);
        throw new RateLimitError(
          `Both providers are currently cooling down. Primary: ${Math.ceil(pRem / 1000)}s, Fallback: ${Math.ceil(fRem / 1000)}s`,
          Math.min(pRem, fRem),
        );
      }

      logger.info(
        { primary: this.primary.modelName, fallback: this.fallback.modelName },
        "Primary in cooldown; routing directly to fallback",
      );
      return this.executeFallback(opts);
    }

    // 2. Try primary
    let primaryZodFailures = 0;
    while (primaryZodFailures < 2) {
      try {
        const result = await this.primary.extract(opts);
        this.lastResultMeta = this.primary.lastResultMeta || {
          provider: this.primary.name,
          model: this.primary.modelName,
        };
        return result;
      } catch (err: any) {
        if (err instanceof RateLimitError) {
          this.setCooldown(this.primary, err.retryAfterMs);
          if (this.fallback && !this.isCoolingDown(this.fallback)) {
            logger.warn(
              { error: err.message, fallback: this.fallback.modelName },
              "Primary rate limited; failing over to fallback",
            );
            return this.executeFallback(opts);
          }
          throw err;
        }

        if (err instanceof SchemaValidationError) {
          primaryZodFailures++;
          logger.warn(
            { error: err.message, attempt: primaryZodFailures },
            "Primary output failed Zod validation",
          );
          if (primaryZodFailures >= 2) {
            // Escalate after 2 Zod validation failures
            if (this.fallback && !this.isCoolingDown(this.fallback)) {
              logger.warn(
                { fallback: this.fallback.modelName },
                "Primary failed Zod validation twice; escalating to fallback",
              );
              return this.executeFallback(opts);
            }
            throw err;
          }
          // Retry primary once more
          continue;
        }

        // Server errors (5xx), network errors, timeouts
        if (this.fallback && !this.isCoolingDown(this.fallback)) {
          logger.warn(
            { error: err.message, fallback: this.fallback.modelName },
            "Primary failed with server/network error; failing over to fallback",
          );
          return this.executeFallback(opts);
        }

        throw err;
      }
    }

    throw new SchemaValidationError("Primary provider exhausted retries");
  }

  private async executeFallback<T>(opts: LLMExtractOptions<T>): Promise<T> {
    if (!this.fallback) {
      throw new Error("No fallback provider configured");
    }

    try {
      const result = await this.fallback.extract(opts);
      this.lastResultMeta = this.fallback.lastResultMeta || {
        provider: this.fallback.name,
        model: this.fallback.modelName,
      };
      return result;
    } catch (err: any) {
      if (err instanceof RateLimitError) {
        this.setCooldown(this.fallback, err.retryAfterMs);
      }
      logger.error(
        { error: err.message, model: this.fallback.modelName },
        "Fallback provider failed",
      );
      throw err;
    }
  }
}
