// Regression test for the PayTabs confirmation race (see app.js's
// confirmPaymentFromPayTabs): the webhook and the /api/bookings/:id poll can
// both reach the "mark paid + claim capacity + issue tickets" path for the
// same payment concurrently. The fix replaces a read-then-write guard with a
// single atomic `updateMany({ where: { status: { not: 'paid' } } })` and only
// lets the caller that actually flipped the row (count === 1) proceed.
//
// confirmPaymentFromPayTabs itself is a closure inside createApp() and isn't
// exported, so this doesn't drive the real Express route or a real Postgres
// row lock (no PayTabs sandbox or test DB is configured in this environment).
// Instead it models the exact conditional-update contract Prisma/Postgres
// give us — `updateMany` on a WHERE clause is a single atomic statement, so
// of any number of concurrent callers, exactly one can ever see count === 1
// for a given row — and exercises it under real concurrent interleaving to
// confirm the "only the winner proceeds" logic in confirmPaymentFromPayTabs
// is sound.
import { test } from "node:test";
import assert from "node:assert/strict";

// Fake row store standing in for the payments table. A real Postgres
// `UPDATE ... WHERE status != 'paid'` takes a row lock for the duration of
// the statement, so concurrent executions are serialized by the DB even
// though the calling Node processes are concurrent. We simulate that by
// queueing each "statement" through a single-slot lock instead of allowing
// the read-and-write inside it to interleave.
function makeFakePaymentsTable(initialStatus) {
  let row = { status: initialStatus };
  let queue = Promise.resolve();
  return {
    // Mirrors prisma.payment.updateMany({ where: { status: { not: 'paid' } }, data: { status: 'paid' } })
    updateManyIfNotPaid() {
      const run = queue.then(() => {
        if (row.status !== "paid") {
          row.status = "paid";
          return { count: 1 };
        }
        return { count: 0 };
      });
      // Chain the queue so the next caller's "statement" only runs after
      // this one has fully applied — this is what a real row lock gives us.
      queue = run.then(() => {}, () => {});
      return run;
    },
    getStatus: () => row.status,
  };
}

// Mirrors the shape of confirmPaymentFromPayTabs after the fix: fetch status
// (async, can interleave), then win-or-lose the atomic transition, then only
// the winner claims capacity + issues a ticket.
async function confirmOnce(table, claimCapacity) {
  await Promise.resolve(); // stand-in for the awaited fetchTransactionStatus call
  const { count } = await table.updateManyIfNotPaid();
  if (count !== 1) return { claimed: false };
  await claimCapacity();
  return { claimed: true };
}

test("confirmPaymentFromPayTabs pattern: concurrent confirmations claim capacity exactly once", async () => {
  const table = makeFakePaymentsTable("pending");
  let claims = 0;
  const claimCapacity = async () => {
    claims += 1;
  };

  // Simulate the webhook and the booking-status poll racing for the same
  // tranRef at the same time.
  const results = await Promise.all([
    confirmOnce(table, claimCapacity),
    confirmOnce(table, claimCapacity),
    confirmOnce(table, claimCapacity),
  ]);

  assert.equal(claims, 1, "capacity must be claimed exactly once across all racing calls");
  assert.equal(results.filter((r) => r.claimed).length, 1, "exactly one caller should win the transition");
  assert.equal(table.getStatus(), "paid");
});

test("confirmPaymentFromPayTabs pattern: already-paid payment is a no-op for every caller", async () => {
  const table = makeFakePaymentsTable("paid");
  let claims = 0;
  const claimCapacity = async () => {
    claims += 1;
  };

  const results = await Promise.all([confirmOnce(table, claimCapacity), confirmOnce(table, claimCapacity)]);

  assert.equal(claims, 0);
  assert.ok(results.every((r) => !r.claimed));
});
