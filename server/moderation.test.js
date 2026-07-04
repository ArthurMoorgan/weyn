// Smoke tests for the trust & safety pipeline's pure logic (no DB/AI calls —
// see server/moderation.js). This is the first automated test coverage in
// the repo (per the engineering audit's #1 finding: zero tests anywhere).
// Deliberately scoped to what's cheap and high-value to test without a test
// framework dependency: node:test is built into Node 18+.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runRuleEngine, computeDiscoveryStatus } from "./moderation.js";

const validDraft = () => ({
  title: "Mutrah Night Food Market",
  blurb: "Twenty stalls along the water — shawarma, grilled hammour, karak.",
  venue: "Mutrah Corniche",
  area: "Mutrah",
  startsAt: new Date(Date.now() + 864e5).toISOString(),
  price: 0,
  capacity: 100,
});

test("runRuleEngine: valid draft has no hard fails", () => {
  const r = runRuleEngine(validDraft());
  assert.deepEqual(r.hardFail, []);
});

test("runRuleEngine: missing title hard-fails", () => {
  const r = runRuleEngine({ ...validDraft(), title: "" });
  assert.ok(r.hardFail.includes("missing_title"));
});

test("runRuleEngine: missing location hard-fails", () => {
  const r = runRuleEngine({ ...validDraft(), venue: "", area: "" });
  assert.ok(r.hardFail.includes("missing_location"));
});

test("runRuleEngine: past date hard-fails", () => {
  const r = runRuleEngine({ ...validDraft(), startsAt: new Date(Date.now() - 864e5).toISOString() });
  assert.ok(r.hardFail.includes("date_in_past"));
});

test("runRuleEngine: negative price hard-fails", () => {
  const r = runRuleEngine({ ...validDraft(), price: -5 });
  assert.ok(r.hardFail.includes("negative_price"));
});

test("runRuleEngine: zero/negative capacity hard-fails", () => {
  const r = runRuleEngine({ ...validDraft(), capacity: 0 });
  assert.ok(r.hardFail.includes("invalid_capacity"));
});

test("runRuleEngine: suspicious shortener URL soft-fails, doesn't hard-fail", () => {
  const r = runRuleEngine({ ...validDraft(), blurb: "details at bit.ly/xyz123" });
  assert.deepEqual(r.hardFail, []);
  assert.ok(r.softFail.includes("suspicious_url"));
});

test("runRuleEngine: no image/short blurb only produce warnings, not fails", () => {
  const r = runRuleEngine({ ...validDraft(), blurb: "" });
  assert.deepEqual(r.hardFail, []);
  assert.ok(r.warnings.includes("very_short_blurb"));
});

test("computeDiscoveryStatus: clean high scores -> APPROVED", () => {
  const status = computeDiscoveryStatus(
    { quality_score: 80, trust_score: 90, spam_risk: 0, fraud_risk: 0, confidence: 90 },
    { hardFail: [], softFail: [], warnings: [] }
  );
  assert.equal(status, "APPROVED");
});

test("computeDiscoveryStatus: low quality/trust alone still APPROVED (growth-priority tuning)", () => {
  const status = computeDiscoveryStatus(
    { quality_score: 10, trust_score: 15, spam_risk: 0, fraud_risk: 0, confidence: 90 },
    { hardFail: [], softFail: [], warnings: [] }
  );
  assert.equal(status, "APPROVED");
});

test("computeDiscoveryStatus: high fraud_risk -> DISCOVERY_BLOCKED", () => {
  const status = computeDiscoveryStatus(
    { quality_score: 50, trust_score: 50, spam_risk: 20, fraud_risk: 85, confidence: 95 },
    { hardFail: [], softFail: [], warnings: [] }
  );
  assert.equal(status, "DISCOVERY_BLOCKED");
});

test("computeDiscoveryStatus: moderate fraud_risk -> MANUAL_REVIEW", () => {
  const status = computeDiscoveryStatus(
    { quality_score: 50, trust_score: 50, spam_risk: 20, fraud_risk: 60, confidence: 95 },
    { hardFail: [], softFail: [], warnings: [] }
  );
  assert.equal(status, "MANUAL_REVIEW");
});

test("computeDiscoveryStatus: hard-fail rule flags force DISCOVERY_BLOCKED", () => {
  const status = computeDiscoveryStatus(
    { quality_score: 90, trust_score: 90, spam_risk: 0, fraud_risk: 0, confidence: 100 },
    { hardFail: ["missing_title"], softFail: [], warnings: [] }
  );
  assert.equal(status, "DISCOVERY_BLOCKED");
});
