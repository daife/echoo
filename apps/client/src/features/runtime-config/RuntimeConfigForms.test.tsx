import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PrimeRuntimeConfigForm,
  PrimeWorldRuntimeConfigForm,
  SliceRuntimeConfigForm,
} from "./RuntimeConfigForms";

describe("runtime config forms", () => {
  it("renders slice settings with a write-only secret field", () => {
    const html = renderToStaticMarkup(
      <SliceRuntimeConfigForm
        value={{
          version: 3,
          replyAutoSegment: false,
          llm: {
            source: "custom",
            baseUrl: "https://openrouter.test/api/v1",
            model: "text-model",
            temperature: 0.8,
            maxTokens: 1200,
            reasoningEnabled: true,
            reasoningEffort: "high",
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
    expect(html).toContain("回复自动分段");
    expect(html).toContain("开启官方思考/推理模式");
    expect(html).toContain("推理强度");
    expect(html).toContain('type="password"');
    expect(html).toContain("留空则保留");
    expect(html).not.toContain("sk-secret-value");
  });

  it("renders independent prime LLM, image, TTS, and message timing fields", () => {
    const endpoint = {
      source: "custom" as const,
      baseUrl: "https://openrouter.test/api/v1",
      model: "model",
      apiKey: { configured: false },
    };
    const html = renderToStaticMarkup(
      <PrimeRuntimeConfigForm
        value={{
          version: 9,
          decisionModel: {
            ...endpoint,
            temperature: 0.4,
            maxTokens: 1600,
            reasoningEnabled: false,
            reasoningEffort: "high",
          },
          outputs: {
            image: {
              enabled: true,
              guidanceLevel: "medium",
              generator: { ...endpoint, model: "image-model" },
              parameters: {},
            },
            voice: {
              enabled: true,
              requestStreaming: false,
              autoPlay: false,
              guidanceLevel: "medium",
              tts: {
                source: "custom",
                apiKey: { configured: false },
                referenceId: "voice",
                model: "fish-model",
                httpUrl: "https://fish.test/tts",
                wsUrl: "wss://fish.test/tts/live",
                latency: "balanced",
                chunkLength: 100,
              },
            },
            sticker: { enabled: false },
            transfer: { enabled: false },
          },
          optimization: {
            image: {
              enabled: false,
              level: "advanced",
              model: {
                ...endpoint,
                temperature: 0.2,
                maxTokens: 2400,
                reasoningEnabled: false,
                reasoningEffort: "high",
              },
            },
            voice: {
              enabled: false,
              level: "advanced",
              model: {
                ...endpoint,
                temperature: 0.2,
                maxTokens: 1600,
                reasoningEnabled: false,
                reasoningEffort: "high",
              },
            },
          },
          understanding: {
            visual: {
              mode: "native",
              model: {
                ...endpoint,
                temperature: 0.1,
                maxTokens: 2400,
                reasoningEnabled: false,
                reasoningEffort: "high",
              },
            },
            audio: {
              mode: "stt",
              model: {
                ...endpoint,
                temperature: 0.1,
                maxTokens: 2400,
                reasoningEnabled: false,
                reasoningEffort: "high",
              },
              stt: {
                source: "custom",
                apiKey: { configured: true, masked: "••••5678" },
                httpUrl: "https://fish.test/v1/asr",
                language: "zh",
              },
            },
          },
          context: { minimumMessages: 150, maximumMessages: 249 },
          typingCharsPerMinute: 300,
          messageCoalesceMs: 2000,
          wakeups: {
            proactive: {
              enabled: false,
              interactionInvalidationWindowMinutes: 10,
            },
            passive: {
              enabled: false,
              milestonesMinutes: [15, 180, 1440],
            },
          },
        }}
        onSave={vi.fn()}
      />,
    );
    expect(html).toContain("图像生成");
    expect(html).toContain("自定义生图参数（JSON）");
    expect(html).toContain("TTS 服务");
    expect(html).toContain("流式语音请求");
    expect(html).toContain("收到语音自动播放");
    expect(html).toContain("媒体理解");
    expect(html).toContain("Fish Audio STT 预先理解");
    expect(html).toContain("语言代码（留空自动检测）");
    expect(html).toContain("https://fish.test/v1/asr");
    expect(html).toContain("连续消息合并间隔（毫秒）");
    expect(html).toContain("允许 figure 发送表情");
    expect(html).toContain("允许 figure 转账、收款或拒收");
    expect(html).toContain('value="2000"');
    expect(html).toContain("允许 figure 主动设置定时唤醒");
    expect(html).toContain("第一次被动唤醒（累计分钟）");
    expect(html).toContain('value="1440"');
  });

  it("keeps the credential source visible but locked on platform-managed forms", () => {
    const html = renderToStaticMarkup(
      <SliceRuntimeConfigForm
        platformOnly
        value={{
          version: 3,
          replyAutoSegment: false,
          llm: {
            source: "custom",
            baseUrl: "https://example.test/v1",
            model: "text-model",
            temperature: 0.8,
            maxTokens: 1200,
            reasoningEnabled: false,
            reasoningEffort: "high",
            apiKey: { configured: false },
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
    expect(html).toContain("费用承担方式");
    expect(html).toContain("disabled");
  });

  it("locks every Prime World credential source on platform-managed forms", () => {
    const model = {
      source: "custom" as const,
      baseUrl: "https://models.example.test/v1",
      model: "openai/gpt-4.1-mini",
      temperature: 0.4,
      maxTokens: 1600,
      reasoningEnabled: false,
      reasoningEffort: "high" as const,
      apiKey: { configured: false },
    };
    const html = renderToStaticMarkup(
      <PrimeWorldRuntimeConfigForm
        platformOnly
        value={{
          version: 2,
          mainModel: model,
          summaryModel: model,
          stt: {
            source: "custom",
            apiKey: { configured: false },
            httpUrl: "https://audio.example.test/asr",
            language: "",
          },
          tts: {
            source: "custom",
            apiKey: { configured: false },
            referenceId: "default",
            model: "s1",
            httpUrl: "https://audio.example.test/tts",
            wsUrl: "wss://audio.example.test/tts/live",
            latency: "balanced",
            chunkLength: 100,
          },
          context: { windowTokens: 32_000, providerReserveTokens: 4_000 },
          audio: { autoPlay: true },
        }}
        onSave={vi.fn()}
      />,
    );
    expect(html).toContain("主 LLM");
    expect(html).toContain("摘要 LLM");
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });
});
