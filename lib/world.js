// Mundo de Robotville: grade, terrenos, recursos e estado inicial.

export const GRID_SIZE = 24; // mapa maior (era 16)
export const VISION_RADIUS = 4; // até onde um agente enxerga
export const TREE_MAX_WOOD = 3;
export const TREE_REGEN_TICKS = 25;
export const CROP_GROWTH_TICKS = 18;
export const WATER_CAPACITY = 4;
export const HUNGER_THIRST_DECAY = 2;
export const TICKS_PER_DAY = 20; // duração de um "dia" completo em ciclos
export const NIGHT_TICKS = 6; // últimos N ciclos de cada dia são noite

export function isNight(tick) {
  return tick % TICKS_PER_DAY >= TICKS_PER_DAY - NIGHT_TICKS;
}

// Tipos de estrutura que dá pra construir, custo em madeira e o que cada uma faz.
// Campos especiais (todos opcionais, além de cost/decayDivisor/hpRegen):
// - theftChance: substitui a chance base de roubo (0.5) por esse valor quando o alvo
//   está perto (raio 1) dessa estrutura. Quando várias se aplicam, vale a mais protetora.
// - gatherBonus: quanto de confiança "confraternizar" dá quando feito EM CIMA dela
//   (em vez do padrão de 5).
// - waterSource: permite "encher_cantil" perto dela mesmo longe do rio.
// - visionBoost: soma esse valor ao raio de visão de quem está em cima dela.
// - fishBonus / huntBonus / cutBonus: soma essa chance extra de sucesso em
//   pescar / caçar / cortar madeira quando feito perto (raio 1).
// - cropBonus: pão extra por colheita feita perto (raio 1).
// - bakeBonus: fome extra recuperada ao comer pão perto (raio 1).
// - tradeBonus: confiança extra ao dar recurso quando alguém dos dois está perto (raio 1).
// - voiceBoost: dobra o alcance de qualquer mensagem falada perto dela (raio 1).
export const STRUCTURE_TYPES = {
  abrigo: { cost: 3, decayDivisor: 2, hpRegen: 3, desc: "reduz o gasto de fome/sede pela metade e regenera HP enquanto você estiver em cima" },
  casa: { cost: 6, decayDivisor: 3, hpRegen: 4, desc: "como o abrigo, mas mais forte — é seu lar permanente, reduz o gasto de fome/sede a 1/3 e regenera mais HP" },
  cerca: { cost: 2, decayDivisor: 1, hpRegen: 0, theftChance: 0.2, desc: "dificulta muito que roubem de você enquanto estiver perto dela" },
  fogueira: { cost: 2, decayDivisor: 1, hpRegen: 0, gatherBonus: 8, desc: "ponto de encontro da tribo à noite — confraternizar em cima dela fortalece amizades mais que o normal" },
  tenda: { cost: 1, decayDivisor: 1.3, hpRegen: 1, desc: "abrigo bem simples e barato pra quem tá começando" },
  celeiro: { cost: 4, decayDivisor: 1, hpRegen: 0, tradeBonus: 10, desc: "ponto de troca de recursos da tribo — dar recurso perto dele rende confiança extra" },
  poco: { cost: 3, decayDivisor: 1, hpRegen: 0, waterSource: true, desc: "funciona como o rio pra encher o cantil, sem precisar viajar até lá" },
  torre_vigia: { cost: 5, decayDivisor: 1, hpRegen: 0, visionBoost: 2, desc: "aumenta seu raio de visão em 2 enquanto estiver em cima dela" },
  muralha: { cost: 5, decayDivisor: 1, hpRegen: 0, theftChance: 0.1, desc: "como a cerca, mas ainda mais forte contra roubo" },
  moinho: { cost: 4, decayDivisor: 1, hpRegen: 0, cropBonus: 1, desc: "aumenta o rendimento de uma colheita feita perto dela" },
  padaria: { cost: 4, decayDivisor: 1, hpRegen: 0, bakeBonus: 10, desc: "comer pão perto dela recupera mais fome que o normal" },
  curral: { cost: 3, decayDivisor: 1.5, hpRegen: 2, desc: "descanso pra quem acabou de caçar ou pescar" },
  ponte: { cost: 3, decayDivisor: 1, hpRegen: 0, desc: "facilita atravessar o rio com segurança" },
  farol: { cost: 4, decayDivisor: 1, hpRegen: 0, voiceBoost: true, desc: "dobra o alcance de qualquer mensagem falada perto dele" },
  santuario: { cost: 3, decayDivisor: 1, hpRegen: 0, gatherBonus: 10, desc: "outro ponto de encontro da tribo, ainda mais forte pra fortalecer amizades" },
  mercado: { cost: 5, decayDivisor: 1, hpRegen: 0, tradeBonus: 10, desc: "como o celeiro — trocas de recursos perto dele rendem confiança extra" },
  enfermaria: { cost: 5, decayDivisor: 1, hpRegen: 6, desc: "regenera HP rápido, mas não ajuda fome/sede" },
  estabulo: { cost: 3, decayDivisor: 1, hpRegen: 2, desc: "abrigo simples com alguma regeneração de HP" },
  oficina: { cost: 4, decayDivisor: 1, hpRegen: 0, cutBonus: 0.2, desc: "aumenta a chance de sucesso ao cortar madeira perto dela" },
  jardim: { cost: 2, decayDivisor: 1, hpRegen: 0, cropBonus: 1, desc: "como o moinho, aumenta o rendimento de colheitas por perto" },
  estatua_unidade: { cost: 3, decayDivisor: 1, hpRegen: 0, desc: "monumento decorativo em homenagem à união da tribo" },
  torre_sino: { cost: 3, decayDivisor: 1, hpRegen: 0, voiceBoost: true, desc: "como o farol, dobra o alcance de mensagens faladas perto dela" },
  deposito: { cost: 4, decayDivisor: 1, hpRegen: 0, desc: "armazém simples da tribo, mais um ponto de referência" },
  cais: { cost: 3, decayDivisor: 1, hpRegen: 0, fishBonus: 0.2, desc: "aumenta a chance de sucesso ao pescar perto dele" },
  aviario: { cost: 3, decayDivisor: 1, hpRegen: 0, huntBonus: 0.15, desc: "aumenta a chance de sucesso ao caçar perto dele" },
};

// Zonas (proporcionais ao tamanho do mapa, pra facilitar mudar GRID_SIZE no futuro):
// floresta1 no canto superior-esquerdo, rio1 no canto inferior-direito (longe um do outro),
// e floresta2+rio2 no canto superior-direito, coladinhos um no outro, pra dar uma opção de
// viagem rápida sem precisar atravessar o mapa inteiro.
export const FOREST_MAX = Math.round(GRID_SIZE * 0.2); // 0..FOREST_MAX é floresta1
export const RIVER_MIN = GRID_SIZE - 1 - Math.round(GRID_SIZE * 0.2); // RIVER_MIN..fim é rio1
const VILLAGE_HALF = Math.round(GRID_SIZE * 0.08);
export const VILLAGE_CENTER = Math.floor(GRID_SIZE / 2);
export const VILLAGE_MIN = VILLAGE_CENTER - VILLAGE_HALF;
export const VILLAGE_MAX = VILLAGE_CENTER + VILLAGE_HALF;

const ZONE2_SIZE = Math.round(GRID_SIZE * 0.18); // largura/altura de floresta2 e rio2
export const FOREST2_X_MIN = GRID_SIZE - 1 - ZONE2_SIZE; // floresta2: canto superior-direito
export const FOREST2_Y_MAX = ZONE2_SIZE;
export const RIVER2_Y_MIN = ZONE2_SIZE + 2; // rio2: logo abaixo da floresta2, bem perto
export const RIVER2_Y_MAX = RIVER2_Y_MIN + ZONE2_SIZE;

export function terrainAt(x, y) {
  if (x <= FOREST_MAX && y <= FOREST_MAX) return "floresta";
  if (x >= RIVER_MIN && y >= RIVER_MIN) return "rio";
  if (x >= FOREST2_X_MIN && y <= FOREST2_Y_MAX) return "floresta";
  if (x >= FOREST2_X_MIN && y >= RIVER2_Y_MIN && y <= RIVER2_Y_MAX) return "rio";
  if (x >= VILLAGE_MIN && x <= VILLAGE_MAX && y >= VILLAGE_MIN && y <= VILLAGE_MAX) return "aldeia";
  return "planicie";
}

export function isForest(x, y) {
  return terrainAt(x, y) === "floresta";
}
export function isRiver(x, y) {
  return terrainAt(x, y) === "rio";
}
export function isPlain(x, y) {
  return terrainAt(x, y) === "planicie";
}

export function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function clampGrid(v) {
  return Math.max(0, Math.min(GRID_SIZE - 1, v));
}

// Metas coletivas da tribo (calculadas automaticamente a cada ciclo, ver computeObjectives em tick.js).
export const OBJECTIVE_DEFS = [
  { id: "primeira_casa", label: "Construir a primeira casa" },
  { id: "ponto_de_encontro", label: "Ter um ponto de encontro pra tribo (fogueira/santuário)" },
  { id: "producao_agricola", label: "Ter produção agrícola (moinho/jardim)" },
  { id: "reserva_para_todos", label: "Todo mundo vivo com reserva de comida e água" },
  { id: "rede_confianca_forte", label: "Confiança média da tribo acima de 70" },
  { id: "sobrevivencia_60", label: "Sobreviver 60 ciclos com todo mundo vivo" },
];
// Reservado pra um sistema de papéis futuro — ainda não é usado em nenhuma lógica de jogo.
export const ROLE_DEFS = [];

// Bichos selvagens que aparecem de vez em quando na floresta pra caçar.
export const ANIMAL_TYPES = ["coelho", "veado", "javali"];
export const MAX_ANIMALS = 6; // no máximo isso de bichos no mapa ao mesmo tempo
export const ANIMAL_SPAWN_CHANCE = 0.35; // chance por ciclo de nascer um bicho novo (se houver vaga)

function initialTrees() {
  const trees = {};
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      if (isForest(x, y)) trees[`${x},${y}`] = { wood: TREE_MAX_WOOD, regenAt: null };
    }
  }
  return trees;
}

const AGENT_SEEDS = [
  { id: "cerebras", name: "CEREBRAS", color: "#FF8A3D", provider: "cerebras", startX: VILLAGE_CENTER, startY: VILLAGE_CENTER },
  { id: "mistral", name: "MISTRAL", color: "#9B7BFF", provider: "mistral", startX: VILLAGE_CENTER + 1, startY: VILLAGE_CENTER },
  { id: "gemini", name: "GEMINI", color: "#4285F4", provider: "gemini", startX: VILLAGE_CENTER, startY: VILLAGE_CENTER + 1 },
];

export function initialWorld() {
  const now = Date.now();
  return {
    tick: 0,
    createdAt: now,
    updatedAt: now,
    agents: AGENT_SEEDS.map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      provider: a.provider,
      x: a.startX,
      y: a.startY,
      hp: 100,
      hunger: 100,
      thirst: 100,
      alive: true,
      inventory: { machado: 1, pao: 2, agua: 2, sementes: 3, madeira: 0, carne: 0, peixe: 0 },
      lastThought: "Acabei de chegar em Robotville. Preciso entender onde estou.",
      lastAction: "chegou à vila",
      lastActionType: "esperar",
      lastActionTargetXY: null,
      lastSpokeTick: -1,
      activeMind: null,
      activeMindVibe: null,
      lastMessage: null,
      lastMessageTick: null,
      memory: { knownAgents: {}, rumors: [], selfLog: [], observations: [], trust: {}, longTerm: [], currentPlan: null, pendingBuild: null },
    })),
    trees: initialTrees(),
    crops: [],
    structures: [],
    animals: [],
    events: [{ tick: 0, text: "Robotville começou a existir: três agentes, um machado cada, dois pães, duas garrafas de água e algumas sementes." }],
  };
}
