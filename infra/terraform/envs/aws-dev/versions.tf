terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.70" }
    random = { source = "hashicorp/random", version = "~> 3.9" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = merge({
      Project     = "euron-open-hrms"
      Environment = var.environment
      ManagedBy   = "terraform"
    }, var.extra_tags)
  }
}

# CloudFront certificates and WAF web ACLs live in us-east-1 whatever the main region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = merge({
      Project     = "euron-open-hrms"
      Environment = var.environment
      ManagedBy   = "terraform"
    }, var.extra_tags)
  }
}
