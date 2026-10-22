terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.70" }
    random = { source = "hashicorp/random", version = "~> 3.9" }
  }
}

# Every service endpoint points at the emulator. Credentials are the emulator's
# documented dummy values; nothing here can reach a real AWS account.
provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  # Account id comes from the emulated STS (000000000000), so ARNs are well formed.
  s3_use_path_style = true

  endpoints {
    s3             = var.endpoint
    s3control      = var.endpoint
    kms            = var.endpoint
    secretsmanager = var.endpoint
    sesv2          = var.endpoint
    ses            = var.endpoint
    route53        = var.endpoint
    iam            = var.endpoint
    sts            = var.endpoint
  }

  default_tags {
    tags = {
      Project     = "euron-open-hrms"
      Environment = "local"
      ManagedBy   = "terraform"
    }
  }
}
