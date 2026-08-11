# ProbaDeck AWS deployment

This stack hosts the static output from `examples/showcase` at `https://probadeck.com` and
redirects `www.probadeck.com` to the apex domain. It creates:

- one private, public-access-blocked S3 bucket;
- one CloudFront distribution using Origin Access Control;
- a dedicated five-rule AWS WAF web ACL;
- a non-exportable public ACM certificate for the apex and `www` names;
- optional Route 53 A/AAAA aliases, held back during bootstrap;
- a GitHub Actions OIDC deploy role with publish-only permissions; and
- a free, notification-only, account-wide monthly budget with alerts at $1, $5, and $10.

The stack is deployed in `us-east-1` because CloudFront requires its ACM viewer certificate there.
It uses a bootstrapless CDK synthesizer: there is no CDK assets bucket, ECR repository, or bootstrap
role to leave behind.

## Cost boundary

AWS does not offer a universal hard invoice cap. The design therefore makes the CloudFront FREE
plan a fail-closed deployment prerequisite and avoids services known to create open-ended runtime
costs.

The plan covers the associated CloudFront distribution, WAF web ACL and rules, attached Route 53
hosted zone, TLS certificate, CloudFront Function, and an S3 Standard storage credit. AWS documents
no overage charges for CloudFront-plan traffic spikes or attacks. This repository deliberately does
not enable Lambda@Edge, real-time logs, DNS query logs, DNSSEC/KMS, health checks, custom metrics,
WAF CAPTCHA JavaScript APIs, or any server compute.

There can still be small pay-as-you-go charges outside the plan, principally S3 API requests from
cache misses and deployment uploads. The private origin, cache policy, WAF managed rules, rate
limit, 3.1 MB current build, 50 MB bundle ceiling, and 500-file ceiling reduce that exposure. The
production job enforces both ceilings before any S3 write. The budget is an alert, not a hard stop,
and AWS budget data can be delayed. The workflow cannot alter, cancel, or upgrade the pricing plan;
IAM explicitly denies those actions.

## Prerequisites

Do not create the stack until all of these are true:

1. The AWS account is a paid account. AWS Free Tier accounts are not eligible for CloudFront
   flat-rate plans.
2. `probadeck.com` has a public Route 53 hosted zone in the same account and fewer than the Free
   plan's 50-record limit.
3. You know the email address that should receive the $1/$5/$10 budget notifications.
4. The AWS account has a GitHub Actions OIDC identity provider for
   `https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`. Reuse the
   provider if it already exists; IAM OIDC providers are account-wide.
5. Your local AWS credentials can create CloudFormation, CloudFront, WAF, S3, ACM, Route 53, IAM,
   and Budgets resources for this one-time deployment.

Useful read-only discovery commands:

```sh
aws sts get-caller-identity
aws route53 list-hosted-zones-by-name --dns-name probadeck.com --max-items 1
aws iam list-open-id-connect-providers
```

If the GitHub provider is missing, add it in IAM > Identity providers > Add provider. Stop if the
hosted zone is in another account, the account is an AWS Free Tier account, or the intended AWS
account ID is not the one returned by STS.

## Phase 1: create infrastructure without publishing DNS

Install and verify locally first:

```sh
pnpm install --frozen-lockfile
pnpm check:showcase
pnpm check:infra
```

Set these shell variables to the reviewed account-specific values:

```sh
export PROBADECK_HOSTED_ZONE_ID="Z..."
export PROBADECK_BILLING_ALERT_EMAIL="you@example.com"
export PROBADECK_GITHUB_OIDC_PROVIDER_ARN="arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
```

Build and deploy with DNS explicitly disabled. Review the IAM/security prompt from CDK rather than
using `--require-approval never`.

```sh
pnpm build:infra
pnpm --filter @probadeck/aws-infra exec cdk deploy ProbaDeckWebsite \
  -c hostedZoneId="$PROBADECK_HOSTED_ZONE_ID" \
  -c billingAlertEmail="$PROBADECK_BILLING_ALERT_EMAIL" \
  -c githubOidcProviderArn="$PROBADECK_GITHUB_OIDC_PROVIDER_ARN" \
  -c publishDns=false
```

The deployment creates the certificate's DNS validation record, but it does not create the public
apex or `www` aliases. Record every CloudFormation output:

```sh
aws cloudformation describe-stacks \
  --stack-name ProbaDeckWebsite \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
```

## Phase 2: activate and verify the Free plan

In the CloudFront console, open the new distribution, update its pricing plan to **Free**, and wait
until it is active. In **Manage plan**, attach both the dedicated WAF web ACL and the existing
`probadeck.com` Route 53 hosted zone. Do not select Pro, Business, or Premium.

Use the `PricingPlanResourceArns` stack output for the local fail-closed verification:

```sh
export AWS_PRICING_PLAN_RESOURCE_ARNS="distribution-arn,waf-arn,hosted-zone-arn"
pnpm --filter @probadeck/aws-infra verify:plan
```

This command must report exactly one active `CloudFront` / `FREE` subscription, no pending plan
change, and coverage of all three resource ARNs. Do not publish DNS if it fails.

## Phase 3: publish DNS

Run the same deployment with `publishDns=true` only after Phase 2 passes:

```sh
pnpm --filter @probadeck/aws-infra exec cdk deploy ProbaDeckWebsite \
  -c hostedZoneId="$PROBADECK_HOSTED_ZONE_ID" \
  -c billingAlertEmail="$PROBADECK_BILLING_ALERT_EMAIL" \
  -c githubOidcProviderArn="$PROBADECK_GITHUB_OIDC_PROVIDER_ARN" \
  -c publishDns=true
```

Confirm the `PublicDnsEnabled` output is `true`. ACM renews the in-use, DNS-validated certificate
automatically while its validation record remains in Route 53.

## Phase 4: configure the GitHub pipeline

Create a GitHub environment named `production`. Add these **environment variables** from the stack
outputs:

| GitHub variable                  | CloudFormation output      |
| -------------------------------- | -------------------------- |
| `AWS_DEPLOY_ROLE_ARN`            | `DeployRoleArn`            |
| `SITE_BUCKET`                    | `SiteBucketName`           |
| `CLOUDFRONT_DISTRIBUTION_ID`     | `CloudFrontDistributionId` |
| `ACM_CERTIFICATE_ARN`            | `CertificateArn`           |
| `AWS_PRICING_PLAN_RESOURCE_ARNS` | `PricingPlanResourceArns`  |

No long-lived AWS access key is used or stored in GitHub. The role only trusts the
`OvidiuCalburean/ProbaDeck` repository when the job uses the `production` environment.

Run **Deploy static website** manually once. On pushes to `main`, it then:

1. assumes the narrow AWS role with a short-lived OIDC credential;
2. refuses to continue unless the Free plan covers all expected resources;
3. refuses to continue unless ACM reports the certificate as `ISSUED`;
4. builds the static site, synchronizes it to S3, and removes stale objects; and
5. invalidates one `/*` CloudFront path.

The Monday schedule performs only the Free-plan and certificate checks. It never uploads or
invalidates content. Enable GitHub Actions failure notifications so a failed safety check is seen.

## Rollback

Revert the bad website commit on `main` and let the same workflow republish. S3 versioning is
intentionally disabled to keep retained storage bounded; Git is the rollback source of truth.

Never cancel the Free plan while DNS points at the distribution. AWS says Free-plan cancellation
is immediate and associated resources then return to pay-as-you-go pricing.
