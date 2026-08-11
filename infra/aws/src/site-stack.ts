import {
  BootstraplessSynthesizer,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
} from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";

import { routingFunctionCode } from "./routing-function.js";

const DOMAIN_NAME = "probadeck.com";
const WWW_DOMAIN_NAME = `www.${DOMAIN_NAME}`;

export interface SiteStackProps extends StackProps {
  readonly billingAlertEmail: string;
  readonly githubOidcProviderArn: string;
  readonly githubOwner: string;
  readonly githubRepository: string;
  readonly hostedZoneId: string;
  readonly publishDns?: boolean;
}

function managedRule(
  name: string,
  priority: number,
  managedRuleGroupName: string,
): wafv2.CfnWebACL.RuleProperty {
  return {
    name,
    overrideAction: { none: {} },
    priority,
    statement: {
      managedRuleGroupStatement: {
        name: managedRuleGroupName,
        vendorName: "AWS",
      },
    },
    visibilityConfig: {
      cloudWatchMetricsEnabled: false,
      metricName: name,
      sampledRequestsEnabled: false,
    },
  };
}

export class SiteStack extends Stack {
  public constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, {
      ...props,
      // This stack has no file or container assets, so avoid creating a CDK bootstrap
      // bucket and roles that would sit outside the CloudFront flat-rate plan.
      synthesizer: props.synthesizer ?? new BootstraplessSynthesizer(),
    });

    if (this.region !== "us-east-1") {
      throw new Error("The ProbaDeck CloudFront and ACM stack must be deployed in us-east-1");
    }

    Tags.of(this).add("Project", "ProbaDeck");
    Tags.of(this).add("CostBoundary", "CloudFrontFree");

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "HostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: DOMAIN_NAME,
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: DOMAIN_NAME,
      subjectAlternativeNames: [WWW_DOMAIN_NAME],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: false,
    });

    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      defaultAction: { allow: {} },
      description: "Cost-bounded edge protection for the static ProbaDeck website",
      name: "probadeck-static-site",
      rules: [
        {
          action: { block: {} },
          name: "BlockUnsupportedMethods",
          priority: 0,
          statement: {
            notStatement: {
              statement: {
                orStatement: {
                  statements: ["GET", "HEAD", "OPTIONS"].map((method) => ({
                    byteMatchStatement: {
                      fieldToMatch: { method: {} },
                      positionalConstraint: "EXACTLY",
                      searchString: method,
                      textTransformations: [{ priority: 0, type: "NONE" }],
                    },
                  })),
                },
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: false,
            metricName: "BlockUnsupportedMethods",
            sampledRequestsEnabled: false,
          },
        },
        managedRule("AwsCommonRules", 1, "AWSManagedRulesCommonRuleSet"),
        managedRule("AwsKnownBadInputs", 2, "AWSManagedRulesKnownBadInputsRuleSet"),
        managedRule("AwsIpReputation", 3, "AWSManagedRulesAmazonIpReputationList"),
        {
          action: { block: {} },
          name: "PerIpRateLimit",
          priority: 4,
          statement: {
            rateBasedStatement: {
              aggregateKeyType: "IP",
              evaluationWindowSec: 300,
              limit: 1000,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: false,
            metricName: "PerIpRateLimit",
            sampledRequestsEnabled: false,
          },
        },
      ],
      scope: "CLOUDFRONT",
      visibilityConfig: {
        cloudWatchMetricsEnabled: false,
        metricName: "ProbaDeckStaticSite",
        sampledRequestsEnabled: false,
      },
    });

    const routingFunction = new cloudfront.Function(this, "RoutingFunction", {
      code: cloudfront.FunctionCode.fromInline(routingFunctionCode),
      comment: "Redirect www and map clean static routes to directory index files",
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const origin = origins.S3BucketOrigin.withOriginAccessControl(siteBucket);
    const behavior: cloudfront.BehaviorOptions = {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      compress: true,
      functionAssociations: [
        {
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: routingFunction,
        },
      ],
      origin,
      // The Free plan supports AWS-managed response header policies. Custom response
      // header policies are a Business-tier feature and would make this distribution
      // ineligible for the selected plan.
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      certificate,
      defaultBehavior: behavior,
      defaultRootObject: "index.html",
      domainNames: [DOMAIN_NAME, WWW_DOMAIN_NAME],
      enableIpv6: true,
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 404,
        responsePagePath: "/404.html",
        ttl: Duration.minutes(5),
      })),
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      webAclId: webAcl.attrArn,
    });

    if (props.publishDns === true) {
      for (const [idSuffix, recordName] of [
        ["Apex", undefined],
        ["Www", "www"],
      ] as const) {
        const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
        void new route53.ARecord(this, `${idSuffix}AliasIpv4`, {
          recordName,
          target,
          zone: hostedZone,
        });
        void new route53.AaaaRecord(this, `${idSuffix}AliasIpv6`, {
          recordName,
          target,
          zone: hostedZone,
        });
      }
    }

    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHubOidcProvider",
      props.githubOidcProviderArn,
    );

    const deployRole = new iam.Role(this, "GitHubDeployRole", {
      assumedBy: new iam.FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": `repo:${props.githubOwner}/${props.githubRepository}:environment:production`,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
      description: "Publishes the static site after verifying the CloudFront FREE pricing plan",
      maxSessionDuration: Duration.hours(1),
    });

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetBucketLocation", "s3:ListBucket"],
        resources: [siteBucket.bucketArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"],
        resources: [siteBucket.arnForObjects("*")],
      }),
    );
    distribution.grantCreateInvalidation(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:GetInvalidation"],
        resources: [distribution.distributionArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["acm:DescribeCertificate"],
        resources: [certificate.certificateArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["pricingplanmanager:GetSubscription", "pricingplanmanager:ListSubscriptions"],
        resources: ["*"],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "pricingplanmanager:ApprovePaidSubscription",
          "pricingplanmanager:AssociateResourcesToSubscription",
          "pricingplanmanager:CancelSubscription",
          "pricingplanmanager:CancelSubscriptionChange",
          "pricingplanmanager:CreateSubscription",
          "pricingplanmanager:DisassociateResourcesFromSubscription",
          "pricingplanmanager:UpdateSubscription",
        ],
        effect: iam.Effect.DENY,
        resources: ["*"],
      }),
    );

    void new budgets.CfnBudget(this, "AccountCostBudget", {
      budget: {
        budgetLimit: { amount: 10, unit: "USD" },
        budgetName: "probadeck-account-cost-guardrail",
        budgetType: "COST",
        timeUnit: "MONTHLY",
      },
      notificationsWithSubscribers: [1, 5, 10].map((amount) => ({
        notification: {
          comparisonOperator: "GREATER_THAN",
          notificationType: "ACTUAL",
          threshold: amount * 10,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [
          {
            address: props.billingAlertEmail,
            subscriptionType: "EMAIL",
          },
        ],
      })),
    });

    void new CfnOutput(this, "CertificateArn", { value: certificate.certificateArn });
    void new CfnOutput(this, "CloudFrontDistributionArn", {
      value: distribution.distributionArn,
    });
    void new CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
    });
    void new CfnOutput(this, "CloudFrontDomainName", {
      value: distribution.distributionDomainName,
    });
    void new CfnOutput(this, "DeployRoleArn", { value: deployRole.roleArn });
    void new CfnOutput(this, "HostedZoneArn", {
      value: `arn:${this.partition}:route53:::hostedzone/${props.hostedZoneId}`,
    });
    void new CfnOutput(this, "PricingPlanResourceArns", {
      description: "Attach all three resources to the CloudFront FREE pricing plan",
      value: [
        distribution.distributionArn,
        webAcl.attrArn,
        `arn:${this.partition}:route53:::hostedzone/${props.hostedZoneId}`,
      ].join(","),
    });
    void new CfnOutput(this, "PublicDnsEnabled", { value: String(props.publishDns === true) });
    void new CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName });
    void new CfnOutput(this, "WebAclArn", { value: webAcl.attrArn });
  }
}
