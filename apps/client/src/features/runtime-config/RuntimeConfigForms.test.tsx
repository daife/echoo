import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PrimeRuntimeConfigForm,
  SliceRuntimeConfigForm,
} from "./RuntimeConfigForms";

describe("runtime config forms", () => {
  it("renders slice settings with a write-only secret field", () => {
    const html = renderToStaticMarkup(
      <SliceRuntimeConfigForm
        value={{
          version: 1,
          llm: {
            provider: "openrouter",
            baseUrl: "https://openrouter.test/api/v1",
            model: "text-model",
            temperature: 0.8,
            maxTokens: 1200,
            apiKey: { configured: true, masked: "••••1234" },
          },
          context: {
            minimumRounds: 100,
            maximumRounds: 199,
            memorySummaryRounds: 500,
          },
        }}
        onSave={vi.fn()}
      />,
    );
    expect(html).toContain("记忆总结轮数");
    expect(html).toContain('type="password"');
    expect(html).toContain("留空则保留");
    expect(html).not.toContain("sk-secret-value");
  });

  it("renders independent prime LLM, image, TTS, and message timing fields", () => {
    const endpoint = {
      provider: "openrouter",
      baseUrl: "https://openrouter.test/api/v1",
      model: "model",
      apiKey: { configured: false },
    };
    const html = renderToStaticMarkup(
      <PrimeRuntimeConfigForm
        value={{
          version: 2,
          decisionModel: { ...endpoint, temperature: 0.4, maxTokens: 1600 },
          outputs: {
            image: {
              enabled: true,
              guidanceLevel: "medium",
              generator: { ...endpoint, model: "image-model" },
            },
            voice: {
              enabled: true,
              guidanceLevel: "medium",
              tts: {
                provider: "fish-audio",
                apiKey: { configured: false },
                referenceId: "voice",
                model: "fish-model",
                httpUrl: "https://fish.test/tts",
                wsUrl: "wss://fish.test/tts/live",
                latency: "balanced",
                chunkLength: 100,
              },
            },
          },
          optimization: {
            image: {
              enabled: false,
              level: "advanced",
              model: { ...endpoint, temperature: 0.2, maxTokens: 2400 },
            },
            voice: {
              enabled: false,
              level: "advanced",
              model: { ...endpoint, temperature: 0.2, maxTokens: 1600 },
            },
          },
          understanding: {
            visual: {
              mode: "native",
              model: { ...endpoint, temperature: 0.1, maxTokens: 2400 },
            },
            audio: {
              mode: "native",
              model: { ...endpoint, temperature: 0.1, maxTokens: 2400 },
            },
          },
          context: { minimumMessages: 150, maximumMessages: 249 },
          typingCharsPerMinute: 300,
          messageCoalesceMs: 2000,
        }}
        onSave={vi.fn()}
      />,
    );
    expect(html).toContain("图像生成");
    expect(html).toContain("TTS 服务");
    expect(html).toContain("媒体理解");
    expect(html).toContain("连续消息合并间隔（毫秒）");
    expect(html).toContain('value="2000"');
  });
});
