// One-off seed for example Venues + Reservations, run manually against
// production (`node scripts/seed-reservations.mjs`) — NOT wired into
// server startup like server/db.js's seedIfEmpty(). Uploads the generated
// cover photos to Vercel Blob via the same storage interface production
// uses, so the resulting /uploads/:key URLs work exactly like a real
// venue-application photo would.
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const { prisma } = await import("../server/db.js");
const { vercelStorage } = await import("../server/storage-vercel.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = "/private/tmp/claude-501/-Users-krishiv-Downloads-dhairya/50b5f3ff-306d-4dfb-a27a-482a6495aa12/scratchpad/venue-seed-images";

const OWNER_ID = "cmr4ggj7900048e1h49ao2cv5"; // dhairyarsaluja@gmail.com

function at(dayOffset, hour, min = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, min, 0, 0);
  return d;
}

const VENUES = [
  {
    key: "restaurant",
    file: "restaurant.png",
    name: "Sable & Salt",
    category: "restaurant",
    description: "Modern Omani-fusion dinner service in a warm, lattice-screened dining room — small plates built around the day's catch and slow-cooked lamb.",
    venue: "Way 3517, Qurum", area: "Qurum", lat: 23.6139, lng: 58.4913, distanceKm: 4.1,
    priceRange: "$$$", tags: ["dinner", "indoor", "date-night"],
    slots: [
      { dayOfWeek: 4, startTime: "19:00", endTime: "23:30", capacity: 40 },
      { dayOfWeek: 5, startTime: "19:00", endTime: "23:30", capacity: 40 },
      { dayOfWeek: 6, startTime: "19:00", endTime: "23:00", capacity: 30 },
    ],
  },
  {
    key: "cafe",
    file: "cafe.png",
    name: "Karak Social",
    category: "cafe",
    description: "Specialty coffee and karak by day, a laptop-friendly window counter, and a short all-day breakfast menu.",
    venue: "Al Khuwair Street", area: "Al Khuwair", lat: 23.5946, lng: 58.4092, distanceKm: 6.8,
    priceRange: "$", tags: ["coffee", "work-friendly", "breakfast"],
    slots: [
      { dayOfWeek: 0, startTime: "07:00", endTime: "22:00", capacity: 25 },
      { dayOfWeek: 1, startTime: "07:00", endTime: "22:00", capacity: 25 },
      { dayOfWeek: 2, startTime: "07:00", endTime: "22:00", capacity: 25 },
      { dayOfWeek: 3, startTime: "07:00", endTime: "22:00", capacity: 25 },
      { dayOfWeek: 4, startTime: "07:00", endTime: "22:00", capacity: 25 },
    ],
  },
  {
    key: "lounge",
    file: "lounge.png",
    name: "Nocturne Lounge",
    category: "lounge",
    description: "Velvet booths, a backlit bar, and a late-night menu — reservations recommended after 10pm on weekends.",
    venue: "Shatti Al Qurum Complex", area: "Shatti Al Qurum", lat: 23.6161, lng: 58.4384, distanceKm: 2.9,
    priceRange: "$$$", tags: ["nightlife", "21+", "indoor"],
    slots: [
      { dayOfWeek: 4, startTime: "21:00", endTime: "02:00", capacity: 60 },
      { dayOfWeek: 5, startTime: "21:00", endTime: "02:00", capacity: 60 },
    ],
  },
  {
    key: "rooftop",
    file: "rooftop.png",
    name: "Skyline Terrace",
    category: "rooftop",
    description: "Open-air dining above Al Mouj with string lights and a sunset-facing bar — book early for a rail-side table.",
    venue: "Al Mouj Marina", area: "Al Mouj", lat: 23.6285, lng: 58.2775, distanceKm: 8.4,
    priceRange: "$$", tags: ["outdoor", "sunset", "views"],
    slots: [
      { dayOfWeek: 3, startTime: "18:00", endTime: "23:30", capacity: 45 },
      { dayOfWeek: 4, startTime: "18:00", endTime: "23:30", capacity: 45 },
      { dayOfWeek: 5, startTime: "18:00", endTime: "23:30", capacity: 45 },
      { dayOfWeek: 6, startTime: "18:00", endTime: "23:00", capacity: 35 },
    ],
  },
  {
    key: "beach",
    file: "beach.png",
    name: "Tide Beach Club",
    category: "beach_club",
    description: "Daybeds and cabanas on the water at As Sifah, with a full-day food and drink menu — half-day and full-day slots available.",
    venue: "As Sifah Coast Road", area: "As Sifah", lat: 23.5372, lng: 58.7591, distanceKm: 19.2,
    priceRange: "$$", tags: ["outdoor", "beach", "family-friendly"],
    slots: [
      { dayOfWeek: 5, startTime: "09:00", endTime: "18:00", capacity: 80 },
      { dayOfWeek: 6, startTime: "09:00", endTime: "18:00", capacity: 80 },
    ],
  },
];

const GUESTS = [
  { name: "Amal Al Balushi", email: "amal.balushi@example.com", phone: "+968 9111 2233" },
  { name: "James Whitfield", email: "james.whitfield@example.com", phone: "+968 9222 3344" },
  { name: "Fatma Al Riyami", email: "fatma.riyami@example.com", phone: "+968 9333 4455" },
  { name: "Priya Nair", email: "priya.nair@example.com", phone: "+968 9444 5566" },
  { name: "Khalid Al Harthy", email: "khalid.harthy@example.com", phone: "+968 9555 6677" },
  { name: "Sara Thompson", email: "sara.thompson@example.com", phone: "+968 9666 7788" },
];

async function uploadCover(file) {
  const buf = fs.readFileSync(path.join(IMG_DIR, file));
  const { url } = await vercelStorage.saveImage(buf, ".png");
  return url;
}

async function main() {
  console.log("Uploading cover photos to Vercel Blob…");
  for (const v of VENUES) {
    v.coverUrl = await uploadCover(v.file);
    console.log(`  ${v.name} -> ${v.coverUrl}`);
  }

  for (const v of VENUES) {
    console.log(`Creating venue: ${v.name}`);
    const venue = await prisma.venue.create({
      data: {
        name: v.name, category: v.category, description: v.description,
        venue: v.venue, area: v.area, lat: v.lat, lng: v.lng, distanceKm: v.distanceKm,
        coverImage: v.coverUrl, photos: [v.coverUrl],
        priceRange: v.priceRange, tags: v.tags,
        ownerId: OWNER_ID, verified: true,
      },
    });

    const slots = [];
    for (const s of v.slots) {
      slots.push(await prisma.venueAvailabilitySlot.create({ data: { venueId: venue.id, ...s } }));
    }

    // A spread of reservations: two past (confirmed, for guest-history
    // testing), one upcoming confirmed, one upcoming pending, one cancelled.
    const slot = slots[0];
    const guests = [...GUESTS].sort(() => Math.random() - 0.5);
    const rows = [
      { guest: guests[0], status: "confirmed", date: at(-14, 0), partySize: 2, notes: null },
      { guest: guests[0], status: "confirmed", date: at(-5, 0), partySize: 4, notes: "Birthday, requested a corner table" },
      { guest: guests[1], status: "confirmed", date: at(2, 0), partySize: 2, notes: null },
      { guest: guests[2], status: "pending", date: at(3, 0), partySize: 6, notes: "Anniversary dinner" },
      { guest: guests[3], status: "cancelled", date: at(1, 0), partySize: 3, notes: null },
    ];
    for (const r of rows) {
      const time = slot.startTime;
      await prisma.reservation.create({
        data: {
          venueId: venue.id, slotId: slot.id,
          guestName: r.guest.name, guestEmail: r.guest.email, guestPhone: r.guest.phone,
          partySize: r.partySize, date: r.date, time, status: r.status, notes: r.notes,
        },
      });
    }
    console.log(`  ${slots.length} slots, ${rows.length} reservations created`);
  }

  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
