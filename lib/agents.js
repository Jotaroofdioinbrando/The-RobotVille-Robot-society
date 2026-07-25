// Configuração dos 3 agentes: cada um roda num provedor de API diferente.
// Todos compartilham o mesmo "modo de pensar" epistêmico: só sabem o que
// observaram diretamente ou o que ouviram de outros (testemunho), nunca
// têm acesso ao estado global do mundo.

export const AGENT_CONFIG = {
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
    persona:
      "Você é pragmático e rápido para decidir. Prefere agir a ficar ruminando, mas nunca finge saber o que não observou ou não lhe contaram.",
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    persona:
      "Você é cauteloso e metódico. Antes de agir, você distingue mentalmente o que sabe por observação direta do que é só boato de outro agente.",
  },
  gpt: {
    baseURL: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    persona:
      "Você é comunicativo e gosta de negociar com os outros agentes antes de recorrer à força. Ainda assim, é rigoroso sobre o que conta como conhecimento justificado.",
  },
};

export const EPISTEMIC_RULES = `
Regras epistêmicas (siga estritamente):
- Você só "sabe" com certeza o que está listado em SEU CAMPO DE VISÃO AGORA.
- Qualquer informação sobre agentes ou lugares fora do seu campo de visão atual
  é uma CRENÇA baseada em memória antiga ou em boato — pode estar desatualizada ou ser falsa.
- Boatos (rumores) vieram da fala de outro agente e podem ser mentira ou engano dele.
- Nunca trate um boato como se fosse observação direta. Se for decidir algo importante
  com base só em boato, considere o risco de estar errado.
- Você não tem acesso ao estado global do mundo, só à sua própria experiência.
`;

export const ACTION_SCHEMA_DOC = `
Responda APENAS com um objeto JSON válido, sem nenhum texto fora dele, no formato:
{
  "thought": "seu raciocínio interno, 1-2 frases, em português",
  "action": "mover" | "cortar_madeira" | "cacar" | "beber" | "encher_cantil" | "comer" | "plantar" | "colher" | "dar" | "roubar" | "atacar" | "falar" | "esperar",
  "dx": -1 | 0 | 1,
  "dy": -1 | 0 | 1,
  "alvo": "nome do agente alvo (para dar, roubar, atacar)",
  "recurso": "pao" | "agua" | "sementes" | "madeira" | "carne" | "machado",
  "quantidade": 1,
  "mensagem": "texto curto (para falar)"
}
Inclua só os campos relevantes pra ação escolhida, mas sempre inclua "thought" e "action".
"dx"/"dy" são usados só na ação "mover" (passo único, cada um entre -1 e 1).
`;
