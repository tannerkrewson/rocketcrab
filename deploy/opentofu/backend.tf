# Private R2 remote state (partial configuration).
#
# Bucket and endpoint are supplied per environment via an ignored
# `backend.hcl` (see backend.hcl.example) and credentials via the standard
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY environment variables:
#
#   tofu -chdir=deploy/opentofu init -backend-config=backend.hcl
#
# `use_lockfile` gives S3-compatible native state locking. R2 supports the
# conditional writes this requires; verify on first use. Never commit
# backend.hcl, state, backups, or credentials.
terraform {
  backend "s3" {
    key    = "nova/terraform.tfstate"
    region = "auto"

    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}
