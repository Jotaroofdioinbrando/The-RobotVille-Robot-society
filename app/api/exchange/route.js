import { redis, WORLD_KEY } from "../../../lib/redis";
import { initialWorld } from "../../../lib/world";
import { runExchange } from "../../../lib/tick";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Mesma senha do /api/tick (TICK_SECRET) — não precisa de segredo separado.
function checkSecret(req) {
  const header = req.headers.get("x-tick-secret");
  const url = new URL(req.url);
  const query = url.searchParams.get("secret");
  const provided = header || query;
  return provided && process.env.TICK_SECRET && provided === process.env.TICK_SECRET;
}

// Ciclo rápido, só de conversa: os agentes respondem mensagens pendentes uns
// dos outros, sem decair fome/sede nem gastar recursos. Pensado pra rodar num
// cron separado, mais frequente que o /api/tick principal, pra que as
// conversas fiquem resolvidas ANTES do próximo ciclo de verdade.
export async function POST(req) {
  if (!checkSecret(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  let world = await redis.get(WORLD_KEY);
  if (!world) world = initialWorld();
  world = await runExchange(world);
  await redis.set(WORLD_KEY, world);
  return Response.json({ ok: true, tick: world.tick });
}
