// Regression test for the PayTabs confirmation race (see app.js's
// confirmPaymentFromPayTabs): the webhook and the /api/bookings/:id poll can
// both reach the "mark paid + claim capacity + issue tickets" path for the
// same payment concurrently. The fix replaces a read-then-write guard with a
// single atomic `updateMany({ where: { status: { not: 'paid' } } })` and only
// lets the caller that actually flipped the row (count === 1) proceed.
//
// This drives the REAL confirmPaymentFromPayTabs closure — not a
// reimplementation of its logic — by mocking only what it's not our job to
// test (Prisma itself, the PayTabs network call) and hitting the real
// Express routes (POST /api/payments/webhook, GET /api/bookings/:id) that
// call it. node:test's module mocking needs the
// --experimental-test-module-mocks flag (see package.json's "test" script).
// The fake Prisma queues each "statement" through a single-slot lock so
// concurrent callers are serialized the same way a real Postgres row lock
// would serialize a concurrent `UPDATE ... WHERE status != 'paid'` — that's
// a property of the fake datastore, not of the code under test.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function makeFakeDb() {
  const payment = { id: "pay1", status: "pending", bookingId: "book1", paytabsTranRef: "tref1", rawWebhook: null };
  const booking = { id: "book1", eventId: "ev1", status: "pending", tierId: null, qty: 2, seatIds: [], email: null, deviceId: "dev1", accessToken: "tok" };
  let claimCalls = 0;
  let ticketsIssued = 0;
  let queue = Promise.resolve();

  const prisma = {
    payment: {
      async findUnique({ where }) {
        if (where.id) return where.id === payment.id ? clone(payment) : null;
        if (where.paytabsTranRef) return where.paytabsTranRef === payment.paytabsTranRef ? { ...clone(payment), booking: clone(booking) } : null;
        return null;
      },
      async update({ data }) { Object.assign(payment, data); return clone(payment); },
      // Mirrors prisma.payment.updateMany({ where: { id, status: { not: 'paid' } }, data }) —
      // queued through a single slot so concurrent calls serialize the same
      // way Postgres's row lock serializes a real concurrent atomic UPDATE.
      updateMany({ data }) {
        const run = queue.then(() => {
          if (payment.status !== "paid") { Object.assign(payment, data); return { count: 1 }; }
          return { count: 0 };
        });
        queue = run.then(() => {}, () => {});
        return run;
      },
    },
    booking: {
      async findUnique() { return clone(booking); },
      async update({ data }) { Object.assign(booking, data); return clone(booking); },
    },
    floorSeat: { async updateMany() { return { count: 0 }; } },
    ticket: { async createMany() { return { count: 0 }; } },
    event: { async update() {} },
  };

  const db = {
    async claimEventCapacity(eventId, qty) { claimCalls += 1; return { capacity: 100, sold: 50 + qty }; },
    async claimTierCapacity() { return null; },
    async issueTickets() { ticketsIssued += 1; },
    async get(eventId) { return { id: eventId, title: "Test Event", startsAt: new Date(Date.now() + 864e5).toISOString() }; },
    async audit() {},
    async getBooking(id) {
      if (id !== booking.id) return null;
      return { ...clone(booking), payment: clone(payment), event: { title: "Test Event" } };
    },
  };

  return { prisma, db, getClaimCalls: () => claimCalls, getTicketsIssued: () => ticketsIssued, getPaymentStatus: () => payment.status };
}

test("confirmPaymentFromPayTabs: concurrent webhook + booking-poll callers claim capacity exactly once", async () => {
  const fake = makeFakeDb();
  mock.module("./db.js", { namedExports: { db: fake.db, prisma: fake.prisma } });
  mock.module("./payments.js", {
    namedExports: {
      paytabsConfigured: () => true,
      verifyIpnSignature: () => true, // signature verification isn't what this test exercises
      // A real call to PayTabs takes long enough for the webhook and the
      // booking-status poll to genuinely overlap; a same-tick stub wouldn't
      // reliably force that overlap in-process, so this fake keeps a small
      // real delay to widen the window instead of asserting on timing.
      fetchTransactionStatus: async () => { await new Promise((r) => setTimeout(r, 20)); return { success: true, raw: {} }; },
      createCheckoutSession: async () => { throw new Error("not used in this test"); },
    },
  });

  const { createApp } = await import("./app.js");
  const app = createApp({});
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    // Three real concurrent callers racing for the same payment: two webhook
    // deliveries (PayTabs retries on timeout) and one booking-status poll —
    // exactly the race the comment in app.js describes.
    const webhook = () =>
      fetch(`http://127.0.0.1:${port}/api/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Signature: "irrelevant-mocked" },
        body: JSON.stringify({ tran_ref: "tref1" }),
      });
    const poll = () => fetch(`http://127.0.0.1:${port}/api/bookings/book1`);

    await Promise.all([webhook(), webhook(), poll()]);

    assert.equal(fake.getClaimCalls(), 1, "capacity must be claimed exactly once across all racing callers");
    assert.equal(fake.getTicketsIssued(), 1, "tickets must be issued exactly once");
    assert.equal(fake.getPaymentStatus(), "paid");
  } finally {
    server.close();
    mock.reset();
  }
});

test("confirmPaymentFromPayTabs: already-paid payment is a no-op for every caller", async () => {
  const fake = makeFakeDb();
  fake.prisma.payment.findUnique = async ({ where }) => {
    if (where.paytabsTranRef) return { id: "pay1", status: "paid", bookingId: "book1", paytabsTranRef: "tref1", booking: {} };
    return null;
  };
  mock.module("./db.js", { namedExports: { db: fake.db, prisma: fake.prisma } });
  mock.module("./payments.js", {
    namedExports: {
      paytabsConfigured: () => true,
      verifyIpnSignature: () => true,
      fetchTransactionStatus: async () => ({ success: true, raw: {} }),
      createCheckoutSession: async () => { throw new Error("not used in this test"); },
    },
  });

  const { createApp } = await import("./app.js");
  const app = createApp({});
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const webhook = () =>
      fetch(`http://127.0.0.1:${port}/api/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Signature: "irrelevant-mocked" },
        body: JSON.stringify({ tran_ref: "tref1" }),
      });
    await Promise.all([webhook(), webhook()]);

    assert.equal(fake.getClaimCalls(), 0, "an already-paid payment must never re-claim capacity");
  } finally {
    server.close();
    mock.reset();
  }
});
