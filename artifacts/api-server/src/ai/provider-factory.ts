import { type LLMProvider } from "./types";
import { GeminiProvider } from "./gemini-provider";
import { FakeProvider } from "./fake-provider";
import { FallbackProvider } from "./fallback-provider";

export interface ProviderFactoryConfig {
  provider?: string;
  primaryModel?: string;
  primaryApiKey?: string;
  fallbackModel?: string;
  fallbackApiKey?: string;
}

export class ProviderFactory {
  private static instance: LLMProvider | null = null;

  static create(config?: ProviderFactoryConfig): LLMProvider {
    const providerType = (
      config?.provider ?? process.env.AI_PROVIDER ?? "gemini"
    ).toLowerCase();

    if (providerType === "fake") {
      return new FakeProvider({
        model: config?.primaryModel ?? process.env.AI_PRIMARY_MODEL ?? "fake-model-v1",
      });
    }

    const primaryModel =
      config?.primaryModel ?? process.env.AI_PRIMARY_MODEL;
    const primaryApiKey =
      config?.primaryApiKey ?? process.env.AI_PRIMARY_API_KEY;

    if (!primaryModel || !primaryModel.trim()) {
      throw new Error(
        "Missing AI primary model. Please configure AI_PRIMARY_MODEL in environment variables.",
      );
    }
    if (!primaryApiKey || !primaryApiKey.trim()) {
      throw new Error(
        "Missing AI primary API key. Please configure AI_PRIMARY_API_KEY in environment variables.",
      );
    }

    const primary = new GeminiProvider({
      model: primaryModel.trim(),
      apiKey: primaryApiKey.trim(),
    });

    const fallbackModel =
      config?.fallbackModel ?? process.env.AI_FALLBACK_MODEL;
    const fallbackApiKey =
      config?.fallbackApiKey ?? process.env.AI_FALLBACK_API_KEY;

    let fallback: LLMProvider | null = null;
    if (
      fallbackModel &&
      fallbackModel.trim() &&
      fallbackApiKey &&
      fallbackApiKey.trim()
    ) {
      fallback = new GeminiProvider({
        model: fallbackModel.trim(),
        apiKey: fallbackApiKey.trim(),
      });
    }

    return new FallbackProvider(primary, fallback);
  }

  static getProvider(): LLMProvider {
    if (!this.instance) {
      this.instance = this.create();
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
  }
}
