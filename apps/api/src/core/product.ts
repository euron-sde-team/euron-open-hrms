/**
 * Product identity, in one place. Every user-visible mention of the product
 * (email chrome, PDF metadata, the authenticator-app issuer, logs) reads from
 * here, so a deployment can white-label it with one environment variable.
 */
export const PRODUCT_NAME = (process.env.PRODUCT_NAME || "Euron Open HRMS").trim();

/** Stable machine identifier: log `app` field, export format, SES tags. */
export const PRODUCT_ID = "open-hrms";

/** Issuer shown in authenticator apps for the operator console. */
export const OPERATOR_TOTP_ISSUER = `${PRODUCT_NAME} Operator`;
