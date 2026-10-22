/**
 * Shared AWS client settings for S3, SES and KMS.
 *
 * Credentials come from the standard AWS chain (environment, shared profile, or the
 * ECS task role in production); there are no per-service key variables. The endpoint
 * override is how the same code talks to a local AWS emulator (Floci) or an
 * S3-compatible store: set AWS_ENDPOINT_URL for all services, or a service-specific
 * S3_ENDPOINT / SES_ENDPOINT / KMS_ENDPOINT to override one.
 */
export type AwsService = "s3" | "ses" | "kms";

/** One region for every service unless a service-specific one is given. */
export function awsRegion(service?: AwsService): string {
  const specific = service ? process.env[`${service.toUpperCase()}_REGION`] : undefined;
  return specific || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
}

export function awsEndpoint(service: AwsService): string | undefined {
  return process.env[`${service.toUpperCase()}_ENDPOINT`] || process.env.AWS_ENDPOINT_URL || undefined;
}

/** Base config for an AWS SDK v3 client. */
export function awsClientConfig(service: AwsService): { region: string; endpoint?: string } {
  const endpoint = awsEndpoint(service);
  return endpoint ? { region: awsRegion(service), endpoint } : { region: awsRegion(service) };
}
