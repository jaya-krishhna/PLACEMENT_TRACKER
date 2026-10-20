import { describe, it, expect } from "vitest";
import { ProviderFactory } from "../src/ai/provider-factory";
import { FakeProvider } from "../src/ai/fake-provider";
import { FallbackProvider } from "../src/ai/fallback-provider";

describe("ProviderFactory", () => {
  it("selects FakeProvider when provider is 'fake'", () => {
    const provider = ProviderFactory.create({
      provider: "fake",
      primaryModel: "test-model",
    });

    expect(provider).toBeInstanceOf(FakeProvider);
    expect(provider.name).toBe("fake");
  });

  it("fails fast with clear error when primary model is missing for gemini", () => {
    expect(() =>
      ProviderFactory.create({
        provider: "gemini",
        primaryModel: "",
        primaryApiKey: "some-key",
      }),
    ).toThrow("Missing AI primary model");
  });

  it("fails fast with clear error when primary API key is missing for gemini", () => {
    expect(() =>
      ProviderFactory.create({
        provider: "gemini",
        primaryModel: "gemini-3.5-flash-lite",
        primaryApiKey: "",
      }),
    ).toThrow("Missing AI primary API key");
  });

  it("creates FallbackProvider with only primary if fallback credentials are unset", () => {
    const provider = ProviderFactory.create({
      provider: "gemini",
      primaryModel: "gemini-3.5-flash-lite",
      primaryApiKey: "key-123",
      fallbackModel: "",
      fallbackApiKey: "",
    }) as FallbackProvider;

    expect(provider).toBeInstanceOf(FallbackProvider);
    expect(provider.primary).toBeDefined();
    expect(provider.fallback).toBeNull();
  });

  it("creates FallbackProvider with primary and fallback when both provided", () => {
    const provider = ProviderFactory.create({
      provider: "gemini",
      primaryModel: "gemini-3.5-flash-lite",
      primaryApiKey: "key-123",
      fallbackModel: "gemini-3.8-flash",
      fallbackApiKey: "key-fallback",
    }) as FallbackProvider;

    expect(provider).toBeInstanceOf(FallbackProvider);
    expect(provider.primary).toBeDefined();
    expect(provider.fallback).toBeDefined();
    expect(provider.fallback?.modelName).toBe("gemini-3.8-flash");
  });
});
