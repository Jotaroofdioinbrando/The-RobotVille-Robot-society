import { redis, WORLD_KEY } from "../../../lib/redis";
import { initialWorld } from "../../../lib/world";
import { runTick } from "../../../lib/tick";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function checkSecret(req) {
  const header = req.headers.get("x-tick-secret");
  const url = new URL(req.url);
  const query = url.searchParams.get("secret");
  const provided = header || query;
  return provided && process.env.TICK_SECRET && provided === process.env.TICK_SECRET;
}

export async function POST(req) {
  if (!checkSecret(req)) {
    return new Response("unauthorized", { status: 401 });
  }
  let world = await redis.get(WORLD_KEY);
  if (!world) world = initialWorld();
  world = await runTick(world);
  await redis.set(WORLD_KEY, world);
  return Response.json({ ok: true, tick: world.tick });
}
