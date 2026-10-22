output "identity_arn" {
  description = "ARN of the verified domain identity."
  value       = aws_sesv2_email_identity.domain.arn
}

output "from_address" {
  description = "Default MAIL_FROM for the API."
  value       = "no-reply@${var.domain}"
}

output "configuration_set" {
  description = "SES configuration set applied to the identity."
  value       = aws_sesv2_configuration_set.this.configuration_set_name
}

output "dns_records" {
  description = "Records to publish when the zone is not in Route53."
  value = concat(
    [for t in aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens : { type = "CNAME", name = "${t}._domainkey.${var.domain}", value = "${t}.dkim.amazonses.com" }],
    [
      { type = "MX", name = local.mail_from_domain, value = "10 feedback-smtp.${data.aws_region.current.region}.amazonses.com" },
      { type = "TXT", name = local.mail_from_domain, value = "v=spf1 include:amazonses.com ~all" },
    ],
  )
}
