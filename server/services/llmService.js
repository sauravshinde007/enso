// server/services/llmService.js
// One JSON-returning completion call across providers. The team leader picks the provider
// and supplies the API key; the env key is only a fallback for local testing.

export const LLM_PROVIDERS = {
  claude: {
    label: "Claude (Anthropic)",
    defaultModel: "claude-opus-5-5",
    envKey: "ANTHROPIC_API_KEY",
    contextChars: 150000,
    maxOutputTokens: 16000,
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o",
    envKey: "OPENAI_API_KEY",
    contextChars: 120000,
    maxOutputTokens: 16000,
  },
  gemini: {
    label: "Gemini (Google)",
    defaultModel: "gemini-2.5-flash",
    envKey: "GEMINI_API_KEY",
    contextChars: 150000,
    maxOutputTokens: 16000,
  },
  // OpenAI-compatible; free tier has small token-per-minute limits, so keep prompts small
  groq: {
    label: "Groq (for testing)",
    defaultModel: "openai/gpt-oss-120b",
    envKey: "GROQ_API_KEY",
    contextChars: 14000,
    maxOutputTokens: 4096,
  },
};

const TIMEOUT_MS = 5 * 60 * 1000;

const ensureOk = async (res, provider) => {
  if (res.ok) return res.json();
  let message = res.statusText;
  try {
    const data = await res.json();
    message = data.error?.message || data.message || JSON.stringify(data).slice(0, 300);
  } catch { /* ignore */ }
  if (res.status === 401 || res.status === 403) message = `Invalid ${provider} API key (${message})`;
  throw new Error(`${provider} API error ${res.status}: ${message}`);
};

const callClaude = async ({ apiKey, model, system, prompt, maxTokens }) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await ensureOk(res, "Claude");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
};

const callOpenAICompatible = async ({ baseUrl, label, apiKey, model, system, prompt, maxTokens }) => {
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await ensureOk(res, label);
  return data.choices?.[0]?.message?.content || "";
};

const callGemini = async ({ apiKey, model, system, prompt, maxTokens }) => {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );
  const data = await ensureOk(res, "Gemini");
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
};

/** Pull the first JSON object out of a model reply (tolerates ```json fences / chatter). */
export const extractJson = (text) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Model did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
};

export const resolveLlmConfig = ({ provider, model, apiKey }) => {
  const config = LLM_PROVIDERS[provider];
  if (!config) throw new Error(`Unknown bot provider "${provider}"`);
  const key = apiKey || process.env[config.envKey];
  if (!key) throw new Error(`No API key set for ${config.label}. The team leader must add one.`);
  return { provider, config, model: model || config.defaultModel, apiKey: key };
};

/**
 * @returns {Promise<object>} parsed JSON reply
 */
export const completeJson = async ({ provider, model, apiKey, system, prompt }) => {
  const resolved = resolveLlmConfig({ provider, model, apiKey });
  const args = {
    apiKey: resolved.apiKey,
    model: resolved.model,
    system,
    prompt,
    maxTokens: resolved.config.maxOutputTokens,
  };

  let text;
  if (provider === "claude") text = await callClaude(args);
  else if (provider === "gemini") text = await callGemini(args);
  else if (provider === "openai") {
    // Newer OpenAI models reject max_tokens, so let the API pick its default limit
    text = await callOpenAICompatible({ ...args, maxTokens: undefined, baseUrl: "https://api.openai.com/v1", label: "OpenAI" });
  } else {
    text = await callOpenAICompatible({ ...args, baseUrl: "https://api.groq.com/openai/v1", label: "Groq" });
  }

  return extractJson(text);
};
