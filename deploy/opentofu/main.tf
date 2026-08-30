resource "cloudflare_workers_script" "relay" {
  account_id  = var.cloudflare_account_id
  script_name = local.relay_worker_name

  # Cloudflare does not transpile TypeScript. This file is produced from
  # deploy/relay/worker.ts by the Wrangler dry-run documented in README.md.
  main_module        = "worker.js"
  content_file       = local.relay_bundle_file
  content_sha256     = fileexists(local.relay_bundle_file) ? filesha256(local.relay_bundle_file) : null
  compatibility_date = "2025-01-01"
  bindings           = local.relay_bindings

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = fileexists(local.relay_bundle_file)
      error_message = "The relay bundle is missing. Run the Wrangler deploy --dry-run command in deploy/opentofu/README.md before planning or applying."
    }
  }
}

resource "cloudflare_workers_kv_namespace" "turn_budget" {
  account_id = var.cloudflare_account_id
  title      = var.turn_budget_title

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_workers_script" "turn" {
  account_id  = var.cloudflare_account_id
  script_name = local.turn_worker_name

  # The bundle includes worker.ts and its local watchdog.ts import. The KV
  # binding and plain-text variables are attached by OpenTofu below.
  main_module        = "worker.js"
  content_file       = local.turn_bundle_file
  content_sha256     = fileexists(local.turn_bundle_file) ? filesha256(local.turn_bundle_file) : null
  compatibility_date = "2025-01-01"
  bindings           = local.turn_bindings

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = fileexists(local.turn_bundle_file)
      error_message = "The TURN bundle is missing. Run the Wrangler deploy --dry-run command in deploy/opentofu/README.md before planning or applying."
    }
  }
}

resource "cloudflare_workers_cron_trigger" "turn_watchdog" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_workers_script.turn.script_name
  schedules   = [{ cron = "0 9 * * *" }]

  lifecycle {
    prevent_destroy = true
  }
}

# A workers.dev hostname has no zone on which to attach a route or a zone
# ruleset. Both resources remain disabled until the coordinator chooses the
# exact proxied custom route and supplies its zone ID and expression.
resource "cloudflare_workers_route" "turn" {
  count = local.custom_route_enabled ? 1 : 0

  zone_id = var.cloudflare_zone_id
  pattern = var.turn_custom_route.pattern
  script  = cloudflare_workers_script.turn.script_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_ruleset" "turn_rate_limit" {
  count = local.zone_rate_limit_enabled ? 1 : 0

  zone_id     = var.cloudflare_zone_id
  name        = "rocketcrab-turn-creds rate limit"
  description = "Zone-level per-IP backstop for the TURN credential mint route."
  kind        = "zone"
  phase       = "http_ratelimit"

  rules = [{
    ref         = "rocketcrab_turn_creds_per_ip"
    description = "Block more than the configured number of TURN mints per IP per minute."
    expression  = var.turn_custom_route.rate_limit_expression
    action      = "block"
    ratelimit = {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = var.turn_rate_limit_per_min
      mitigation_timeout  = 60
    }
  }]

  lifecycle {
    prevent_destroy = true
  }
}

check "custom_route_requires_zone" {
  assert {
    condition     = var.turn_custom_route == null || var.cloudflare_zone_id != null
    error_message = "cloudflare_zone_id is required when turn_custom_route is configured; do not attach a Worker route without a real zone."
  }
}
