locals {
  relay_worker_name = "rocketcrab-cors-relay"
  turn_worker_name  = "rocketcrab-turn-creds"

  bundle_dir                 = var.worker_bundle_dir == null ? "${path.module}/.build" : abspath(var.worker_bundle_dir)
  relay_bundle_file          = "${local.bundle_dir}/relay/worker.js"
  turn_bundle_file           = "${local.bundle_dir}/turn-creds/worker.js"
  turn_rate_limit_per_min    = tonumber(lookup(var.turn_worker_variables, "RATE_LIMIT_PER_MIN", "10"))
  turn_rate_limit_expression = var.turn_custom_route != null ? var.turn_custom_route.rate_limit_expression : var.turn_rate_limit_expression

  relay_bindings = [
    for name in sort(keys(var.relay_worker_variables)) : {
      name = name
      text = var.relay_worker_variables[name]
      type = "plain_text"
    }
  ]

  turn_plain_text_bindings = [
    for name in sort(keys(var.turn_worker_variables)) : {
      name = name
      text = var.turn_worker_variables[name]
      type = "plain_text"
    }
  ]

  turn_bindings = concat(local.turn_plain_text_bindings, [{
    name         = "TURN_BUDGET"
    namespace_id = cloudflare_workers_kv_namespace.turn_budget.id
    type         = "kv_namespace"
  }])

  custom_route_enabled    = var.turn_custom_route != null
  custom_domain_enabled   = var.turn_custom_domain != null
  zone_rate_limit_enabled = (local.custom_route_enabled || local.custom_domain_enabled) && var.turn_zone_rate_limit_enabled
}
