import assert from "node:assert/strict";
import test from "node:test";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { SiteStack } from "../dist/site-stack.js";

function template(options = {}) {
  const app = new App();
  const stack = new SiteStack(app, "TestStack", {
    billingAlertEmail: "alerts@example.com",
    env: { account: "123456789012", region: "us-east-1" },
    githubOidcProviderArn:
      "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com",
    githubOwner: "OvidiuCalburean",
    githubRepository: "ProbaDeck",
    hostedZoneId: "Z00000000000000000000",
    ...options,
  });
  return Template.fromStack(stack);
}

await test("uses one private S3 origin with CloudFront OAC and no server compute", () => {
  const synthesized = template();
  synthesized.resourceCountIs("AWS::S3::Bucket", 1);
  synthesized.resourceCountIs("AWS::CloudFront::Distribution", 1);
  synthesized.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
  synthesized.resourceCountIs("AWS::Lambda::Function", 0);
  synthesized.resourceCountIs("AWS::CloudFront::ResponseHeadersPolicy", 0);
  synthesized.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});

await test("enforces HTTPS, WAF protection, ACM, aliases, and an account budget", () => {
  const synthesized = template({ publishDns: true });
  synthesized.resourceCountIs("AWS::CertificateManager::Certificate", 1);
  synthesized.resourceCountIs("AWS::WAFv2::WebACL", 1);
  synthesized.resourceCountIs("AWS::Route53::RecordSet", 4);
  synthesized.resourceCountIs("AWS::Budgets::Budget", 1);
  synthesized.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      Aliases: ["probadeck.com", "www.probadeck.com"],
      Enabled: true,
      HttpVersion: "http2and3",
      IPV6Enabled: true,
      ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: "TLSv1.2_2021" }),
    }),
  });
});

await test("keeps public DNS unpublished during the pricing-plan bootstrap", () => {
  const synthesized = template();
  synthesized.resourceCountIs("AWS::Route53::RecordSet", 0);
  synthesized.hasOutput("PublicDnsEnabled", { Value: "false" });
});

await test("limits CI to publishing and denies pricing-plan mutations", () => {
  const synthesized = template();
  synthesized.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith(["pricingplanmanager:ListSubscriptions"]),
          Effect: "Allow",
        }),
        Match.objectLike({
          Action: Match.arrayWith(["pricingplanmanager:UpdateSubscription"]),
          Effect: "Deny",
        }),
      ]),
    },
  });
  const json = JSON.stringify(synthesized.toJSON());
  assert.doesNotMatch(json, /ec2:|rds:|lambda:/i);
});
