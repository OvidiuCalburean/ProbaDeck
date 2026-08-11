import type { Subscription } from "@aws-sdk/client-pricing-plan-manager";

export function validateFreeCloudFrontSubscription(
  subscription: Subscription | undefined,
  expectedResourceArns: readonly string[],
): readonly string[] {
  const errors: string[] = [];
  if (subscription === undefined) return ["Pricing plan subscription was not returned by AWS"];

  if (subscription.planFamily !== "CloudFront") {
    errors.push(
      `Expected CloudFront plan family, received ${subscription.planFamily ?? "missing"}`,
    );
  }
  if (subscription.planTier !== "FREE") {
    errors.push(`Expected FREE plan tier, received ${subscription.planTier ?? "missing"}`);
  }
  if (subscription.status !== "ACTIVE") {
    errors.push(`Expected ACTIVE plan status, received ${subscription.status ?? "missing"}`);
  }
  if (subscription.scheduledChange !== undefined) {
    errors.push(`Pricing plan has a pending ${subscription.scheduledChange.changeType} change`);
  }

  const resources = new Set(subscription.resourceArns ?? []);
  for (const expectedArn of expectedResourceArns) {
    if (!resources.has(expectedArn)) errors.push(`Pricing plan does not cover ${expectedArn}`);
  }
  return errors;
}
