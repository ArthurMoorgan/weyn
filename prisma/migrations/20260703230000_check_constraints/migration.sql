-- Defense-in-depth: these hold true regardless of what the application
-- layer does, so a future bug in atomic-claim logic (or a raw SQL mistake)
-- can never write invalid state to disk. This is the practical equivalent
-- of Postgres Row Level Security for a single-trust-boundary app (only the
-- Express server ever connects to this database with one service role) —
-- RLS is designed for multiple untrusted roles querying Postgres directly,
-- which doesn't apply here; CHECK constraints give the same "the database
-- itself refuses bad data" guarantee without that architecture.
ALTER TABLE "Event" ADD CONSTRAINT "Event_sold_nonnegative" CHECK ("sold" >= 0);
ALTER TABLE "Event" ADD CONSTRAINT "Event_sold_within_capacity" CHECK ("sold" <= "capacity");
ALTER TABLE "Event" ADD CONSTRAINT "Event_capacity_positive" CHECK ("capacity" > 0);
ALTER TABLE "Event" ADD CONSTRAINT "Event_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "Event" ADD CONSTRAINT "Event_minAge_nonnegative" CHECK ("minAge" >= 0);

ALTER TABLE "Tier" ADD CONSTRAINT "Tier_sold_nonnegative" CHECK ("sold" >= 0);
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_sold_within_capacity" CHECK ("sold" <= "capacity");
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_capacity_positive" CHECK ("capacity" > 0);
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_price_nonnegative" CHECK ("price" >= 0);

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_nonnegative" CHECK ("amount" >= 0);
