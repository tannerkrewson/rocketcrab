terraform {
  required_version = "~> 1.12.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.24.0"
    }
  }
}

# Authentication is intentionally read from CLOUDFLARE_API_TOKEN by the
# provider. Never put an API token in this root or in a tfvars file.
provider "cloudflare" {}
