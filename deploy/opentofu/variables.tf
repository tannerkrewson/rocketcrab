variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the Workers and KV namespace."
  type        = string

  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character lowercase hexadecimal ID."
  }
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID used when enabling an optional custom route, custom domain, or rate rule."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.cloudflare_zone_id == null || can(regex("^[a-f0-9]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be null or a 32-character lowercase hexadecimal ID."
  }
}

variable "workers_dev_subdomain" {
  description = "Existing account-level workers.dev subdomain, used only for output URLs."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.workers_dev_subdomain == null || can(
      regex("^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$", var.workers_dev_subdomain),
    )
    error_message = "workers_dev_subdomain must be null or a lowercase workers.dev subdomain."
  }
}

variable "worker_bundle_dir" {
  description = <<-EOT
    Directory containing the two Wrangler dry-run bundles. The default is the
    ignored .build directory under this OpenTofu root. Run the documented
    dry-run bundle commands before planning or applying.
  EOT
  type        = string
  default     = null
  nullable    = true
}

variable "relay_worker_variables" {
  description = "Non-secret plain-text bindings for rocketcrab-cors-relay."
  type        = map(string)
  default = {
    ORIGIN_ALLOWLIST   = "https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173"
    RATE_LIMIT_PER_MIN = "20"
  }
}

variable "turn_worker_variables" {
  description = <<-EOT
    Non-secret plain-text bindings for rocketcrab-turn-creds. Secret names
    used by the Worker are deliberately not part of this map. In particular,
    ALERT_WEBHOOK_URL is a secret because webhook URLs commonly contain a
    bearer token.
  EOT
  type        = map(string)
  default = {
    MINT_DAILY_CAP     = "5000"
    MINT_TOTAL_CAP     = "50000"
    ORIGIN_ALLOWLIST   = "https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173"
    RATE_LIMIT_PER_MIN = "10"
    WATCHDOG_GB_BUDGET = "200"
  }

  validation {
    condition = alltrue([
      for name in [
        "ALERT_WEBHOOK_URL",
        "TURN_KEY_ID",
        "TURN_KEY_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_TOKEN",
      ] : !contains(keys(var.turn_worker_variables), name)
    ])
    error_message = "Secret Worker bindings must not be included in turn_worker_variables; set them through the Workers Secrets API or dashboard."
  }

  validation {
    condition = (
      can(tonumber(lookup(var.turn_worker_variables, "RATE_LIMIT_PER_MIN", "10"))) &&
      tonumber(lookup(var.turn_worker_variables, "RATE_LIMIT_PER_MIN", "10")) >= 1 &&
      tonumber(lookup(var.turn_worker_variables, "RATE_LIMIT_PER_MIN", "10")) == floor(tonumber(lookup(var.turn_worker_variables, "RATE_LIMIT_PER_MIN", "10")))
    )
    error_message = "turn_worker_variables.RATE_LIMIT_PER_MIN must be a positive whole number when supplied."
  }
}

variable "turn_budget_title" {
  description = "Human-readable title for the TURN_BUDGET KV namespace."
  type        = string
  default     = "TURN_BUDGET"
}

variable "turn_zone_rate_limit_enabled" {
  description = <<-EOT
    Enable the supported zone-level rate-limit ruleset when a custom route or
    custom domain is supplied. Keep this true unless the coordinator
    explicitly chooses to rely only on the Worker's in-memory backstop.
  EOT
  type        = bool
  default     = true
}

variable "turn_custom_route" {
  description = <<-EOT
    Optional zone route for the TURN Worker. The route is intentionally unset
    until a zone, hostname, proxied DNS arrangement, and exact rate-limit
    expression are chosen by the coordinator.
  EOT
  type = object({
    pattern               = string
    rate_limit_expression = string
  })
  default  = null
  nullable = true

  validation {
    condition = var.turn_custom_route == null || (
      trimspace(var.turn_custom_route.pattern) != "" &&
      trimspace(var.turn_custom_route.rate_limit_expression) != ""
    )
    error_message = "turn_custom_route.pattern and rate_limit_expression must both be non-empty when a route is configured."
  }
}

variable "turn_custom_domain" {
  description = <<-EOT
    Optional Cloudflare Workers Custom Domain for the TURN Worker. Set
    cloudflare_zone_id as well. A custom domain and a route are alternatives;
    do not configure both.
  EOT
  type = object({
    hostname = string
  })
  default  = null
  nullable = true

  validation {
    condition     = var.turn_custom_domain == null || trimspace(var.turn_custom_domain.hostname) != ""
    error_message = "turn_custom_domain.hostname must be non-empty when a custom domain is configured."
  }
}

variable "turn_rate_limit_expression" {
  description = <<-EOT
    Exact Rules language expression for a zone rate-limit rule on
    turn_custom_domain. A route configuration carries its expression in
    turn_custom_route instead. Required for a custom-domain rule unless the
    zone rule is explicitly disabled.
  EOT
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.turn_rate_limit_expression == null || trimspace(var.turn_rate_limit_expression) != ""
    error_message = "turn_rate_limit_expression must be non-empty when supplied."
  }
}
