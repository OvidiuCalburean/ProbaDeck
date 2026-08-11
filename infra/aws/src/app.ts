import { App } from "aws-cdk-lib";

import { SiteStack } from "./site-stack.js";

function requiredContext(app: App, name: string): string {
  const value = app.node.tryGetContext(name) as unknown;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required CDK context: ${name}`);
  }
  return value;
}

const app = new App();
const publishDns = app.node.tryGetContext("publishDns") === "true";

void new SiteStack(app, "ProbaDeckWebsite", {
  billingAlertEmail: requiredContext(app, "billingAlertEmail"),
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
  githubOidcProviderArn: requiredContext(app, "githubOidcProviderArn"),
  githubOwner: "OvidiuCalburean",
  githubRepository: "ProbaDeck",
  hostedZoneId: requiredContext(app, "hostedZoneId"),
  publishDns,
});
