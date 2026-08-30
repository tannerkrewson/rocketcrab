variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the Workers and KV namespace."
  type        = string

  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character lowercase hexadecimal ID."
  }
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID used only when enabling the optional custom route and rate rule."
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
    used by the Worker are deliberately not part of this map.
  EOT
  type        = map(string)
  default = {
    ALERT_WEBHOOK_URL  = ""
    MINT_DAILY_CAP     = "5000"
    MINT_TOTAL_CAP     = "50000"
    ORIGIN_ALLOWLIST   = "https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173"
    RATE_LIMIT_PER_MIN = "10"
    WATCHDOG_GB_BUDGET = "200"
  }
}

variable "turn_budget_title" {
  description = "Human-readable title for the TURN_BUDGET KV namespace."
  type        = string
  default     = "TURN_BUDGET"
}

variable "turn_zone_rate_limit_enabled" {
  description = <<-EOT
    Enable the supported zone-level rate-limit ruleset when a custom route
    object is supplied. Keep this true unless the coordinator explicitly
    chooses to rely only on the Worker's in-memory backstop.
  EOT
  type        = bool
  default     = true
}

variable "turn_rate_limit_per_min" {
  description = "Requests per minute for the zone-level TURN mint rule. Keep in sync with the Worker binding."
  type        = number
  default     = 10

  validation {
    condition     = var.turn_rate_limit_per_min >= 1 && var.turn_rate_limit_per_min == floor(var.turn_rate_limit_per_min)
    error_message = "turn_rate_limit_per_min must be a positive whole number."
  }
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
