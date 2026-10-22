terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
      # CloudFront certificates and WAF web ACLs must live in us-east-1.
      configuration_aliases = [aws.us_east_1]
    }
  }
}
