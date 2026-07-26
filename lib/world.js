// Mundo de Robotville: grade, terrenos, recursos e estado inicial.

export const GRID_SIZE = 24; // mapa maior (era 16)
export const VISION_RADIUS = 4; // até onde um agente enxerga
export const TREE_MAX_WOOD = 3;
export const TREE_REGEN_TICKS = 25;
export const CROP_GROWTH_TICKS = 18;
export const WATER_CAPACITY = 4;
export const HUNGER_THIRST_DECAY = 4;
export const TICKS_PER_DAY = 20; // duração de um "dia" completo em ciclos
export const NIGHT_TICKS = 6; // últimos N ciclos de cada dia são noite

export function isNight(tick) {
  return tick % TICKS_PER_DAY >= TICKS_PER_DAY - NIGHT_TICKS;
}

// Tipos de estrutura que dá pra construir, custo em madeira e o que cada uma faz.
export const STRUCTURE_TYPES = {
  abrigo: { cost: 3, decayDivisor: 2, hpRegen: 3, desc: "reduz o gasto de fome/sede pela metade e regenera HP enquanto você estiver em cima" },
  casa: { cost: 6, decayDivisor: 3, hpRegen: 4, desc: "como o abrigo, mas mais forte — é seu lar permanente, reduz o gasto de fome/sede a 1/3 e regenera mais HP" },
  cerca: { cost: 2, decayDivisor: 1, hpRegen: 0, theftProtection: true, desc: "não ajuda fome/sede, mas dificulta muito que roubem de você enquanto estiver perto dela" },
  fogueira: { cost: 2, decayDivisor: 1, hpRegen: 0, gathering: true, desc: "não ajuda sobrevivência sozinha, mas é o ponto de encontro da tribo à noite — comer/beber/conversar perto dela fortalece amizades" },
};

// Zonas (proporcionais ao tamanho do mapa, pra facilitar mudar GRID_SIZE no futuro):
// floresta no canto superior-esquerdo, rio no canto inferior-direito, vila no centro.
export const FOREST_MAX = Math.round(GRID_SIZE * 0.2); // 0..FOREST_MAX é floresta
export const RIVER_MIN = GRID_SIZE - 1 - Math.round(GRID_SIZE * 0.2); // RIVER_MIN..fim é rio
const VILLAGE_HALF = Math.round(GRID_SIZE * 0.08);
export const VILLAGE_CENTER = Math.floor(GRID_SIZE / 2);
export const VILLAGE_MIN = VILLAGE_CENTER - VILLAGE_HALF;
export const VILLAGE_MAX = VILLAGE_CENTER + VILLAGE_HALF;

export function terrainAt(x, y) {
  if (x <= FOREST_MAX && y <= FOREST_MAX) return "floresta";
  if (x >= RIVER_MIN && y >= RIVER_MIN) return "rio";
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
  { id: "groq", name: "GROQ", color: "#9B7BFF", provider: "groq", startX: VILLAGE_CENTER + 1, startY: VILLAGE_CENTER },
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
      memory: { knownAgents: {}, rumors: [], selfLog: [], observations: [], trust: {}, longTerm: [], currentPlan: null },
    })),
    trees: initialTrees(),
    crops: [],
    structures: [],
    events: [{ tick: 0, text: "Robotville começou a existir: três agentes, um machado cada, dois pães, duas garrafas de água e algumas sementes." }],
  };
}
