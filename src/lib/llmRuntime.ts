import type { CloudLlmProvider, LlmSettings } from "./appSettings";

export type ActiveLlmRuntime = {
  mode: "local" | "cloud";
  provider: CloudLlmProvider;
  providerLabel: string;
  model: string;
  sourceTag: string;
  baseUrl: string;
};

export type LlmInvokeRequestFields = {
  connectionMode: "local" | "cloud";
  cloudProvider?: CloudLlmProvider;
  cloudApiSecret?: string;
  protocol: "http" | "https";
  host: string;
  port: number;
  model: string;
  timeoutSeconds: number;
  temperature: number;
  numCtx: number;
  keepAliveMinutes: number;
};

function providerLabel(provider: CloudLlmProvider): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "copilot":
      return "GitHub Models";
    case "blablador":
      return "Blablador";
    case "ollama":
      return "Ollama";
    default:
      return "LLM";
  }
}

function selectedModel(settings: LlmSettings): string {
  return settings.connectionMode === "cloud" ? settings.cloudSelectedModel : settings.ollamaSelectedModel;
}

export function getActiveLlmRuntime(settings: LlmSettings): ActiveLlmRuntime | null {
  if (settings.connectionMode === "cloud") {
    if (!settings.cloudApiSecret.trim() || !settings.cloudSelectedModel.trim()) return null;
    return {
      mode: "cloud",
      provider: settings.cloudProvider,
      providerLabel: providerLabel(settings.cloudProvider),
      model: settings.cloudSelectedModel.trim(),
      sourceTag: settings.cloudProvider,
      baseUrl:
        settings.cloudProvider === "openai"
          ? "https://api.openai.com/v1"
          : settings.cloudProvider === "anthropic"
            ? "https://api.anthropic.com/v1"
            : settings.cloudProvider === "copilot"
              ? "https://models.github.ai/inference"
              : settings.cloudProvider === "blablador"
                ? "https://api.blablador.fz-juelich.de/v1"
                : "https://ollama.com/api",
    };
  }

  if (!settings.ollamaEnabled || !settings.ollamaSelectedModel.trim()) return null;
  return {
    mode: "local",
    provider: "ollama",
    providerLabel: "Ollama",
    model: settings.ollamaSelectedModel.trim(),
    sourceTag: "ollama",
    baseUrl: `${settings.ollamaProtocol}://${settings.ollamaHost}:${settings.ollamaPort}`,
  };
}

export function assertActiveLlmRuntime(settings: LlmSettings, taskLabel: string): ActiveLlmRuntime {
  if (settings.connectionMode === "cloud") {
    if (!settings.cloudApiSecret.trim()) {
      throw new Error(`Enter a cloud API secret in AI Assist Settings before ${taskLabel}.`);
    }
    if (!settings.cloudSelectedModel.trim()) {
      throw new Error(`Choose a cloud model in AI Assist Settings before ${taskLabel}.`);
    }
    return {
      mode: "cloud",
      provider: settings.cloudProvider,
      providerLabel: providerLabel(settings.cloudProvider),
      model: settings.cloudSelectedModel.trim(),
      sourceTag: settings.cloudProvider,
      baseUrl:
        settings.cloudProvider === "openai"
          ? "https://api.openai.com/v1"
          : settings.cloudProvider === "anthropic"
            ? "https://api.anthropic.com/v1"
            : settings.cloudProvider === "copilot"
              ? "https://models.github.ai/inference"
              : settings.cloudProvider === "blablador"
                ? "https://api.blablador.fz-juelich.de/v1"
                : "https://ollama.com/api",
    };
  }

  if (!settings.ollamaEnabled) {
    throw new Error(`Enable a local LLM connection in AI Assist Settings before ${taskLabel}.`);
  }
  if (!settings.ollamaSelectedModel.trim()) {
    throw new Error(`Choose a local model in AI Assist Settings before ${taskLabel}.`);
  }

  return {
    mode: "local",
    provider: "ollama",
    providerLabel: "Ollama",
    model: settings.ollamaSelectedModel.trim(),
    sourceTag: "ollama",
    baseUrl: `${settings.ollamaProtocol}://${settings.ollamaHost}:${settings.ollamaPort}`,
  };
}

export function buildLlmInvokeRequestFields(settings: LlmSettings): LlmInvokeRequestFields {
  const runtime = assertActiveLlmRuntime(settings, "using AI Assist");
  return {
    connectionMode: runtime.mode,
    cloudProvider: runtime.mode === "cloud" ? runtime.provider : undefined,
    cloudApiSecret: runtime.mode === "cloud" ? settings.cloudApiSecret.trim() : undefined,
    protocol: settings.ollamaProtocol,
    host: settings.ollamaHost,
    port: settings.ollamaPort,
    model: runtime.model,
    timeoutSeconds: settings.ollamaRequestTimeoutSeconds,
    temperature: settings.ollamaTemperature,
    numCtx: settings.ollamaNumCtx,
    keepAliveMinutes: settings.ollamaKeepAliveMinutes,
  };
}

export function hasConfiguredActiveLlm(settings: LlmSettings): boolean {
  return Boolean(getActiveLlmRuntime(settings));
}

export function hasSelectedActiveLlmModel(settings: LlmSettings): boolean {
  return Boolean(selectedModel(settings).trim());
}
