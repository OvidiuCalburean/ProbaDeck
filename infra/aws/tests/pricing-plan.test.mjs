import assert from "node:assert/strict";
import test from "node:test";

import { validateFreeCloudFrontSubscription } from "../dist/pricing-plan.js";

const distributionArn = "arn:aws:cloudfront::123456789012:distribution/EXAMPLE";

function subscription(overrides = {}) {
  return {
    arn: "arn:aws:pricingplanmanager::123456789012:subscription/sub-example",
    createdAt: new Date(0),
    planFamily: "CloudFront",
    planTier: "FREE",
    resourceArns: [distributionArn],
    status: "ACTIVE",
    updatedAt: new Date(0),
    ...overrides,
  };
}

await test("accepts an active free CloudFront plan covering the distribution", () => {
  assert.deepEqual(validateFreeCloudFrontSubscription(subscription(), [distributionArn]), []);
});

await test("rejects paid, inactive, changing, or incomplete plans", () => {
  const errors = validateFreeCloudFrontSubscription(
    subscription({
      planTier: "PRO",
      resourceArns: [],
      scheduledChange: { changeType: "CANCELLATION" },
      status: "SYNC_IN_PROGRESS",
    }),
    [distributionArn],
  );
  assert.equal(errors.length, 4);
  assert.ok(errors.some((error) => error.includes("FREE")));
  assert.ok(errors.some((error) => error.includes("ACTIVE")));
  assert.ok(errors.some((error) => error.includes("CANCELLATION")));
  assert.ok(errors.some((error) => error.includes(distributionArn)));
});
