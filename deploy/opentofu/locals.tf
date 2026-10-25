locals {
  # Historical script name: this is the already-live relay Worker, now the
  # single Nova edge Worker (relay + TURN mint). Keeping the name avoids
  # replacing a live resource; a rename is a separate approved migration.
  edge_worker_name = "rocketcrab-cors-relay"

  bundle_dir                 = var.worker_bundle_dir == null ? "${path.module}/.build" : abspath(var.worker_bundle_dir)
  edge_bundle_file           = "${local.bundle_dir}/edge/worker.js"
  turn_rate_limit_per_min    = tonumber(lookup(var.edge_worker_variables, "RATE_LIMIT_PER_MIN", "20"))
  turn_rate_limit_expression = var.turn_custom_route != null ? var.turn_custom_route.rate_limit_expression : var.turn_rate_limit_expression

  edge_bindings = concat(
    [
      for name in sort(keys(var.edge_worker_variables)) : {
        name = name
        text = var.edge_worker_variables[name]
        type = "plain_text"
      }
    ],
    [{
      name         = "TURN_BUDGET"
      namespace_id = cloudflare_workers_kv_namespace.turn_budget.id
      type         = "kv_namespace"
    }],
  )

  custom_route_enabled    = var.turn_custom_route != null
  custom_domain_enabled   = var.turn_custom_domain != null
  zone_rate_limit_enabled = (local.custom_route_enabled || local.custom_domain_enabled) && var.turn_zone_rate_limit_enabled
}
