// Cerebras, Groq e OpenAI expõem a mesma forma de API (chat completions
// estilo OpenAI), então dá pra usar um único chamador genérico.

export async function callChatCompletion({ baseURL, apiKey, model, system, user }) {
  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.9,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${model} respondeu HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return content;
}

export function parseAgentDecision(rawContent) {
  const fallback = { thought: "(sinal ilegível, o agente hesitou)", action: "esperar" };
  if (!rawContent) return fallback;
  try {
    return JSON.parse(rawContent);
  } catch (e) {
    const match = rawContent.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        return fallback;
      }
    }
    return fallback;
  }
}
