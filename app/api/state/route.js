import { redis, WORLD_KEY } from "../../../lib/redis";
import { initialWorld } from "../../../lib/world";

export async function GET() {
  let world = await redis.get(WORLD_KEY);
  if (!world) {
    world = initialWorld();
    await redis.set(WORLD_KEY, world);
  }
  return Response.json(world);
}
