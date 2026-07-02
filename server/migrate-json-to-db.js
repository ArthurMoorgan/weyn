// One-time migration: server/data.json -> Postgres (via Prisma).
// Run by hand once before cutover: node server/migrate-json-to-db.js
// Safe to skip entirely if you're starting fresh — db.js seeds the DB
// automatically on first boot when it's empty.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(process.env.DATA_DIR || __dirname, "data.json");

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log(`[migrate] No ${DATA_FILE} found — nothing to migrate.`);
    return;
  }
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const events = raw.events || [];
  const bookings = raw.bookings || [];
  const pushTokens = raw.pushTokens || [];
  const marketingAssets = raw.marketingAssets || [];

  let eventCount = 0, tierCount = 0;
  for (const e of events) {
    const { tiers, ...rest } = e;
    await prisma.event.upsert({
      where: { id: e.id },
      create: {
        ...rest,
        startsAt: new Date(e.startsAt),
        endsAt: e.endsAt ? new Date(e.endsAt) : null,
        cancelled: !!e.cancelled,
        tags: e.tags || [],
      },
      update: {},
    });
    eventCount++;
    if (Array.isArray(tiers)) {
      for (const t of tiers) {
        await prisma.tier.upsert({
          where: { id: t.id },
          create: { ...t, eventId: e.id },
          update: {},
        });
        tierCount++;
      }
    }
  }

  let bookingCount = 0;
  for (const b of bookings) {
    // old data.json bookings had no id/status — these were all free, already-confirmed RSVPs
    await prisma.booking.create({
      data: {
        eventId: b.eventId,
        deviceId: b.deviceId,
        email: b.email || null,
        name: b.name || null,
        status: "paid",
        reminded: !!b.reminded,
        bookedAt: new Date(b.bookedAt),
      },
    });
    bookingCount++;
  }

  for (const t of pushTokens) {
    await prisma.pushToken.upsert({
      where: { deviceId: t.deviceId },
      create: { deviceId: t.deviceId, token: t.token, platform: t.platform || "ios", registeredAt: new Date(t.registeredAt) },
      update: {},
    });
  }

  for (const m of marketingAssets) {
    const { eventId, ...copy } = m;
    await prisma.marketingAsset.upsert({ where: { eventId }, create: { eventId, ...copy }, update: {} });
  }

  console.log(`[migrate] Done: ${eventCount} events, ${tierCount} tiers, ${bookingCount} bookings, ${pushTokens.length} push tokens, ${marketingAssets.length} marketing assets.`);
}

main().then(() => prisma.$disconnect()).catch(async (err) => {
  console.error("[migrate] Failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
