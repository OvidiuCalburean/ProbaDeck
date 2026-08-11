import {
  PricingPlanManagerClient,
  paginateListSubscriptions,
} from "@aws-sdk/client-pricing-plan-manager";

import { validateFreeCloudFrontSubscription } from "./pricing-plan.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

const expectedResourceArns = requiredEnvironment("AWS_PRICING_PLAN_RESOURCE_ARNS")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const client = new PricingPlanManagerClient({ region: "us-east-1" });
const distributionArn = expectedResourceArns.find((arn) => arn.includes(":cloudfront::"));
if (distributionArn === undefined) {
  throw new Error("AWS_PRICING_PLAN_RESOURCE_ARNS must include the CloudFront distribution ARN");
}

const subscriptions = [];
for await (const output of paginateListSubscriptions({ client }, {})) {
  subscriptions.push(...(output.subscriptionSummaries ?? []));
}

const matches = subscriptions.filter((subscription) =>
  subscription.resourceArns?.includes(distributionArn),
);
if (matches.length !== 1) {
  throw new Error(
    `Expected one pricing plan for ${distributionArn}, found ${String(matches.length)}`,
  );
}

const subscription = matches[0];
if (subscription === undefined) throw new Error("Pricing plan lookup returned no subscription");
const errors = validateFreeCloudFrontSubscription(subscription, expectedResourceArns);

if (errors.length > 0) {
  for (const error of errors) console.error(`Pricing plan validation failed: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Verified active CloudFront FREE flat-rate plan ${subscription.arn ?? "unknown"} and expected resource coverage.`,
  );
}
