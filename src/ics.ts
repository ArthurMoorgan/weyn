import type { Weyn } from "./api";

// Minimal RFC 5545 .ics generator — no library needed for one event's worth
// of fields. Client-side only: the event data is already in hand (Weyn),
// no backend round-trip required.
function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function downloadEventIcs(e: Weyn) {
  const start = icsDate(e.startsAt);
  // most events on Weyn have no explicit end time — default to 2h so the
  // calendar entry isn't a zero-length block
  const end = e.endsAt ? icsDate(e.endsAt) : icsDate(new Date(new Date(e.startsAt).getTime() + 2 * 3600e3).toISOString());
  const location = [e.venue, e.area].filter(Boolean).join(", ");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Weyn//Event//EN",
    "BEGIN:VEVENT",
    `UID:${e.id}@weynevents.com`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcs(e.title)}`,
    `LOCATION:${escapeIcs(location)}`,
    `DESCRIPTION:${escapeIcs(e.blurb || "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
