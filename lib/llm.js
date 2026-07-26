// Cerebras, OpenRouter e OpenAI expõem a mesma forma de API (chat completions
// estilo OpenAI), então dá pra usar um único chamador genérico.

export async function callChatCompletion({ baseURL, apiKey, model, system, user, extraBody }) {
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
      max_tokens: 3000,
      response_format: { type: "json_object" },
      ...(extraBody || {}),
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

export async function callGemini({ apiKey, model, system, user }) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${model} respondeu HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return content;
}

export function parseAgentDecision(rawContent) {
  const snippet = (rawContent || "").replace(/\s+/g, " ").trim().slice(0, 100);
  const fallback = { thought: `(JSON ilegível — recebi: "${snippet || "(vazio)"}")`, action: "esperar" };
  if (!rawContent) return fallback;
  try {
    return JSON.parse(rawContent);
  } catch (e) {
    const cleaned = rawContent.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e3) {
          return fallback;
        }
      }
      return fallback;
    }
  }
}
