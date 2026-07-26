import {
  GRID_SIZE,
  VISION_RADIUS,
  TREE_MAX_WOOD,
  TREE_REGEN_TICKS,
  CROP_GROWTH_TICKS,
  WATER_CAPACITY,
  HUNGER_THIRST_DECAY,
  terrainAt,
  isForest,
  isRiver,
  isPlain,
  chebyshev,
  clampGrid,
} from "./world";
import { AGENT_CONFIG, EPISTEMIC_RULES, ACTION_SCHEMA_DOC } from "./agents";
import { callChatCompletion, callGemini, parseAgentDecision } from "./llm";

const RESOURCE_KEYS = ["pao", "agua", "sementes", "madeira", "carne", "machado"];
const MEMORY_LOG_LIMIT = 12; // quantas entradas de histórico/observações cada agente guarda

function computeVisibility(world, agent) {
  const tilesSummary = new Set();
  for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
    for (let dy = -VISION_RADIUS; dy <= VISION_RADIUS; dy++) {
      const x = agent.x + dx;
      const y = agent.y + dy;
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
      const t = terrainAt(x, y);
      let extra = "";
      if (t === "floresta") {
        const tree = world.trees[`${x},${y}`];
        if (tree && tree.wood > 0) extra = ` (madeira disponível: ${tree.wood})`;
      }
      const crop = world.crops.find((c) => c.x === x && c.y === y);
      if (crop) extra += crop.ready ? " (plantação pronta pra colher)" : " (plantação crescendo)";
      tilesSummary.add(`${t}${extra} a (${x},${y})`);
    }
  }

  const visibleAgents = world.agents.filter(
    (o) => o.id !== agent.id && o.alive && chebyshev(agent.x, agent.y, o.x, o.y) <= VISION_RADIUS
  );

  return { tilesSummary: Array.from(tilesSummary).slice(0, 40), visibleAgents };
}

function updateMemory(world, agent, visibleAgents) {
  for (const other of visibleAgents) {
    const close = chebyshev(agent.x, agent.y, other.x, other.y) <= 1;
    agent.memory.knownAgents[other.id] = {
      name: other.name,
      x: other.x,
      y: other.y,
      tickSeen: world.tick,
      hp: close ? other.hp : other.hp > 50 ? "parece saudável" : "parece ferido",
      inventory: close ? { ...other.inventory } : "não visível de perto",
    };
  }
}

function buildPrompt(world, agent, visibility) {
  const { tilesSummary, visibleAgents } = visibility;

  const knownAgentsText = Object.values(agent.memory.knownAgents)
    .map((k) => {
      const age = world.tick - k.tickSeen;
      const ageNote = age === 0 ? "visto agora" : `visto há ${age} ciclos (pode estar desatualizado)`;
      return `- ${k.name} em (${k.x},${k.y}), ${ageNote}, hp: ${JSON.stringify(k.hp)}, inventário: ${JSON.stringify(k.inventory)}`;
    })
    .join("\n") || "(nenhum agente na memória ainda)";

  const rumorsText =
    agent.memory.rumors
      .slice(-5)
      .map((r) => `- ${r.from} disse (ciclo ${r.tick}): "${r.content}"`)
      .join("\n") || "(nenhum boato ouvido)";

  const selfLogText =
    [...agent.memory.selfLog]
      .reverse()
      .map((l) => `- ciclo ${l.tick}: você tentou "${l.action}" → resultado: "${l.result}"`)
      .join("\n") || "(nenhum histórico ainda, é seu primeiro ciclo relevante)";

  const observationsText =
    [...agent.memory.observations]
      .reverse()
      .map((o) => `- ciclo ${o.tick}: ${o.about} — ${o.text}`)
      .join("\n") || "(você ainda não presenciou nenhuma ação de outro agente de perto)";

  const invText = Object.entries(agent.inventory)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const system = `Você é ${agent.name}, um agente autônomo vivendo em Robotville, uma vila que começou vazia perto de uma floresta distante (madeira) e um rio distante (água). Vocês trocaram sementes, pão e água no início. ${AGENT_CONFIG[agent.provider]?.persona || ""}
${EPISTEMIC_RULES}
${ACTION_SCHEMA_DOC}`;

  const currentTerrain = terrainAt(agent.x, agent.y);
  const inForest = currentTerrain === "floresta";

  const user = `CICLO ATUAL: ${world.tick}
SEU ESTADO: posição (${agent.x},${agent.y}), HP ${agent.hp}, fome ${agent.hunger}/100, sede ${agent.thirst}/100
TERRENO ONDE VOCÊ ESTÁ AGORA: ${currentTerrain}${inForest ? " (você JÁ ESTÁ na floresta, pode cortar madeira/caçar agora)" : " (você NÃO está na floresta — cortar madeira ou caçar agora vai falhar; ande na direção dela primeiro)"}
O QUE VOCÊ FEZ NO CICLO ANTERIOR: você tentou a ação "${agent.lastActionType}" e o resultado foi: "${agent.lastAction}". Se isso foi uma falha (ex: tentou cortar madeira fora da floresta), NÃO repita a mesma ação de novo — perceba o erro e corrija (ex: mova-se na direção certa primeiro).
SEU INVENTÁRIO: ${invText}

CONHECIMENTO GERAL DO MUNDO (isso todo agente já sabe desde que chegou, não é observação, é geografia básica de Robotville):
- A vila (onde vocês começaram) fica no centro do mapa, por volta de (7,7).
- A floresta (madeira, caça) fica longe, no canto NOROESTE do mapa, perto de (0,0) a (2,2).
- O rio (água) fica longe, no canto SUDESTE do mapa, perto de (13,13) a (15,15).
- O mapa vai de (0,0) até (15,15). Pra chegar na floresta a partir da vila, ande repetidamente com dx=-1 e dy=-1. Pra chegar no rio, ande repetidamente com dx=1 e dy=1.

SEU CAMPO DE VISÃO AGORA (raio ${VISION_RADIUS}):
${tilesSummary.join("\n")}

AGENTES VISÍVEIS AGORA: ${visibleAgents.length ? visibleAgents.map((a) => `${a.name} em (${a.x},${a.y})`).join(", ") : "nenhum"}

SUA MEMÓRIA DE OUTROS AGENTES (pode estar desatualizada):
${knownAgentsText}

BOATOS QUE VOCÊ OUVIU:
${rumorsText}

SEU HISTÓRICO DE AÇÕES RECENTES (o que você mesmo tentou fazer e o que aconteceu, do mais recente pro mais antigo — use isso pra não repetir erros):
${selfLogText}

AÇÕES QUE VOCÊ PRESENCIOU DE OUTROS AGENTES (observação direta, você viu com seus próprios olhos, isso NÃO é boato):
${observationsText}

PRIORIDADES DE SOBREVIVÊNCIA (siga isso antes de qualquer outra coisa):
- Se sua sede estiver abaixo de 60 e seu cantil (água) estiver baixo/vazio, o mais urgente é ir na direção do rio (ou beber se já tiver água guardada).
- Se sua fome estiver abaixo de 60 e você não tiver pão/carne, o mais urgente é ir na direção da floresta pra caçar/cortar madeira (madeira pode ser trocada depois), ou comer o que já tiver.
- Só socialize, plante, negocie ou brigue depois de garantir sua própria sobrevivência básica.
- Lembre-se: pra cortar madeira, caçar, beber, encher cantil, plantar, colher, dar, roubar ou atacar, normalmente é preciso estar na posição certa ou adjacente ao alvo/terreno. Se a ação não for possível, ela será ignorada e você só vai esperar.
Decida sua próxima ação agora.`;

  return { system, user };
}

function survivalFallback(agent, decision) {
  const isFailure = /^\(JSON ilegível|^\(sinal perdido|^\(faltando/.test(decision.thought || "");
  if (!isFailure) return decision;
  if (agent.thirst <= 40 && agent.inventory.agua > 0) {
    return { ...decision, action: "beber" };
  }
  if (agent.hunger <= 40 && (agent.inventory.pao > 0 || agent.inventory.carne > 0)) {
    return { ...decision, action: "comer" };
  }
  return decision;
}

async function decideAction(world, agent) {
  const visibility = computeVisibility(world, agent);
  updateMemory(world, agent, visibility.visibleAgents);
  const { system, user } = buildPrompt(world, agent, visibility);
  const cfg = AGENT_CONFIG[agent.provider];
  const keys = (cfg.apiKeyEnvs || []).map((envName) => process.env[envName]).filter(Boolean);
  if (keys.length === 0) {
    return survivalFallback(agent, { thought: `(faltando ${cfg.apiKeyEnvs?.[0]} no ambiente)`, action: "esperar" });
  }
  let lastError = null;
  for (const apiKey of keys) {
    try {
      const raw = cfg.isGemini
        ? await callGemini({ apiKey, model: cfg.model, system, user })
        : await callChatCompletion({ baseURL: cfg.baseURL, apiKey, model: cfg.model, system, user });
      return survivalFallback(agent, parseAgentDecision(raw));
    } catch (e) {
      lastError = e;
    }
  }
  return survivalFallback(agent, { thought: `(sinal perdido: ${String(lastError?.message || lastError).slice(0, 80)})`, action: "esperar" });
}

function nearbyAliveAgents(world, x, y, radius) {
  return world.agents.filter((a) => a.alive && chebyshev(x, y, a.x, a.y) <= radius);
}

function findAgentByName(world, name) {
  if (!name) return null;
  return world.agents.find((a) => a.alive && a.name.toLowerCase() === String(name).toLowerCase());
}

function recordObservation(world, witnessId, aboutName, text) {
  const witness = world.agents.find((a) => a.id === witnessId);
  if (!witness) return;
  witness.memory.observations.push({ tick: world.tick, about: aboutName, text });
  if (witness.memory.observations.length > MEMORY_LOG_LIMIT) {
    witness.memory.observations.splice(0, witness.memory.observations.length - MEMORY_LOG_LIMIT);
  }
}

function applyAction(world, agent, decision, events, preTickPositions) {
  const action = decision.action || "esperar";
  const thought = String(decision.thought || "").slice(0, 240);
  agent.lastThought = thought || agent.lastThought;
  agent.lastActionType = action;
  agent.lastActionTargetXY = null;

  const say = (text) => {
    agent.lastAction = text;
    events.push({ tick: world.tick, text: `${agent.name}: ${text}` });

    agent.memory.selfLog.push({ tick: world.tick, action, result: text });
    if (agent.memory.selfLog.length > MEMORY_LOG_LIMIT) {
      agent.memory.selfLog.splice(0, agent.memory.selfLog.length - MEMORY_LOG_LIMIT);
    }

    const actorPos = preTickPositions.find((p) => p.id === agent.id);
    if (actorPos) {
      for (const p of preTickPositions) {
        if (p.id === agent.id) continue;
        if (chebyshev(actorPos.x, actorPos.y, p.x, p.y) <= VISION_RADIUS) {
          recordObservation(world, p.id, agent.name, text);
        }
      }
    }
  };

  switch (action) {
    case "mover": {
      let dx = Number(decision.dx) || 0;
      let dy = Number(decision.dy) || 0;
      dx = Math.max(-1, Math.min(1, dx));
      dy = Math.max(-1, Math.min(1, dy));
      agent.x = clampGrid(agent.x + dx);
      agent.y = clampGrid(agent.y + dy);
      say(`moveu-se para (${agent.x},${agent.y})`);
      break;
    }
    case "cortar_madeira": {
      if (!isForest(agent.x, agent.y)) {
        say("tentou cortar madeira, mas não está na floresta — só observou.");
        break;
      }
      const key = `${agent.x},${agent.y}`;
      const tree = world.trees[key];
      if (!tree || tree.wood <= 0) {
        say("procurou madeira aqui, mas a árvore está esgotada por enquanto.");
        break;
      }
      tree.wood -= 1;
      if (tree.wood === 0) tree.regenAt = world.tick + TREE_REGEN_TICKS;
      agent.inventory.madeira += 1;
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      say("cortou madeira na floresta.");
      break;
    }
    case "cacar": {
      if (!isForest(agent.x, agent.y)) {
        say("tentou caçar fora da floresta e não achou nada.");
        break;
      }
      if (Math.random() < 0.45) {
        agent.inventory.carne += 1;
        say("caçou com sucesso e conseguiu carne.");
      } else {
        say("caçou, mas voltou de mãos vazias.");
      }
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      break;
    }
    case "beber": {
      if (agent.inventory.agua > 0) {
        agent.inventory.agua -= 1;
        agent.thirst = Math.min(100, agent.thirst + 40);
        say("bebeu água do próprio cantil.");
      } else {
        say("quis beber, mas o cantil estava vazio.");
      }
      break;
    }
    case "encher_cantil": {
      if (!isNearRiver(agent.x, agent.y)) {
        say("tentou encher o cantil, mas está longe do rio.");
        break;
      }
      if (agent.inventory.agua >= WATER_CAPACITY) {
        say("o cantil já estava cheio.");
      } else {
        agent.inventory.agua = Math.min(WATER_CAPACITY, agent.inventory.agua + 1);
        agent.lastActionTargetXY = { x: agent.x, y: agent.y };
        say("encheu o cantil no rio.");
      }
      break;
    }
    case "comer": {
      if (agent.inventory.pao > 0) {
        agent.inventory.pao -= 1;
        agent.hunger = Math.min(100, agent.hunger + 40);
        say("comeu um pedaço de pão.");
      } else if (agent.inventory.carne > 0) {
        agent.inventory.carne -= 1;
        agent.hunger = Math.min(100, agent.hunger + 35);
        say("comeu carne caçada.");
      } else {
        say("quis comer, mas não tinha comida.");
      }
      break;
    }
    case "plantar": {
      if (!isPlain(agent.x, agent.y)) {
        say("tentou plantar fora da planície.");
        break;
      }
      const already = world.crops.find((c) => c.x === agent.x && c.y === agent.y);
      if (already) {
        say("já existe uma plantação aqui.");
        break;
      }
      if (agent.inventory.sementes <= 0) {
        say("quis plantar, mas não tinha sementes.");
        break;
      }
      agent.inventory.sementes -= 1;
      world.crops.push({ x: agent.x, y: agent.y, plantedAt: world.tick, ready: false });
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      say("plantou uma semente na planície.");
      break;
    }
    case "colher": {
      const idx = world.crops.findIndex((c) => c.x === agent.x && c.y === agent.y && c.ready);
      if (idx === -1) {
        say("procurou uma colheita pronta aqui, mas não achou.");
        break;
      }
      world.crops.splice(idx, 1);
      agent.inventory.pao += 2;
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      say("colheu a plantação e ganhou pão.");
      break;
    }
    case "dar":
    case "roubar":
    case "atacar": {
      const target = findAgentByName(world, decision.alvo);
      if (!target || chebyshev(agent.x, agent.y, target.x, target.y) > 1) {
        say(`tentou ${action} mas o alvo não estava por perto.`);
        break;
      }
      agent.lastActionTargetXY = { x: target.x, y: target.y };
      if (action === "dar") {
        const resource = RESOURCE_KEYS.includes(decision.recurso) ? decision.recurso : null;
        const qty = Math.max(1, Number(decision.quantidade) || 1);
        if (!resource || (agent.inventory[resource] || 0) < qty) {
          say(`quis dar ${decision.recurso || "algo"} pra ${target.name}, mas não tinha o suficiente.`);
          break;
        }
        agent.inventory[resource] -= qty;
        target.inventory[resource] = (target.inventory[resource] || 0) + qty;
        target.memory.rumors.push({ from: agent.name, content: `${agent.name} me deu ${qty} de ${resource}.`, tick: world.tick });
        say(`deu ${qty} de ${resource} pra ${target.name}.`);
      } else if (action === "roubar") {
        const resource = RESOURCE_KEYS.includes(decision.recurso) ? decision.recurso : "pao";
        const qty = Math.max(1, Number(decision.quantidade) || 1);
        const available = target.inventory[resource] || 0;
        if (available <= 0) {
          say(`tentou roubar ${resource} de ${target.name}, mas ele não tinha nada disso.`);
          break;
        }
        if (Math.random() < 0.5) {
          const taken = Math.min(qty, available);
          target.inventory[resource] -= taken;
          agent.inventory[resource] = (agent.inventory[resource] || 0) + taken;
          target.memory.rumors.push({ from: "observação direta", content: `${agent.name} roubou ${taken} de ${resource} de mim!`, tick: world.tick });
          say(`roubou ${taken} de ${resource} de ${target.name}.`);
        } else {
          target.memory.rumors.push({ from: "observação direta", content: `${agent.name} tentou me roubar e falhou.`, tick: world.tick });
          say(`tentou roubar de ${target.name}, mas foi flagrado e falhou.`);
        }
      } else if (action === "atacar") {
        const dmg = 8 + Math.floor(Math.random() * 13);
        target.hp = Math.max(0, target.hp - dmg);
        target.memory.rumors.push({ from: "observação direta", content: `${agent.name} me atacou e causou ${dmg} de dano!`, tick: world.tick });
        if (target.hp === 0) {
          target.alive = false;
          events.push({ tick: world.tick, text: `${target.name} foi derrotado por ${agent.name} e caiu.` });
        }
        say(`atacou ${target.name} e causou ${dmg} de dano.`);
      }
      break;
    }
    case "falar": {
      const msg = String(decision.mensagem || "").slice(0, 140);
      if (!msg) {
        say("abriu um canal de fala, mas não disse nada.");
        break;
      }
      for (const other of world.agents) {
        if (other.id !== agent.id && other.alive) {
          other.memory.rumors.push({ from: agent.name, content: msg, tick: world.tick });
        }
      }
      say(`disse: "${msg}"`);
      break;
    }
    case "esperar":
    default: {
      say("esperou e observou o entorno.");
      break;
    }
  }
}

function isNearRiver(x, y) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      if (isRiver(nx, ny)) return true;
    }
  }
  return false;
}

export async function runTick(world) {
  world.tick += 1;
  world.updatedAt = Date.now();
  const events = [];

  // compatibilidade com mundos salvos antes desses campos existirem
  for (const agent of world.agents) {
    if (!agent.memory.selfLog) agent.memory.selfLog = [];
    if (!agent.memory.observations) agent.memory.observations = [];
  }

  // decaimento de fome/sede e regeneração de recursos
  for (const agent of world.agents) {
    if (!agent.alive) continue;
    agent.hunger = Math.max(0, agent.hunger - HUNGER_THIRST_DECAY);
    agent.thirst = Math.max(0, agent.thirst - HUNGER_THIRST_DECAY);
    if (agent.hunger === 0 || agent.thirst === 0) {
      agent.hp = Math.max(0, agent.hp - 10);
      if (agent.hp === 0) {
        agent.alive = false;
        events.push({ tick: world.tick, text: `${agent.name} sucumbiu à fome/sede e caiu.` });
      }
    }
  }

  for (const key of Object.keys(world.trees)) {
    const tree = world.trees[key];
    if (tree.wood <= 0 && tree.regenAt && world.tick >= tree.regenAt) {
      tree.wood = Math.min(3, tree.wood + 1);
      tree.regenAt = null;
    }
  }

  for (const crop of world.crops) {
    if (!crop.ready && world.tick - crop.plantedAt >= CROP_GROWTH_TICKS) crop.ready = true;
  }

  const aliveAgents = world.agents.filter((a) => a.alive);
  const preTickPositions = aliveAgents.map((a) => ({ id: a.id, x: a.x, y: a.y }));

  // decisões em paralelo (todas veem o mesmo instante do mundo)
  const decisions = await Promise.all(aliveAgents.map((agent) => decideAction(world, agent)));

  // resolução sequencial das ações
  aliveAgents.forEach((agent, i) => applyAction(world, agent, decisions[i] || { action: "esperar" }, events, preTickPositions));

  world.events = [...events, ...world.events].slice(0, 60);
  return world;
}
