// Zod schemas for the routes that accept a body. Replaces hand-rolled inline
// `if (!b.title...)` checks with one consistent, testable layer — see the
// audit's "no validation library" finding. Kept intentionally permissive
// where the deterministic cleanup in refine.js already sanitizes (title,
// blurb) — this layer's job is to reject garbage/wrong-shape input, not to
// duplicate refine.js's polish logic.
import { z } from "zod";

// mirrors server/db.js's CATEGORY_SEED keys
export const CATEGORY_KEYS = ["music", "sports", "food", "culture", "cars", "workshop", "community"];
export const TICKETING_TYPES = ["weyn", "external", "cash", "registration", "organizer_payment"];

export const createEventSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  venue: z.string().trim().min(1, "Venue is required").max(120),
  organizer: z.string().trim().max(80).optional(),
  cat: z.enum(CATEGORY_KEYS).optional(),
  blurb: z.string().trim().max(1000).optional(),
  area: z.string().trim().max(80).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional().nullable(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  distanceKm: z.coerce.number().min(0).optional(),
  price: z.coerce.number().min(0).optional(),
  capacity: z.coerce.number().int().min(1).optional(),
  color: z.string().trim().max(20).optional(),
  glyph: z.string().trim().max(8).optional(),
  tags: z.string().optional(), // comma-separated at the wire level, split server-side
  refundPolicy: z.string().trim().max(200).optional(),
  minAge: z.coerce.number().int().min(0).max(99).optional(),
  ticketingType: z.enum(TICKETING_TYPES).optional(),
  externalTicketUrl: z.string().trim().max(500).optional(),
  organizerContact: z.string().trim().max(200).optional(),
  paymentLinkUrl: z.string().trim().max(500).optional(),
  transferDetails: z.string().trim().max(1000).optional(),
  sourceUrl: z.string().trim().max(500).optional(),
  importedFromInstagram: z.union([z.boolean(), z.string()]).optional(),
  existingImage: z.string().optional(),
  tiers: z.string().optional(), // JSON-encoded array at the wire level
}).passthrough(); // multipart form fields the server doesn't care about (e.g. multer's own keys) shouldn't 400 the request

export const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  blurb: z.string().trim().max(1000).optional(),
  price: z.coerce.number().min(0).optional(),
  capacity: z.coerce.number().int().min(1).optional(),
  startsAt: z.string().optional(),
  refundPolicy: z.string().trim().max(200).optional(),
  venue: z.string().trim().min(1).max(120).optional(),
  area: z.string().trim().max(80).optional(),
  minAge: z.coerce.number().int().min(0).max(99).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  ticketingType: z.enum(TICKETING_TYPES).optional(),
  externalTicketUrl: z.string().trim().max(500).optional(),
  organizerContact: z.string().trim().max(200).optional(),
  paymentLinkUrl: z.string().trim().max(500).optional(),
  transferDetails: z.string().trim().max(1000).optional(),
  reminderSchedule: z.array(z.coerce.number().int().min(1).max(720)).max(5).optional(),
  accentColor: z.string().trim().max(7).nullable().optional(),
});

// Express middleware factory: validates `req.body` against `schema`, replaces
// it with the parsed (coerced/defaulted) result, or 400s with field-level errors.
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Please check the highlighted fields",
          fields: result.error.flatten().fieldErrors,
        },
      });
    }
    req.body = result.data;
    next();
  };
}
