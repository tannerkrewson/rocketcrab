output "edge_worker_name" {
  description = "Managed edge Worker script name (relay + TURN mint)."
  value       = cloudflare_workers_script.relay.script_name
}

output "edge_workers_dev_url" {
  description = "Edge workers.dev origin when the account subdomain is supplied (TURN lives at /turn)."
  value       = var.workers_dev_subdomain == null ? null : "https://${local.edge_worker_name}.${var.workers_dev_subdomain}.workers.dev"
}

output "turn_budget_namespace_id" {
  description = "TURN_BUDGET KV namespace ID. This is not a secret."
  value       = cloudflare_workers_kv_namespace.turn_budget.id
}

output "turn_custom_route_id" {
  description = "Optional custom route ID, or null until a route is configured."
  value       = try(cloudflare_workers_route.turn[0].id, null)
}

output "turn_custom_domain_id" {
  description = "Optional custom domain ID, or null until a custom domain is configured."
  value       = try(cloudflare_workers_custom_domain.turn[0].id, null)
}

output "turn_rate_limit_ruleset_id" {
  description = "Optional zone-level rate-limit ruleset ID, or null until enabled."
  value       = try(cloudflare_ruleset.turn_rate_limit[0].id, null)
}

output "edge_worker_secret_names" {
  description = "Secret names that must be supplied outside OpenTofu. Values are never output or stored here."
  value = [
    "TURN_KEY_ID",
    "TURN_KEY_API_TOKEN",
  ]
}
