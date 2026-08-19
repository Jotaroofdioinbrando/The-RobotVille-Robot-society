import {
  GRID_SIZE,
  VISION_RADIUS,
  TREE_MAX_WOOD,
  TREE_REGEN_TICKS,
  CROP_GROWTH_TICKS,
  WATER_CAPACITY,
  HUNGER_THIRST_DECAY,
  TICKS_PER_DAY,
  STRUCTURE_TYPES,
  isNight,
  FOREST_MAX,
  RIVER_MIN,
  FOREST2_X_MIN,
  FOREST2_Y_MAX,
  RIVER2_Y_MIN,
  RIVER2_Y_MAX,
  VILLAGE_CENTER,
  terrainAt,
  isForest,
  isRiver,
  isPlain,
  chebyshev,
  clampGrid,
  OBJECTIVE_DEFS,
  ROLE_DEFS,
  ANIMAL_TYPES,
  MAX_ANIMALS,
  ANIMAL_SPAWN_CHANCE,
  MEGAFAUNA_TYPES,
  MAX_MEGAFAUNA,
  MEGAFAUNA_SPAWN_CHANCE,
  SIGHTINGS_TO_PREDICT_MOVEMENT,
  TRAP_DURATION_TICKS,
  LANCA_WOOD_COST,
  ARMADILHA_WOOD_COST,
} from "./world";
import { AGENT_CONFIG, EPISTEMIC_RULES, EPISTEMIC_UNCERTAINTY_RULES, SOCIAL_DYNAMICS_RULES, CONCRETE_GOALS_RULES, TIME_AND_MEMORY_RULES, ACTION_SCHEMA_DOC } from "./agents";
import { callChatCompletion, callGemini, parseAgentDecision } from "./llm";

const RESOURCE_KEYS = ["pao", "agua", "sementes", "madeira", "carne", "peixe", "machado", "lanca"];
const MEMORY_LOG_LIMIT = 35; // quantas entradas de histórico/observações cada agente guarda
const LONG_TERM_LIMIT = 35; // quantas notas de longo prazo cada agente guarda
const VOICE_RANGE = { sussurro: 2, fala: 6, grito: Infinity };

function adjustTrust(agent, targetId, delta) {
  if (!agent.memory.trust) agent.memory.trust = {};
  const current = agent.memory.trust[targetId] ?? 50;
  agent.memory.trust[targetId] = Math.max(0, Math.min(100, current + delta));
}

function trustIn(agent, targetId) {
  return agent.memory.trust?.[targetId] ?? 50;
}

function averageTrustAmongAlive(world) {
  const alive = world.agents.filter((a) => a.alive);
  if (alive.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (const a of alive) {
    for (const b of alive) {
      if (a.id === b.id) continue;
      sum += trustIn(a, b.id);
      count++;
    }
  }
  return count ? sum / count : 0;
}

function checkObjective(world, id) {
  const structures = world.structures || [];
  switch (id) {
    case "primeira_casa":
      return structures.some((s) => s.type === "casa");
    case "ponto_de_encontro":
      return structures.some((s) => STRUCTURE_TYPES[s.type]?.gatherBonus || STRUCTURE_TYPES[s.type]?.gathering);
    case "producao_agricola":
      return structures.some((s) => STRUCTURE_TYPES[s.type]?.cropBonus || STRUCTURE_TYPES[s.type]?.cropDivisor);
    case "reserva_para_todos": {
      const alive = world.agents.filter((a) => a.alive);
      return alive.length > 0 && alive.every((a) => (a.inventory.pao || 0) >= 3 && (a.inventory.agua || 0) >= 3);
    }
    case "rede_confianca_forte":
      return averageTrustAmongAlive(world) >= 70;
    case "sobrevivencia_60":
      return world.tick >= 60 && world.agents.every((a) => a.alive);
    default:
      return false;
  }
}

function computeObjectives(world) {
  world.objectivesCompleted = world.objectivesCompleted || {};
  for (const def of OBJECTIVE_DEFS) {
    if (world.objectivesCompleted[def.id]) continue;
    if (checkObjective(world, def.id)) {
      world.objectivesCompleted[def.id] = world.tick;
    }
  }
}

function structuresNear(world, x, y, radius = 1) {
  return (world.structures || []).filter((s) => chebyshev(s.x, s.y, x, y) <= radius);
}

function structureAt(world, x, y) {
  return (world.structures || []).find((s) => s.x === x && s.y === y) || null;
}

function bestNumericBonus(world, x, y, field, radius = 1) {
  const near = structuresNear(world, x, y, radius);
  let best = 0;
  for (const s of near) {
    const val = STRUCTURE_TYPES[s.type]?.[field];
    if (typeof val === "number" && val > best) best = val;
  }
  return best;
}

function bestTheftChance(world, x, y, radius = 1) {
  const near = structuresNear(world, x, y, radius);
  let best = null;
  for (const s of near) {
    const val = STRUCTURE_TYPES[s.type]?.theftChance;
    if (typeof val === "number" && (best === null || val < best)) best = val;
  }
  return best;
}

function hasWaterSourceNear(world, x, y, radius = 1) {
  return structuresNear(world, x, y, radius).some((s) => STRUCTURE_TYPES[s.type]?.waterSource);
}

function hasVoiceBoostNear(world, x, y, radius = 1) {
  return structuresNear(world, x, y, radius).some((s) => STRUCTURE_TYPES[s.type]?.voiceBoost);
}

function animalAt(world, x, y) {
  return (world.animals || []).find((an) => an.x === x && an.y === y) || null;
}

function animalNear(world, x, y, radius = 1) {
  return (world.animals || []).filter((an) => chebyshev(an.x, an.y, x, y) <= radius);
}

function forestTiles() {
  // usado só pra escolher onde nascer um bicho novo — varre as duas florestas
  const tiles = [];
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      if (isForest(x, y)) tiles.push({ x, y });
    }
  }
  return tiles;
}
let cachedForestTiles = null;

function spawnAndMoveAnimals(world, events) {
  world.animals = world.animals || [];
  // move os bichos que já existem: passeiam 1 quadrado aleatório, sempre dentro da floresta
  for (const an of world.animals) {
    const options = [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    const pick = options[Math.floor(Math.random() * options.length)];
    const nx = clampGrid(an.x + pick.dx);
    const ny = clampGrid(an.y + pick.dy);
    if (isForest(nx, ny)) {
      an.x = nx;
      an.y = ny;
    }
  }
  // nasce um bicho novo de vez em quando, se houver vaga
  if (world.animals.length < MAX_ANIMALS && Math.random() < ANIMAL_SPAWN_CHANCE) {
    if (!cachedForestTiles) cachedForestTiles = forestTiles();
    const spot = cachedForestTiles[Math.floor(Math.random() * cachedForestTiles.length)];
    if (spot) {
      const kind = ANIMAL_TYPES[Math.floor(Math.random() * ANIMAL_TYPES.length)];
      world.animals.push({ id: `an${world.tick}-${Math.floor(Math.random() * 10000)}`, kind, x: spot.x, y: spot.y });
    }
  }
}

function megafaunaAt(world, x, y) {
  return (world.megafauna || []).find((m) => m.x === x && m.y === y) || null;
}
function megafaunaNear(world, x, y, radius = 1) {
  return (world.megafauna || []).filter((m) => chebyshev(m.x, m.y, x, y) <= radius);
}
function trapAt(world, x, y) {
  return (world.traps || []).find((t) => t.x === x && t.y === y) || null;
}

function spawnAndMoveMegafauna(world, events) {
  world.megafauna = world.megafauna || [];
  world.traps = world.traps || [];

  for (const m of world.megafauna) {
    m.attackersThisTick = []; // zera a cada ciclo — coordenação só conta dentro do mesmo ciclo
    const isTrapped = m.trappedUntil && world.tick < m.trappedUntil;
    if (isTrapped) continue; // fera presa não se move
    m.trappedUntil = null;

    const options = [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    const pick = options[Math.floor(Math.random() * options.length)];
    const nx = clampGrid(m.x + pick.dx);
    const ny = clampGrid(m.y + pick.dy);
    if (isForest(nx, ny)) {
      m.x = nx;
      m.y = ny;
    }

    // caiu numa armadilha?
    const trap = trapAt(world, m.x, m.y);
    if (trap) {
      world.traps = world.traps.filter((t) => t !== trap);
      if (trap.effective) {
        m.trappedUntil = world.tick + TRAP_DURATION_TICKS;
        events.push({ tick: world.tick, text: `Um(a) ${MEGAFAUNA_TYPES[m.kind]?.label || m.kind} caiu numa armadilha de ${trap.builtBy} em (${m.x},${m.y}) e ficou preso(a) por ${TRAP_DURATION_TICKS} ciclos!` });
      } else {
        events.push({ tick: world.tick, text: `Uma armadilha malfeita de ${trap.builtBy} em (${m.x},${m.y}) não segurou o(a) ${MEGAFAUNA_TYPES[m.kind]?.label || m.kind} — ele escapou.` });
      }
    }
  }

  if (world.megafauna.length < MAX_MEGAFAUNA && Math.random() < MEGAFAUNA_SPAWN_CHANCE) {
    if (!cachedForestTiles) cachedForestTiles = forestTiles();
    const spot = cachedForestTiles[Math.floor(Math.random() * cachedForestTiles.length)];
    const kinds = Object.keys(MEGAFAUNA_TYPES);
    if (spot && kinds.length) {
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const cfg = MEGAFAUNA_TYPES[kind];
      world.megafauna.push({
        id: `mf${world.tick}-${Math.floor(Math.random() * 10000)}`,
        kind,
        x: spot.x,
        y: spot.y,
        hp: cfg.hp,
        maxHp: cfg.hp,
        trappedUntil: null,
        attackersThisTick: [],
      });
      events.push({ tick: world.tick, text: `Um(a) ${cfg.label} foi avistado(a) na floresta perto de (${spot.x},${spot.y}). Vai precisar de observação, arma e provavelmente ajuda pra caçar essa fera.` });
    }
  }
}


  const ns = dy < 0 ? "norte" : dy > 0 ? "sul" : "";
  const ew = dx > 0 ? "leste" : dx < 0 ? "oeste" : "";
  if (!ns && !ew) return "aqui mesmo";
  return [ns, ew].filter(Boolean).join("-");
}

function describeTileExtra(world, x, y, t) {
  let extra = "";
  if (t === "floresta") {
    const tree = world.trees[`${x},${y}`];
    if (tree && tree.wood > 0) extra += ` (madeira disponível: ${tree.wood})`;
  }
  const animal = animalAt(world, x, y);
  if (animal) extra += ` (🐾 tem um ${animal.kind} aqui agora — dá pra "cacar" ele se você chegar perto)`;
  const mf = megafaunaAt(world, x, y);
  if (mf) {
    const label = MEGAFAUNA_TYPES[mf.kind]?.label || mf.kind;
    const trappedNote = mf.trappedUntil ? " (PRESO numa armadilha, vulnerável agora)" : "";
    extra += ` (🐻 FERA GRANDE: ${label}, HP ${mf.hp}/${mf.maxHp}${trappedNote})`;
  }
  const trap = trapAt(world, x, y);
  if (trap) extra += ` (🪤 armadilha de ${trap.builtBy}${trap.effective ? "" : " — mal feita, pode não funcionar"})`;
  const crop = world.crops.find((c) => c.x === x && c.y === y);
  if (crop) extra += crop.ready ? " (plantação pronta pra colher)" : " (plantação crescendo)";
  const structure = (world.structures || []).find((s) => s.x === x && s.y === y);
  if (structure) extra += ` (estrutura: ${structure.type}, construída por ${structure.builtBy})`;
  return extra;
}

function computeVisibility(world, agent) {
  const visionBoost = bestNumericBonus(world, agent.x, agent.y, "visionBoost", 0);
  const radius = VISION_RADIUS + visionBoost;
  const notableTiles = [];
  const terrainCounts = {};
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = agent.x + dx;
      const y = agent.y + dy;
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
      const t = terrainAt(x, y);
      terrainCounts[t] = (terrainCounts[t] || 0) + 1;
      const extra = describeTileExtra(world, x, y, t);
      const isBoring = (t === "planicie" || t === "aldeia") && !extra;
      if (!isBoring) {
        const dist = chebyshev(agent.x, agent.y, x, y);
        const dir = directionLabel(dx, dy);
        notableTiles.push({ dist, text: `${t}${extra} a ${dist} quadrado(s) a ${dir} (${x},${y})` });
      }
    }
  }
  notableTiles.sort((a, b) => a.dist - b.dist);
  const terrainSummary = Object.entries(terrainCounts)
    .map(([t, n]) => `${n} de ${t}`)
    .join(", ");

  const visibleAgents = world.agents.filter(
    (o) => o.id !== agent.id && o.alive && chebyshev(agent.x, agent.y, o.x, o.y) <= radius
  );
  const visibleMegafauna = (world.megafauna || []).filter((m) => chebyshev(agent.x, agent.y, m.x, m.y) <= radius);

  return { notableTiles: notableTiles.slice(0, 100).map((t) => t.text), terrainSummary, radius, visibleAgents, visibleMegafauna };
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

function looksConversational(text, myName) {
  const t = text.toLowerCase();
  if (t.includes("?")) return true;
  if (t.includes(myName.toLowerCase())) return true;
  const greetings = ["olá", "ola", "oi ", "e aí", "eai", "bom dia", "boa tarde", "boa noite", "galera", "pessoal", "gente", "alguém", "alguem"];
  return greetings.some((g) => t.includes(g));
}

function idleWoodNudgeText(world, agent) {
  if (agent.memory.pendingBuild) return null; // já tem o outro aviso cobrindo isso
  const wood = agent.inventory.madeira || 0;
  if (wood < 4) return null;
  const cheapest = Object.entries(STRUCTURE_TYPES).sort((a, b) => a[1].cost - b[1].cost)[0];
  return `🪵 Você está com ${wood} de madeira guardada sem usar. Madeira parada não ajuda ninguém — considere "construir" algo com ela (mesmo a mais barata, "${cheapest[0]}", já custa só ${cheapest[1].cost}). Ver a lista completa de estruturas acima antes de decidir qual faz mais sentido agora.`;
}

// Acha o quadrado de planície/aldeia livre (sem estrutura já em cima) mais
// próximo de (x,y), procurando em anéis crescentes de distância. Usado pra
// dar uma coordenada CONCRETA em vez de só dizer "terreno errado", já que
// os agentes historicamente ficam repetindo a mesma tentativa errada.
function findNearbyBuildableTile(world, x, y, maxRadius = 6) {
  const occupied = new Set((world.structures || []).map((s) => `${s.x},${s.y}`));
  for (let r = 0; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // só o anel externo desse raio
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
        const t = terrainAt(nx, ny);
        if ((t === "planicie" || t === "aldeia") && !occupied.has(`${nx},${ny}`)) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return null;
}

function pendingBuildText(world, agent) {
  const pb = agent.memory.pendingBuild;
  if (!pb) return null;
  if (world.tick - pb.tick > 15) return null; // considerado abandonado, não insiste mais
  const cfg = STRUCTURE_TYPES[pb.estrutura];
  if (!cfg) return null;
  const spot = findNearbyBuildableTile(world, agent.x, agent.y);
  const spotText = spot ? ` O quadrado livre mais próximo pra isso é (${spot.x},${spot.y}).` : "";
  return `🏗️ Você tentou construir "${pb.estrutura}" no ciclo ${pb.tick} e não conseguiu (terreno errado, madeira insuficiente, ou já tinha estrutura no quadrado) — ainda não terminou isso. Se ainda fizer sentido, mova-se pra um quadrado de planície/aldeia livre e próximo (junte mais madeira se precisar, este custa ${cfg.cost}) e tente "construir" de novo com "estrutura": "${pb.estrutura}".${spotText} Se mudou de ideia, pode ignorar — mas decida isso conscientemente, não só esqueça.`;
}

function pendingReplyText(agent) {
  const since = agent.lastSpokeTick ?? -1;
  const candidates = agent.memory.rumors
    .filter((r) => r.from !== agent.name && r.from !== "observação direta" && r.tick > since)
    .filter((r) => looksConversational(r.content, agent.name));
  if (!candidates.length) return null;
  const r = candidates[candidates.length - 1];
  return `💬 ${r.from} disse (ciclo ${r.tick}, ainda sem resposta sua): "${r.content}" — considere responder a ${r.from} pelo nome, usando o campo "mensagem" nesta ação (não precisa ser a ação "falar", pode responder enquanto faz outra coisa).`;
}

function tribeProgressText(world) {
  const structures = world.structures || [];
  const parts = [];
  if (!structures.length) {
    parts.push("Nada foi construído ainda na tribo.");
  } else {
    const counts = {};
    for (const s of structures) counts[s.type] = (counts[s.type] || 0) + 1;
    const list = Object.entries(counts)
      .map(([type, n]) => `${n}x ${type}`)
      .join(", ");
    parts.push(`Construído até agora: ${list}.`);
  }
  const deadCount = world.agents.filter((a) => !a.alive).length;
  if (deadCount) parts.push(`${deadCount} agente(s) já morreram.`);
  const completed = world.objectivesCompleted || {};
  const doneLabels = OBJECTIVE_DEFS.filter((d) => completed[d.id]).map((d) => d.label);
  if (doneLabels.length) parts.push(`Metas coletivas já alcançadas: ${doneLabels.join("; ")}.`);
  return parts.join(" ");
}

function globalAgentPositionsText(world, agent) {
  const others = world.agents.filter((a) => a.id !== agent.id && a.alive);
  if (!others.length) return "(nenhum outro agente vivo na tribo no momento)";
  return others
    .map((o) => {
      const dist = chebyshev(agent.x, agent.y, o.x, o.y);
      const dir = directionLabel(o.x - agent.x, o.y - agent.y);
      return `- ${o.name}: em (${o.x},${o.y}), a ${dist} quadrado(s) de distância a ${dir} de você.`;
    })
    .join("\n");
}

function buildPrompt(world, agent, visibility) {
  const { notableTiles, terrainSummary, radius, visibleAgents } = visibility;

  const knownAgentsText = Object.entries(agent.memory.knownAgents)
    .map(([id, k]) => {
      if (k.dead) return `- ${k.name}: MORREU no ciclo ${k.tickSeen}. Não tente mais falar, dar, roubar, trocar ou confraternizar com ${k.name}.`;
      const age = world.tick - k.tickSeen;
      const ageNote = age === 0 ? "visto agora" : `visto há ${age} ciclos (pode estar desatualizado)`;
      const trust = trustIn(agent, id);
      const trustNote = trust < 30 ? " ⚠️ baixa, cuidado" : trust >= 80 ? " (amigo)" : trust >= 70 ? " (alta, confiável)" : "";
      return `- ${k.name} em (${k.x},${k.y}), ${ageNote}, hp: ${JSON.stringify(k.hp)}, inventário: ${JSON.stringify(k.inventory)}, confiança: ${trust}/100${trustNote}`;
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

  const longTermText =
    (agent.memory.longTerm || [])
      .slice(-8)
      .reverse()
      .map((n) => `- (ciclo ${n.tick}) ${n.text}`)
      .join("\n") || "(nenhuma nota de longo prazo ainda)";

  const planText = agent.memory.currentPlan
    ? `"${agent.memory.currentPlan.text}" (definido no ciclo ${agent.memory.currentPlan.tick})`
    : "(nenhum plano definido ainda — considere definir um usando o campo \"plano\")";

  const pendingReply = pendingReplyText(agent);
  const pendingBuild = pendingBuildText(world, agent);
  const idleWoodNudge = idleWoodNudgeText(world, agent);

  const invText = Object.entries(agent.inventory)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const system = `Você é ${agent.name}, um agente autônomo vivendo em Robotville, uma vila que começou vazia perto de uma floresta distante (madeira) e um rio distante (água). Vocês trocaram sementes, pão e água no início. {{PERSONA}}
${EPISTEMIC_RULES}
${EPISTEMIC_UNCERTAINTY_RULES}
${SOCIAL_DYNAMICS_RULES}
${CONCRETE_GOALS_RULES}
${TIME_AND_MEMORY_RULES}
${ACTION_SCHEMA_DOC}`;

  const currentTerrain = terrainAt(agent.x, agent.y);
  const inForest = currentTerrain === "floresta";

  const nearbyWithSupplies = visibleAgents.filter((o) => {
    const known = agent.memory.knownAgents[o.id];
    const inv = known && known.inventory !== "não visível de perto" ? known.inventory : null;
    return inv && ((inv.pao || 0) > 0 || (inv.agua || 0) > 0 || (inv.carne || 0) > 0 || (inv.peixe || 0) > 0);
  });

  const alerts = [];
  const hasWaterStock = agent.inventory.agua > 0;
  const hasFoodStock = agent.inventory.pao > 0 || agent.inventory.carne > 0 || agent.inventory.peixe > 0;
  const bothCriticalNoStock = agent.thirst <= 40 && agent.hunger <= 40 && !hasWaterStock && !hasFoodStock;

  if (bothCriticalNoStock) {
    alerts.push(
      `🚨 SEDE E FOME CRÍTICAS AO MESMO TEMPO (sede ${agent.thirst}/100, fome ${agent.hunger}/100) e você não tem nada guardado. Olhe pro seu problema como um TODO, não separado: o RIO resolve as duas coisas na mesma viagem (dá pra beber E pescar lá, já que o rio serve de lago). Vá em direção ao rio AGORA (dx=1, dy=1) — ao chegar, encha o cantil, beba, e pesque (action "pescar") antes de considerar ir pra floresta. Não fique alternando indeciso entre floresta e rio.`
    );
  } else {
    if (agent.thirst <= 40) {
      if (hasWaterStock) {
        alerts.push(
          `🚨 HIDRATAÇÃO CRÍTICA (sede ${agent.thirst}/100, ou seja, você está quase sem água no corpo) — você TEM ${agent.inventory.agua} água guardada. BEBA AGORA (action: "beber"), antes de qualquer outra coisa. Pode gritar por ajuda ao mesmo tempo se quiser, usando "mensagem".`
        );
      } else if (nearbyWithSupplies.length) {
        alerts.push(
          `🚨 HIDRATAÇÃO CRÍTICA (sede ${agent.thirst}/100) e você NÃO tem água guardada. Vá em direção ao rio (dx=1, dy=1), ou, se está muito longe pra chegar a tempo, considere roubar água de alguém próximo com estoque (ex: ${nearbyWithSupplies.map((a) => a.name).join(", ")}) — arriscado e custa confiança, mas é sobrevivência.`
        );
      } else {
        alerts.push(
          `🚨 HIDRATAÇÃO CRÍTICA (sede ${agent.thirst}/100) e você NÃO tem água guardada — pare tudo e vá em direção ao rio AGORA (dx=1, dy=1).`
        );
      }
    }
    if (agent.hunger <= 40) {
      if (hasFoodStock) {
        alerts.push(
          `🚨 FOME CRÍTICA (fome ${agent.hunger}/100, ou seja, você está quase sem energia) — você TEM comida guardada (pão: ${agent.inventory.pao}, carne: ${agent.inventory.carne}, peixe: ${agent.inventory.peixe}). COMA AGORA (action: "comer"), antes de qualquer outra coisa. Pode gritar por ajuda ao mesmo tempo se quiser, usando "mensagem".`
        );
      } else if (nearbyWithSupplies.length) {
        alerts.push(
          `🚨 FOME CRÍTICA (fome ${agent.hunger}/100) e você NÃO tem comida guardada. IMPORTANTE: cortar madeira NÃO resolve fome (madeira não é comida) — vá em direção à floresta (dx=-1, dy=-1) e use "cacar" assim que chegar, que dá carne pra comer na hora; ou, se não der tempo, considere roubar comida de alguém próximo com estoque (ex: ${nearbyWithSupplies.map((a) => a.name).join(", ")}) — arriscado e custa confiança, mas é sobrevivência.`
        );
      } else {
        alerts.push(
          `🚨 FOME CRÍTICA (fome ${agent.hunger}/100) e você NÃO tem comida guardada. IMPORTANTE: cortar madeira NÃO resolve fome (madeira não é comida) — pare tudo e vá em direção à floresta AGORA (dx=-1, dy=-1) e use "cacar" assim que chegar, que dá carne pra comer imediatamente. Se tiver uma plantação pronta por perto, "colher" também resolve na hora.`
        );
      }
    }
  }
  const alertsText = alerts.length ? alerts.join("\n") : null;

  const user = `CICLO ATUAL: ${world.tick}
PERÍODO DO DIA: ${isNight(world.tick) ? "NOITE 🌙 (bom momento pra tribo se reunir, comer/beber/conversar perto de uma fogueira ou na aldeia)" : "DIA ☀️"} (ciclo ${world.tick % TICKS_PER_DAY} de ${TICKS_PER_DAY} do dia atual)
SEU ESTADO: posição (${agent.x},${agent.y}), HP ${agent.hp}, saciedade (fome) ${agent.hunger}/100 [100 = totalmente alimentado, 0 = morrendo de fome — quanto MAIOR o número, MELHOR], hidratação (sede) ${agent.thirst}/100 [100 = totalmente hidratado, 0 = morrendo de sede — quanto MAIOR o número, MELHOR]
${alertsText ? `ALERTA DE SOBREVIVÊNCIA (isso já foi calculado pra você, não precisa comparar números, é fato):\n${alertsText}\n` : ""}TERRENO ONDE VOCÊ ESTÁ AGORA: ${currentTerrain}${inForest ? " (você JÁ ESTÁ na floresta, pode cortar madeira/caçar agora)" : " (você NÃO está na floresta — cortar madeira ou caçar agora vai falhar; ande na direção dela primeiro)"}
O QUE VOCÊ FEZ NO CICLO ANTERIOR: você tentou a ação "${agent.lastActionType}" e o resultado foi: "${agent.lastAction}". Se isso foi uma falha (ex: tentou cortar madeira fora da floresta), NÃO repita a mesma ação de novo — perceba o erro e corrija (ex: mova-se na direção certa primeiro).
SEU INVENTÁRIO: ${invText}

CONHECIMENTO GERAL DO MUNDO (isso todo agente já sabe desde que chegou, não é observação, é geografia básica de Robotville):
- A vila (onde vocês começaram) fica no centro do mapa, por volta de (${VILLAGE_CENTER},${VILLAGE_CENTER}).
- Existem DUAS florestas (madeira, caça) e DOIS rios (água, também servem de lago pra pescar):
  - Floresta 1 + rio 1: longe um do outro, cada um numa ponta do mapa — floresta 1 no canto
    NOROESTE, perto de (0,0) a (${FOREST_MAX},${FOREST_MAX}); rio 1 no canto SUDESTE, perto de
    (${RIVER_MIN},${RIVER_MIN}) a (${GRID_SIZE - 1},${GRID_SIZE - 1}).
  - Floresta 2 + rio 2: no canto NORDESTE do mapa, coladinhos um no outro (viagem rápida entre
    os dois) — floresta 2 perto de (${FOREST2_X_MIN},0) a (${GRID_SIZE - 1},${FOREST2_Y_MAX}); rio 2
    logo abaixo dela, perto de (${FOREST2_X_MIN},${RIVER2_Y_MIN}) a (${GRID_SIZE - 1},${RIVER2_Y_MAX}).
  - Pra resolver fome E sede numa viagem só e rápida, o par floresta2+rio2 costuma ser mais prático
    que o par 1, já que ficam quase colados. Escolha o par mais perto de onde você está agora.
- O mapa vai de (0,0) até (${GRID_SIZE - 1},${GRID_SIZE - 1}).
- De vez em quando aparece um bicho selvagem (coelho, veado ou javali) andando pela floresta — ele
  se move sozinho, então pode não estar mais onde você viu da última vez. Se você tiver um no seu
  campo de visão, "cacar" perto dele (raio 1) tem chance bem maior de sucesso do que caçar às cegas;
  se ele estiver longe mas a fome for urgente, "correr" até perto dele antes de "cacar" pode valer a
  pena (lembre-se do custo de HP do "correr").
- Você pode construir (action "construir", campo "estrutura") uma destas opções:
${Object.entries(STRUCTURE_TYPES)
  .map(([name, cfg]) => `  - "${name}" (${cfg.cost} madeira): ${cfg.desc}`)
  .join("\n")}

ESTRUTURAS QUE A TRIBO JÁ CONSTRUIU (isso é conhecimento geral, você sabe disso mesmo sem estar perto —
é a mesma lógica de saber onde fica o rio e a floresta; NÃO precisa ver de novo pra saber que já existe):
${
  (world.structures || []).length
    ? world.structures.map((s) => `- ${s.type} em (${s.x},${s.y}), construído por ${s.builtBy} no ciclo ${s.builtAt}`).join("\n")
    : "(a tribo ainda não construiu nada)"
}
Antes de decidir construir algo, CONFIRA essa lista — se já existe uma "casa" ou "abrigo" que serve
pro propósito que você quer, prefira usar/ir até o que já existe em vez de gastar madeira construindo
outro igual. Só vale duplicar se o existente estiver longe demais pra ser prático, ou se fizer sentido
ter mais de um (ex: mais de uma fogueira em pontos diferentes).

SEU PLANO ATUAL: ${planText}
${pendingBuild ? `\n${pendingBuild}\n` : ""}${idleWoodNudge ? `\n${idleWoodNudge}\n` : ""}
PROGRESSO DA TRIBO: ${tribeProgressText(world)}

SUAS NOTAS DE LONGO PRAZO (coisas que você mesmo decidiu guardar pra lembrar depois):
${longTermText}

SEU CAMPO DE VISÃO AGORA (observação direta, 100% confiável — raio efetivo ${radius}${radius > VISION_RADIUS ? ` = ${VISION_RADIUS} base + ${radius - VISION_RADIUS} de bônus de estrutura` : ""}):
Composição geral do que está ao redor: ${terrainSummary || "nada"}.
Pontos de interesse específicos (tudo que não é planície/aldeia comum, do mais perto pro mais longe):
${notableTiles.length ? notableTiles.join("\n") : "(nenhum ponto de interesse além da planície/aldeia comum ao redor)"}

AGENTES VISÍVEIS AGORA (observação direta): ${
    visibleAgents.length
      ? visibleAgents
          .map((a) => {
            const dist = chebyshev(agent.x, agent.y, a.x, a.y);
            const dir = directionLabel(a.x - agent.x, a.y - agent.y);
            return `${a.name} a ${dist} quadrado(s) a ${dir} (${a.x},${a.y}), fazendo: "${a.lastAction || "?"}"`;
          })
          .join("; ")
      : "nenhum"
  }

FERAS GRANDES VISÍVEIS AGORA (caça de verdade, difícil — veja as regras de caça grande abaixo): ${
    visibility.visibleMegafauna && visibility.visibleMegafauna.length
      ? visibility.visibleMegafauna
          .map((m) => {
            const label = MEGAFAUNA_TYPES[m.kind]?.label || m.kind;
            const dist = chebyshev(agent.x, agent.y, m.x, m.y);
            const dir = directionLabel(m.x - agent.x, m.y - agent.y);
            const sightings = (agent.memory.megafaunaSightings || {})[m.id] || 0;
            const learned = sightings >= SIGHTINGS_TO_PREDICT_MOVEMENT;
            const trapped = m.trappedUntil ? " — PRESA numa armadilha agora, vulnerável" : "";
            return `${label} (id: ${m.id}) a ${dist} quadrado(s) a ${dir} (${m.x},${m.y}), HP ${m.hp}/${m.maxHp}${trapped}. Você já observou essa fera ${sightings}x (precisa de ${SIGHTINGS_TO_PREDICT_MOVEMENT} pra "aprender o padrão dela"${learned ? " — VOCÊ JÁ SABE, suas armadilhas contra ela vão funcionar de verdade" : ""}).`;
          })
          .join(" | ")
      : "nenhuma"
  }

RADAR DE POSIÇÃO DA TRIBO (você sempre sabe onde os outros agentes vivos estão e a que distância,
em qualquer lugar do mapa — isso não depende do seu campo de visão. Mas isso NÃO significa que você
vê os detalhes deles como HP/inventário de longe (só quando estiverem por perto), nem que eles
conseguem ouvir você de qualquer distância):
${globalAgentPositionsText(world, agent)}
Alcance de comunicação por "tom": "sussurro" só até 2 quadrados; "fala" (padrão) até 6 quadrados;
"grito" alcança o mapa inteiro, não importa a distância — mas não é privado, todo mundo ouve.

SUA MEMÓRIA DE OUTROS AGENTES (pode estar desatualizada):
${knownAgentsText}

BOATOS QUE VOCÊ OUVIU:
${rumorsText}
${pendingReply ? `\n${pendingReply}\n` : ""}

SEU HISTÓRICO DE AÇÕES RECENTES (o que você mesmo tentou fazer e o que aconteceu, do mais recente pro mais antigo — use isso pra não repetir erros):
${selfLogText}

AÇÕES QUE VOCÊ PRESENCIOU DE OUTROS AGENTES (observação direta, você viu com seus próprios olhos, isso NÃO é boato):
${observationsText}

PRIORIDADES DE SOBREVIVÊNCIA (siga isso antes de qualquer outra coisa):
- Todo ciclo você tem, além da sua "action" principal, DUAS "ações grátis" que não custam nada e
  podem ser usadas JUNTO da principal: "mover" (deslocar-se até 3 quadrados) e "mensagem" (dizer
  algo). Tente preencher as duas na maioria dos ciclos, não só quando for conveniente — um ciclo
  parado sem se mover E sem falar nada é raramente a melhor escolha.
- Se houver ALERTA DE SOBREVIVÊNCIA acima, siga a instrução dele imediatamente.
- Só "comer" recupera fome (usando pão/carne/peixe do inventário) e só "beber" recupera sede
  (usando água do cantil) — nenhuma outra ação faz isso diretamente. "cortar_madeira" dá madeira
  (serve pra construir), não comida. "cacar"/"pescar"/"colher" dão comida (carne/peixe/pão) pro
  seu inventário, mas você ainda precisa fazer "comer" depois pra realmente recuperar fome.
- Só socialize, plante, construa, negocie ou brigue depois de garantir sua própria sobrevivência básica.
- CONVERSA É RECIPROCIDADE: se há um "💬" acima (mensagem recente ainda sem resposta sua), responda a essa pessoa
  pelo nome na sua próxima "mensagem", MESMO que você também esteja fazendo outra ação ao mesmo tempo (o campo
  "mensagem" funciona junto de qualquer "action" — não custa nada ignorar por preguiça, mas ignorar sistematicamente
  os outros agentes destrói a coesão da tribo). Você só pode pular isso se estiver em alerta crítico de sobrevivência
  agora mesmo.
- TERMINE O QUE COMEÇOU: se há um "🏗️" acima (construção que você tentou e falhou), isso é uma intenção sua ainda
  em aberto — não é natural simplesmente esquecer e ir fazer outra coisa sem nenhum motivo. Ou resolva o obstáculo
  (mova-se pro terreno certo, junte mais madeira) e tente de novo, ou decida CONSCIENTEMENTE abandonar (e nesse
  caso, considere dizer isso numa "mensagem" ou registrar numa "nota" o motivo, em vez de só sumir com o assunto).
- Se for NOITE e sua sobrevivência básica já estiver garantida, PARE o trabalho normal (cortar madeira,
  caçar, pescar, construir) e vá em direção à aldeia (por volta de (${VILLAGE_CENTER},${VILLAGE_CENTER}))
  ou uma fogueira conhecida — MESMO que você não veja nenhum outro agente lá agora (eles podem estar a
  caminho também). Ao chegar, use "confraternizar" ou "falar"/"grito" pra avisar e chamar os outros. A
  noite é pra descansar e se reunir como tribo, não pra continuar trabalhando sozinho na floresta.
- Pense na sua sobrevivência como um conjunto, não em fome e sede separadas: o RIO serve pra beber
  E pescar na mesma parada, então se as duas estão ficando baixas (mesmo antes de qualquer alerta
  crítico), planeje uma única viagem ao rio que resolve as duas, em vez de ficar preso só na floresta
  cortando madeira enquanto a sede cai em silêncio.
- Se for DIA e sua sobrevivência básica já estiver garantida (fome e sede acima de 40, sem alerta), NÃO fique só esperando ou só conversando — continue contribuindo pra tribo: corte mais madeira, cace, pesque, plante, construa mais estruturas, explore terreno novo, ou ajude outro agente que esteja precisando (dar recurso, checar como ele está). "esperar" repetidamente sem um motivo real (perigo, conversa em andamento, ação bloqueada) é preguiça, não sobrevivência — evite.
- Lembre-se: pra cortar madeira, caçar, pescar, beber, encher cantil, plantar, colher, construir, dar, roubar, atacar ou confraternizar, normalmente é preciso estar na posição certa ou adjacente ao alvo/terreno. Se a ação não for possível, ela será ignorada e você só vai esperar.
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
  for (const m of visibility.visibleMegafauna || []) {
    agent.memory.megafaunaSightings = agent.memory.megafaunaSightings || {};
    agent.memory.megafaunaSightings[m.id] = (agent.memory.megafaunaSightings[m.id] || 0) + 1;
  }
  const { system: systemTemplate, user } = buildPrompt(world, agent, visibility);
  const cfg = AGENT_CONFIG[agent.provider];
  const minds = cfg.minds || [cfg];

  // Lista achatada de tentativas: pra cada mente do corpo, cada chave de API dela.
  // Tenta a mente principal (todas as chaves dela) antes de "trocar de consciência"
  // pra próxima mente da lista.
  const attempts = [];
  for (const mind of minds) {
    const keys = (mind.apiKeyEnvs || []).map((envName) => process.env[envName]).filter(Boolean);
    for (const apiKey of keys) attempts.push({ mind, apiKey });
  }

  if (attempts.length === 0) {
    return survivalFallback(agent, { thought: `(faltando chave de API configurada pra ${agent.name})`, action: "esperar" });
  }

  let lastError = null;
  let hitRateLimit = false;
  for (let i = 0; i < attempts.length; i++) {
    const { mind, apiKey } = attempts[i];
    const system = systemTemplate.replace("{{PERSONA}}", mind.persona || "");
    try {
      const raw = mind.isGemini
        ? await callGemini({ apiKey, model: mind.model, system, user })
        : await callChatCompletion({ baseURL: mind.baseURL, apiKey, model: mind.model, system, user, extraBody: mind.extraBody });
      agent.activeMind = mind.id;
      agent.activeMindVibe = mind.vibe || null;
      const decision = parseAgentDecision(raw);
      if (minds.length > 1 && mind.id !== minds[0].id) {
        decision.thought = `(mente ${mind.vibe || mind.id} assumiu o controle) ${decision.thought || ""}`.trim();
      }
      return survivalFallback(agent, decision);
    } catch (e) {
      lastError = e;
      if (e?.status === 429) {
        hitRateLimit = true;
        if (i < attempts.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  const reason = hitRateLimit
    ? `limite de requisições (429) em todas as ${attempts.length} tentativa(s) configuradas`
    : String(lastError?.message || lastError).slice(0, 80);
  return survivalFallback(agent, { thought: `(sinal perdido: ${reason})`, action: "esperar" });
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

function broadcastMessage(world, agent, content, tom) {
  const volume = VOICE_RANGE[tom] ? tom : "fala";
  const boosted = hasVoiceBoostNear(world, agent.x, agent.y);
  const range = VOICE_RANGE[volume] * (boosted ? 2 : 1);
  const verb = volume === "sussurro" ? "sussurrou" : volume === "grito" ? "gritou" : "disse";
  for (const other of world.agents) {
    if (other.id === agent.id || !other.alive) continue;
    if (chebyshev(agent.x, agent.y, other.x, other.y) <= range) {
      other.memory.rumors.push({ from: agent.name, content, tick: world.tick, tom: volume });
    }
  }
  return verb;
}

const VALID_ACTIONS = new Set([
  "mover", "correr", "cortar_madeira", "cacar", "pescar", "beber", "encher_cantil",
  "comer", "plantar", "colher", "construir", "dar", "roubar", "atacar", "falar",
  "confraternizar", "esperar", "criar_lanca", "montar_armadilha", "atacar_fera",
]);

function normalizeAction(raw) {
  if (!raw) return "esperar";
  return String(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function killAgent(world, deadAgent, causeText, events) {
  deadAgent.alive = false;
  deadAgent.diedAtTick = world.tick;
  for (const other of world.agents) {
    if (other.id === deadAgent.id || !other.alive) continue;
    other.memory.rumors.push({
      from: "observação direta",
      content: `${deadAgent.name} morreu (${causeText}). Não adianta mais tentar falar, dar ou trocar recursos com ${deadAgent.name}.`,
      tick: world.tick,
    });
    if (other.memory.knownAgents[deadAgent.id]) {
      other.memory.knownAgents[deadAgent.id].dead = true;
      other.memory.knownAgents[deadAgent.id].tickSeen = world.tick;
    } else {
      other.memory.knownAgents[deadAgent.id] = { name: deadAgent.name, dead: true, tickSeen: world.tick };
    }
  }
  events.push({ tick: world.tick, text: `${deadAgent.name} morreu (${causeText}).` });
}

function applyAction(world, agent, decision, events, preTickPositions) {
  const rawActionInput = decision.action;
  const normalizedAction = normalizeAction(rawActionInput);
  const actionWasUnknown = !!rawActionInput && !VALID_ACTIONS.has(normalizedAction);
  const action = actionWasUnknown ? "esperar" : normalizedAction;
  const thought = String(decision.thought || "").slice(0, 240);
  const uncertaintyNote = String(decision.incerteza || "").slice(0, 160);
  const hypotheses = Array.isArray(decision.hipoteses) ? decision.hipoteses.slice(0, 2).map((h) => String(h).slice(0, 80)) : [];
  let displayThought = thought;
  if (uncertaintyNote) displayThought += ` [incerteza: ${uncertaintyNote}]`;
  if (hypotheses.length) displayThought += ` [hipóteses: ${hypotheses.join(" / ")}]`;
  agent.lastThought = displayThought || agent.lastThought;
  agent.lastActionType = action;
  agent.lastActionTargetXY = null;

  // "mensagem" agora funciona junto de QUALQUER ação (ex: comer e gritar por ajuda ao mesmo tempo).
  // A ação "falar" continua tratando sua própria mensagem separadamente (ver case abaixo).
  const spokenMsg = action !== "falar" ? String(decision.mensagem || "").slice(0, 140) : "";
  let spokenVerb = "gritou";
  if (spokenMsg) {
    spokenVerb = broadcastMessage(world, agent, spokenMsg, decision.tom);
    agent.lastSpokeTick = world.tick;
    agent.lastMessage = spokenMsg;
    agent.lastMessageTick = world.tick;
  }

  // "nota" e "plano" também são opcionais em QUALQUER ação — memória de longo prazo.
  const note = String(decision.nota || "").slice(0, 200);
  if (note) {
    if (!agent.memory.longTerm) agent.memory.longTerm = [];
    agent.memory.longTerm.push({ tick: world.tick, text: note });
    if (agent.memory.longTerm.length > LONG_TERM_LIMIT) {
      agent.memory.longTerm.splice(0, agent.memory.longTerm.length - LONG_TERM_LIMIT);
    }
  }
  const plan = String(decision.plano || "").slice(0, 200);
  if (plan) {
    agent.memory.currentPlan = { tick: world.tick, text: plan };
  }

  // "mover" (campo separado, não é uma "action") é o deslocamento curto e gratuito —
  // roda ANTES da action principal, então o agente pode andar até 3 quadrados e ainda
  // cortar madeira/beber/atacar/etc. na posição nova, no mesmo ciclo.
  let moveDesc = "";
  const mv = decision.mover;
  if (mv && typeof mv === "object" && action !== "correr") {
    let mdx = Math.max(-1, Math.min(1, Number(mv.dx) || 0));
    let mdy = Math.max(-1, Math.min(1, Number(mv.dy) || 0));
    let steps = Math.max(1, Math.min(3, Math.round(Number(mv.distancia)) || 1));
    if (mdx !== 0 || mdy !== 0) {
      agent.x = clampGrid(agent.x + mdx * steps);
      agent.y = clampGrid(agent.y + mdy * steps);
      moveDesc = `andou ${steps > 1 ? `${steps} quadrados` : "1 quadrado"} até (${agent.x},${agent.y}) e `;
    }
  }

  const isFailureText = (t) => t.includes(" mas ") || t.includes("já existe") || t.includes("já estava cheio") || t.includes("já estava");

  const say = (text) => {
    const combinedText = moveDesc ? `${moveDesc}${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
    const fullText = spokenMsg ? `${combinedText} E ${spokenVerb}: "${spokenMsg}"` : combinedText;
    agent.lastAction = fullText;
    events.push({ tick: world.tick, text: `${agent.name}: ${fullText}` });

    const failed = isFailureText(text);
    const priorSameActionFailures = agent.memory.selfLog
      .slice(-3)
      .filter((e) => e.action === action && isFailureText(e.result)).length;
    const isRepeatedError = failed && priorSameActionFailures >= 1;
    const storedResult = isRepeatedError
      ? `⚠️ ERRO REPETIDO (já falhou tentando "${action}" antes e falhou de novo): ${fullText}`
      : fullText;

    agent.memory.selfLog.push({ tick: world.tick, action, result: storedResult, failed });
    if (agent.memory.selfLog.length > MEMORY_LOG_LIMIT) {
      agent.memory.selfLog.splice(0, agent.memory.selfLog.length - MEMORY_LOG_LIMIT);
    }

    const actorPos = preTickPositions.find((p) => p.id === agent.id);
    if (actorPos) {
      for (const p of preTickPositions) {
        if (p.id === agent.id) continue;
        if (chebyshev(actorPos.x, actorPos.y, p.x, p.y) <= VISION_RADIUS) {
          recordObservation(world, p.id, agent.name, fullText);
        }
      }
    }
  };

  switch (action) {
    case "correr":
    case "mover": {
      let dx = Number(decision.dx) || 0;
      let dy = Number(decision.dy) || 0;
      dx = Math.max(-1, Math.min(1, dx));
      dy = Math.max(-1, Math.min(1, dy));
      let steps = Math.round(Number(decision.distancia)) || 1;
      steps = Math.max(1, Math.min(6, steps));
      agent.x = clampGrid(agent.x + dx * steps);
      agent.y = clampGrid(agent.y + dy * steps);
      const MOVE_COST = { 4: 3, 5: 10, 6: 20 };
      const cost = MOVE_COST[steps] || 0;
      if (cost > 0) {
        agent.hp = Math.max(0, agent.hp - cost);
        say(`correu ${steps} quadrados até (${agent.x},${agent.y}), gastando energia (-${cost} HP).`);
        if (agent.hp === 0) {
          killAgent(world, agent, "desmaiou de exaustão ao correr", events);
        }
      } else {
        say(`moveu-se ${steps > 1 ? `${steps} quadrados` : ""} até (${agent.x},${agent.y})`.replace("  ", " "));
      }
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
      const cutBonus = bestNumericBonus(world, agent.x, agent.y, "cutBonus", 1);
      let extraWood = "";
      if (cutBonus > 0 && tree.wood > 0 && Math.random() < cutBonus) {
        tree.wood -= 1;
        agent.inventory.madeira += 1;
        if (tree.wood === 0) tree.regenAt = world.tick + TREE_REGEN_TICKS;
        extraWood = " (a oficina por perto rendeu madeira extra)";
      }
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      say(`cortou madeira na floresta${extraWood}.`);
      break;
    }
    case "cacar": {
      if (!isForest(agent.x, agent.y)) {
        say("tentou caçar fora da floresta e não achou nada.");
        break;
      }
      const huntBonus = bestNumericBonus(world, agent.x, agent.y, "huntBonus", 1);
      const preyHere = animalAt(world, agent.x, agent.y);
      const preyNear = preyHere ? null : animalNear(world, agent.x, agent.y, 1)[0] || null;
      const prey = preyHere || preyNear;
      if (prey) {
        const chance = preyHere ? 0.85 + huntBonus : 0.55 + huntBonus;
        if (Math.random() < chance) {
          agent.inventory.carne += 2;
          world.animals = (world.animals || []).filter((an) => an.id !== prey.id);
          say(`caçou um ${prey.kind} com sucesso e conseguiu 2 de carne${huntBonus ? " (o aviário por perto ajudou)" : ""}.`);
        } else {
          say(`tentou caçar o ${prey.kind} que viu por perto, mas ele escapou.`);
        }
      } else if (Math.random() < 0.45 + huntBonus) {
        agent.inventory.carne += 1;
        say(`caçou com sucesso e conseguiu carne${huntBonus ? " (o aviário por perto ajudou)" : ""}.`);
      } else {
        say("caçou, mas voltou de mãos vazias.");
      }
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      break;
    }
    case "criar_lanca": {
      if ((agent.inventory.madeira || 0) < LANCA_WOOD_COST) {
        say(`quis criar uma lança, mas precisa de ${LANCA_WOOD_COST} de madeira e não tinha o suficiente.`);
        break;
      }
      if ((agent.inventory.machado || 0) < 1) {
        say("quis criar uma lança, mas precisa de um machado pra entalhar a ponta.");
        break;
      }
      agent.inventory.madeira -= LANCA_WOOD_COST;
      agent.inventory.lanca = (agent.inventory.lanca || 0) + 1;
      say(`criou uma lança usando ${LANCA_WOOD_COST} de madeira. Agora dá pra enfrentar feras grandes.`);
      break;
    }
    case "montar_armadilha": {
      if (!isForest(agent.x, agent.y)) {
        say("tentou montar uma armadilha fora da floresta — não faz sentido aqui.");
        break;
      }
      if ((agent.inventory.madeira || 0) < ARMADILHA_WOOD_COST) {
        say(`quis montar uma armadilha, mas precisa de ${ARMADILHA_WOOD_COST} de madeira e não tinha o suficiente.`);
        break;
      }
      if (trapAt(world, agent.x, agent.y)) {
        say("já existe uma armadilha bem aqui.");
        break;
      }
      agent.inventory.madeira -= ARMADILHA_WOOD_COST;
      const nearbyMega = megafaunaNear(world, agent.x, agent.y, 6)[0] || null;
      const sightings = nearbyMega ? (agent.memory.megafaunaSightings || {})[nearbyMega.id] || 0 : 0;
      const effective = sightings >= SIGHTINGS_TO_PREDICT_MOVEMENT;
      world.traps = world.traps || [];
      world.traps.push({ x: agent.x, y: agent.y, builtBy: agent.name, tick: world.tick, effective });
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      say(
        effective
          ? "montou uma armadilha bem posicionada — observou o suficiente pra prever por onde a fera passa."
          : "montou uma armadilha, mas sem ter observado a fera o bastante — pode não funcionar direito."
      );
      break;
    }
    case "atacar_fera": {
      const nomeAlvo = String(decision.alvo || "").toLowerCase();
      const candidatas = megafaunaNear(world, agent.x, agent.y, 1);
      const alvo =
        candidatas.find((m) => m.id.toLowerCase() === nomeAlvo || (MEGAFAUNA_TYPES[m.kind]?.label || m.kind).toLowerCase() === nomeAlvo) ||
        candidatas[0] ||
        null;
      if (!alvo) {
        say("tentou atacar uma fera grande, mas não tinha nenhuma por perto.");
        break;
      }
      if ((agent.inventory.lanca || 0) < 1) {
        say(`viu o(a) ${MEGAFAUNA_TYPES[alvo.kind]?.label || alvo.kind} por perto, mas não tem uma lança pra enfrentar — só observou de longe.`);
        break;
      }
      alvo.attackersThisTick = alvo.attackersThisTick || [];
      const jaAtacaramAntes = alvo.attackersThisTick.length;
      alvo.attackersThisTick.push(agent.id);
      const label = MEGAFAUNA_TYPES[alvo.kind]?.label || alvo.kind;
      const cfg = MEGAFAUNA_TYPES[alvo.kind] || {};

      let dano;
      let retaliacao = 0;
      if (alvo.trappedUntil) {
        dano = Math.ceil(alvo.maxHp * 0.6); // presa = golpe decisivo
      } else if (jaAtacaramAntes >= 1) {
        dano = Math.ceil(alvo.maxHp * 0.5); // ataque coordenado (2º+ atacante no mesmo ciclo)
      } else {
        dano = Math.ceil(alvo.maxHp * 0.15); // sozinho, sem armadilha: fraco e arriscado
        if (Math.random() < 0.5) {
          retaliacao = cfg.retaliationMin + Math.floor(Math.random() * ((cfg.retaliationMax || 20) - (cfg.retaliationMin || 10) + 1));
        }
      }
      alvo.hp = Math.max(0, alvo.hp - dano);
      agent.lastActionTargetXY = { x: alvo.x, y: alvo.y };

      if (retaliacao > 0) {
        agent.hp = Math.max(0, agent.hp - retaliacao);
        say(`atacou o(a) ${label} sozinho(a) (-${dano} HP nela), mas levou um contra-ataque feio (-${retaliacao} HP). Caçar isso sozinho é perigoso demais.`);
        if (agent.hp === 0) {
          killAgent(world, agent, `atacado(a) por um(a) ${label} sem apoio da tribo`, events);
        }
      } else if (alvo.hp <= 0) {
        const participantes = [...new Set(alvo.attackersThisTick)].map((id) => world.agents.find((a) => a.id === id)).filter((a) => a && a.alive);
        const totalCarne = cfg.meatReward || 20;
        const porAgente = Math.max(1, Math.floor(totalCarne / Math.max(1, participantes.length)));
        for (const p of participantes) p.inventory.carne = (p.inventory.carne || 0) + porAgente;
        world.megafauna = world.megafauna.filter((m) => m.id !== alvo.id);
        const nomes = participantes.map((p) => p.name).join(", ") || agent.name;
        events.push({ tick: world.tick, text: `${label.toUpperCase()} ABATIDO(A)! ${nomes} derrubaram a fera e dividiram ${totalCarne} de carne (${porAgente} cada).` });
        say(`desferiu o golpe final no(a) ${label} — a fera caiu! Carne dividida com quem ajudou.`);
      } else {
        say(
          jaAtacaramAntes >= 1
            ? `atacou o(a) ${label} em conjunto com outro agente (-${dano} HP nela, agora com ${alvo.hp}/${alvo.maxHp}) — ataque coordenado bem mais forte.`
            : `atacou o(a) ${label} sozinho(a) (-${dano} HP nela, agora com ${alvo.hp}/${alvo.maxHp}) e teve sorte de não ser revidado — ainda assim, é arriscado continuar sem ajuda.`
        );
      }
      break;
    }
    case "pescar": {
      if (!isNearRiver(agent.x, agent.y)) {
        say("tentou pescar, mas está longe do rio (que serve de lago).");
        break;
      }
      const fishBonus = bestNumericBonus(world, agent.x, agent.y, "fishBonus", 1);
      if (Math.random() < 0.5 + fishBonus) {
        agent.inventory.peixe += 1;
        say(`pescou com sucesso e conseguiu peixe${fishBonus ? " (o cais por perto ajudou)" : ""}.`);
      } else {
        say("pescou, mas não fisgou nada.");
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
      const nearWater = isNearRiver(agent.x, agent.y) || hasWaterSourceNear(world, agent.x, agent.y);
      if (!nearWater) {
        say("tentou encher o cantil, mas está longe do rio (ou de um poço).");
        break;
      }
      if (agent.inventory.agua >= WATER_CAPACITY) {
        say("o cantil já estava cheio.");
      } else {
        agent.inventory.agua = WATER_CAPACITY;
        agent.lastActionTargetXY = { x: agent.x, y: agent.y };
        say(`encheu o cantil por completo${isNearRiver(agent.x, agent.y) ? " no rio" : " no poço"}.`);
      }
      break;
    }
    case "comer": {
      if (agent.inventory.pao > 0) {
        agent.inventory.pao -= 1;
        const bakeBonus = bestNumericBonus(world, agent.x, agent.y, "bakeBonus", 1);
        agent.hunger = Math.min(100, agent.hunger + 40 + bakeBonus);
        say(`comeu um pedaço de pão${bakeBonus ? " (a padaria por perto rendeu mais energia)" : ""}.`);
      } else if (agent.inventory.carne > 0) {
        agent.inventory.carne -= 1;
        agent.hunger = Math.min(100, agent.hunger + 35);
        say("comeu carne caçada.");
      } else if (agent.inventory.peixe > 0) {
        agent.inventory.peixe -= 1;
        agent.hunger = Math.min(100, agent.hunger + 35);
        say("comeu peixe pescado.");
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
      const cropBonus = bestNumericBonus(world, agent.x, agent.y, "cropBonus", 1);
      agent.inventory.pao += 2 + cropBonus;
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      say(`colheu a plantação e ganhou pão${cropBonus ? " (o moinho/jardim por perto rendeu mais)" : ""}.`);
      break;
    }
    case "construir": {
      const terrain = terrainAt(agent.x, agent.y);
      const structureType = STRUCTURE_TYPES[decision.estrutura] ? decision.estrutura : "abrigo";
      if (terrain !== "planicie" && terrain !== "aldeia") {
        agent.memory.pendingBuild = { estrutura: structureType, tick: world.tick };
        const spot = findNearbyBuildableTile(world, agent.x, agent.y);
        say(
          `tentou construir aqui, mas o terreno não é adequado (só planície ou aldeia)${
            spot ? ` — o quadrado livre mais próximo pra isso é (${spot.x},${spot.y})` : ""
          }.`
        );
        break;
      }
      world.structures = world.structures || [];
      const already = world.structures.find((s) => s.x === agent.x && s.y === agent.y);
      if (already) {
        agent.memory.pendingBuild = { estrutura: structureType, tick: world.tick };
        const spot = findNearbyBuildableTile(world, agent.x, agent.y);
        say(
          `já existe uma estrutura (${already.type}) bem aqui — precisa andar 1 quadrado pro lado antes de construir outra${
            spot ? ` (o quadrado livre mais próximo é (${spot.x},${spot.y}))` : ""
          }.`
        );
        break;
      }
      const cost = STRUCTURE_TYPES[structureType].cost;
      if ((agent.inventory.madeira || 0) < cost) {
        agent.memory.pendingBuild = { estrutura: structureType, tick: world.tick };
        say(`quis construir ${structureType === "casa" ? "uma casa" : `um(a) ${structureType}`}, mas precisa de ${cost} de madeira e não tinha o suficiente.`);
        break;
      }
      agent.inventory.madeira -= cost;
      world.structures.push({ x: agent.x, y: agent.y, type: structureType, builtBy: agent.name, builtAt: world.tick });
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      agent.memory.pendingBuild = null;
      say(`construiu ${structureType === "casa" ? "uma casa" : `um(a) ${structureType}`} usando ${cost} de madeira.`);
      break;
    }
    case "confraternizar": {
      const companions = nearbyAliveAgents(world, agent.x, agent.y, 1).filter((a) => a.id !== agent.id);
      if (!companions.length) {
        say("quis se reunir com alguém pra conversar, mas não tinha ninguém por perto.");
        break;
      }
      const here = structureAt(world, agent.x, agent.y);
      const hereGatherBonus = here ? STRUCTURE_TYPES[here.type]?.gatherBonus : null;
      const gain = hereGatherBonus || 5;
      const spot = here ? ` perto ${here.type === "fogueira" || here.type === "santuario" ? "da" : "do"} ${here.type}` : "";
      for (const companion of companions) {
        adjustTrust(companion, agent.id, gain);
        adjustTrust(agent, companion.id, gain);
        companion.memory.rumors.push({
          from: "observação direta",
          content: `${agent.name} passou um tempo bom confraternizando comigo${spot}.`,
          tick: world.tick,
        });
      }
      agent.lastActionTargetXY = { x: agent.x, y: agent.y };
      say(`confraternizou com ${companions.map((c) => c.name).join(", ")}${spot}.`);
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
        const targetInNeed = target.hunger <= 40 || target.thirst <= 40;
        const tradeBonus = Math.max(
          bestNumericBonus(world, agent.x, agent.y, "tradeBonus", 1),
          bestNumericBonus(world, target.x, target.y, "tradeBonus", 1)
        );
        const trustGain = (targetInNeed ? 25 : 15) + tradeBonus;
        target.memory.rumors.push({
          from: agent.name,
          content: targetInNeed
            ? `${agent.name} me deu ${qty} de ${resource} bem na hora que eu mais precisava. Não vou esquecer disso.`
            : `${agent.name} me deu ${qty} de ${resource}.`,
          tick: world.tick,
        });
        adjustTrust(target, agent.id, trustGain);
        say(
          targetInNeed
            ? `deu ${qty} de ${resource} pra ${target.name}, que estava em apuros — um gesto de empatia.`
            : `deu ${qty} de ${resource} pra ${target.name}${tradeBonus ? " (celeiro/mercado por perto ajudou a confiança)" : ""}.`
        );
      } else if (action === "roubar") {
        const resource = RESOURCE_KEYS.includes(decision.recurso) ? decision.recurso : "pao";
        const qty = Math.max(1, Number(decision.quantidade) || 1);
        const available = target.inventory[resource] || 0;
        if (available <= 0) {
          say(`tentou roubar ${resource} de ${target.name}, mas ele não tinha nada disso.`);
          break;
        }
        const protectiveChance = bestTheftChance(world, target.x, target.y);
        const stealChance = protectiveChance !== null ? protectiveChance : 0.5;
        if (Math.random() < stealChance) {
          const taken = Math.min(qty, available);
          target.inventory[resource] -= taken;
          agent.inventory[resource] = (agent.inventory[resource] || 0) + taken;
          target.memory.rumors.push({ from: "observação direta", content: `${agent.name} roubou ${taken} de ${resource} de mim!`, tick: world.tick });
          adjustTrust(target, agent.id, -35);
          say(`roubou ${taken} de ${resource} de ${target.name}.`);
        } else {
          target.memory.rumors.push({ from: "observação direta", content: `${agent.name} tentou me roubar e falhou.`, tick: world.tick });
          adjustTrust(target, agent.id, -30);
          say(`tentou roubar de ${target.name}, mas foi flagrado e falhou${protectiveChance !== null ? " (a proteção da construção ajudou)" : ""}.`);
        }
      } else if (action === "atacar") {
        const dmg = 8 + Math.floor(Math.random() * 13);
        target.hp = Math.max(0, target.hp - dmg);
        target.memory.rumors.push({ from: "observação direta", content: `${agent.name} me atacou e causou ${dmg} de dano!`, tick: world.tick });
        adjustTrust(target, agent.id, -50);
        if (target.hp === 0) {
          killAgent(world, target, `derrotado por ${agent.name}`, events);
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
      const verb = broadcastMessage(world, agent, msg, decision.tom);
      agent.lastSpokeTick = world.tick;
      agent.lastMessage = msg;
      agent.lastMessageTick = world.tick;
      say(`${verb}: "${msg}"`);
      break;
    }
    case "esperar":
    default: {
      if (actionWasUnknown) {
        say(`tentou uma ação não reconhecida ("${String(rawActionInput).slice(0, 40)}"), mas isso não existe como ação válida, então só esperou.`);
      } else {
        say("esperou e observou o entorno.");
      }
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

// ---------------------------------------------------------------------------
// "Exchange": um ciclo RÁPIDO, só de conversa, pensado pra rodar num cron
// separado (mais frequente que o /api/tick principal). Ele não decai fome/sede,
// não gasta recursos nem move ninguém — só dá aos agentes a chance de responder
// mensagens pendentes uns dos outros ANTES do próximo /api/tick continuar a
// simulação de verdade. Só chama a API de IA pra quem realmente tem uma
// mensagem pendente pra responder, então é barato e rápido.
// ---------------------------------------------------------------------------

function buildExchangePrompt(world, agent, pendingText) {
  const others = world.agents.filter((a) => a.id !== agent.id && a.alive);
  const rosterText = others.length
    ? others.map((o) => `- ${o.name}: fome ${o.hunger}, sede ${o.thirst}, hp ${o.hp}`).join("\n")
    : "(nenhum outro agente vivo agora)";

  const system = `Você é ${agent.name}, um dos agentes autônomos da vila Robotville.
{{PERSONA}}
${SOCIAL_DYNAMICS_RULES}

Este é um CICLO RÁPIDO, só de conversa — diferente do ciclo normal, aqui não existe ação de
sobrevivência nem movimento, é só a sua chance de responder e alinhar o trabalho em equipe com
os outros agentes antes que a simulação principal continue.`;

  const user = `SEU ESTADO AGORA: fome ${agent.hunger}, sede ${agent.thirst}, hp ${agent.hp}.

OUTROS AGENTES DA TRIBO AGORA:
${rosterText}

${pendingText}

Responda APENAS com um objeto JSON válido, sem texto fora dele, neste formato:
{
  "thought": "1 frase curta com seu raciocínio",
  "mensagem": "sua resposta curta (obrigatório)",
  "tom": "sussurro" | "fala" | "grito"
}
"tom" é opcional (padrão "fala" se omitido). Seja breve, direto e gentil — o objetivo aqui é
fortalecer o trabalho em equipe da tribo. Quando fizer sentido, aproveite pra combinar quem faz
o quê (ex: "eu continuo na água, você foca em madeira") em vez de só bater papo à toa.`;

  return { system, user };
}

async function decideReply(world, agent, pendingText) {
  const { system: systemTemplate, user } = buildExchangePrompt(world, agent, pendingText);
  const cfg = AGENT_CONFIG[agent.provider];
  const minds = cfg.minds || [cfg];

  const attempts = [];
  for (const mind of minds) {
    const keys = (mind.apiKeyEnvs || []).map((envName) => process.env[envName]).filter(Boolean);
    for (const apiKey of keys) attempts.push({ mind, apiKey });
  }
  if (attempts.length === 0) return null;

  for (let i = 0; i < attempts.length; i++) {
    const { mind, apiKey } = attempts[i];
    const system = systemTemplate.replace("{{PERSONA}}", mind.persona || "");
    try {
      const raw = mind.isGemini
        ? await callGemini({ apiKey, model: mind.model, system, user })
        : await callChatCompletion({ baseURL: mind.baseURL, apiKey, model: mind.model, system, user, extraBody: mind.extraBody });
      agent.activeMind = mind.id;
      agent.activeMindVibe = mind.vibe || null;
      return parseAgentDecision(raw);
    } catch (e) {
      if (e?.status === 429 && i < attempts.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

export async function runExchange(world) {
  // compatibilidade com mundos salvos antes desses campos existirem (mesma
  // checagem defensiva do runTick, só que aqui é essencial já que exchange
  // pode rodar antes do primeiro /api/tick depois de um reset)
  for (const agent of world.agents) {
    if (!agent.memory.selfLog) agent.memory.selfLog = [];
    if (!agent.memory.observations) agent.memory.observations = [];
    if (!agent.memory.trust) agent.memory.trust = {};
    if (!agent.memory.longTerm) agent.memory.longTerm = [];
    if (agent.memory.rumors) agent.memory.rumors = agent.memory.rumors || [];
  }

  const aliveAgents = world.agents.filter((a) => a.alive);
  const withPending = aliveAgents
    .map((agent) => ({ agent, pending: pendingReplyText(agent) }))
    .filter((x) => x.pending);

  if (!withPending.length) {
    return world; // ninguém tem mensagem pendente agora — nada pra fazer, não gasta chamada de API
  }

  // avança um "microciclo" (fração de tick) só pra manter a ordem cronológica
  // certa entre boatos/respostas — isso NÃO conta como um ciclo de verdade:
  // não decai fome/sede, não regenera árvore/plantação, o relógio dia/noite
  // mal se move.
  world.tick = Math.round((world.tick + 0.01) * 1000) / 1000;
  world.updatedAt = Date.now();

  const events = [];
  const decisions = await Promise.all(withPending.map(({ agent, pending }) => decideReply(world, agent, pending)));

  withPending.forEach(({ agent }, i) => {
    const decision = decisions[i];
    if (!decision) return;
    const msg = String(decision.mensagem || "").slice(0, 140);
    if (!msg) return;
    const verb = broadcastMessage(world, agent, msg, decision.tom);
    agent.lastSpokeTick = world.tick;
    if (decision.thought) agent.lastThought = String(decision.thought).slice(0, 240);
    events.push({ tick: Math.floor(world.tick), text: `${agent.name} ${verb}: "${msg}"` });
  });

  world.events = [...events, ...world.events].slice(0, 60);
  return world;
}

export async function runTick(world) {
  // sempre avança pra um número inteiro limpo, mesmo que o /api/exchange tenha
  // deixado o tick numa fração (ex: 19.02) — sem isso a fração ficaria se
  // arrastando pra sempre (19.02 -> 20.02 -> 21.02...) em vez de resetar.
  world.tick = Math.floor(world.tick) + 1;
  world.updatedAt = Date.now();
  const events = [];

  // compatibilidade com mundos salvos antes desses campos existirem
  for (const agent of world.agents) {
    if (!agent.memory.selfLog) agent.memory.selfLog = [];
    if (!agent.memory.observations) agent.memory.observations = [];
    if (!agent.memory.trust) agent.memory.trust = {};
    if (!agent.memory.longTerm) agent.memory.longTerm = [];
    if (agent.memory.currentPlan === undefined) agent.memory.currentPlan = null;
    if (agent.memory.pendingBuild === undefined) agent.memory.pendingBuild = null;
    if (agent.inventory.peixe === undefined) agent.inventory.peixe = 0;
  }
  world.structures = world.structures || [];
  world.animals = world.animals || [];

  spawnAndMoveAnimals(world, events);
  spawnAndMoveMegafauna(world, events);
  computeObjectives(world);

  // decaimento de fome/sede e regeneração de recursos
  for (const agent of world.agents) {
    if (!agent.alive) continue;
    const home = world.structures.find(
      (s) => (STRUCTURE_TYPES[s.type]?.decayDivisor > 1 || STRUCTURE_TYPES[s.type]?.hpRegen > 0) && s.x === agent.x && s.y === agent.y
    );
    const cfg = home ? STRUCTURE_TYPES[home.type] : null;
    const decay = cfg ? Math.ceil(HUNGER_THIRST_DECAY / cfg.decayDivisor) : HUNGER_THIRST_DECAY;
    agent.hunger = Math.max(0, agent.hunger - decay);
    agent.thirst = Math.max(0, agent.thirst - decay);
    if (cfg && cfg.hpRegen && agent.hp < 100 && agent.hunger > 0 && agent.thirst > 0) {
      agent.hp = Math.min(100, agent.hp + cfg.hpRegen);
    }
    if (agent.hunger === 0 || agent.thirst === 0) {
      agent.hp = Math.max(0, agent.hp - 10);
      if (agent.hp === 0) {
        killAgent(world, agent, "sucumbiu à fome/sede", events);
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
