# Deployment: two static origins on GitHub Pages (M2)

- **Status:** Config + strategy documented; **nothing is published yet**.
- **Owner:** M2 (Configure production static deployment)
- **Related:** ADR-0001 (two static origins), ADR-0008 (shared runtime-origin
  limitations), ADR-0011 (secrets in URL fragments), B8 (static-host security
  headers), user decision 2026-08-01 (target = GitHub Pages).

## 1. The requirement

Rocketcrab Nova is fully static (ADR-0001): two HTTPS origins, both built
with Vite, no application server:

| Origin  | Built from          | Role                                                               |
| ------- | ------------------- | ------------------------------------------------------------------ |
| Main    | `apps/nova/dist`    | The Nova SPA (strict security policy)                              |
| Runtime | `apps/runtime/dist` | Isolated execution origin for game HTML (intentionally permissive) |

The origins MUST be distinct (per-site process/CPU-exhaustion isolation, F4
finding; ADR-0008). The runtime origin is secret-free: no Nova credentials,
no auth cookies, no service workers.

## 2. The GitHub Pages constraint

GitHub Pages serves **one site per repo**, and every project site of one
account shares the `username.github.io` **origin** (only the path differs).
A single account's project pages therefore CANNOT give the shell and the
runtime separate origins, which the architecture requires. Three workable
strategies:

| Strategy                                                 | Main origin                                       | Runtime origin                                       | Runtime origin derivable?                                         | Notes                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **(a) Custom-domain subdomains (recommended)**           | `nova.<your-domain>` (repo A + CNAME)             | `runtime.<your-domain>` (repo B + CNAME)             | Yes — the app derives `runtime.` + hostname (ADR-0001 derivation) | One GitHub account, two repos, each with its own custom domain → two distinct origins. Requires owning a domain. |
| **(b) Two GitHub accounts/orgs**                         | `account-a.github.io/nova` (repo A, project site) | `account-b.github.io/runtime` (repo B, project site) | No — pin via `VITE_RUNTIME_ORIGIN` + `VITE_RUNTIME_BASE`          | Two accounts/orgs; base paths needed; free but awkward (origin is shared per account).                           |
| **(c) Alternate static host (Netlify/Cloudflare Pages)** | `nova-<user>.netlify.app` (or custom domain)      | `runtime-<user>.netlify.app`                         | No — pin via `VITE_RUNTIME_ORIGIN`                                | Subdomains per project; also supports `_headers`/`_redirects` (see §5).                                          |

**Decision needed from the user before publishing: do you own (or will you
buy) a domain?** Strategy (a) is the clean path — it matches the ADR-0001
derivation (`nova.example` → `runtime.nova.example`), needs no origin pins,
and keeps both origins at their site root. Strategies (b)/(c) work with the
same build via the `VITE_RUNTIME_ORIGIN` / `VITE_MAIN_ORIGIN` /
`VITE_RUNTIME_BASE` pins (workflow inputs, §6).

Until that decision lands, the deploy workflow is manual-only
(`workflow_dispatch`) and nothing is published.

## 3. Per-origin policy

### Main origin (strict SPA policy)

- No inline application scripts — the Vite build emits external hashed
  scripts only; the CSP pins `script-src 'self'`.
- No arbitrary third-party script execution — `script-src 'self'` only.
- Runtime iframe allowed ONLY from the configured runtime origin —
  `frame-src <runtime-origin>`, baked at build time.
- No sensitive secrets in server-visible URL components — invite secrets
  live in URL fragments (ADR-0011); both origins ship
  `Referrer-Policy: no-referrer` so paths/query never leak in Referer.
- SPA fallback routing — see §4.
- Caching — hashed assets immutable (long-lived), HTML entry short-lived
  (see §5 for what each host can do).

GitHub Pages cannot send custom response headers, so the strict policy is
delivered as a **CSP meta tag injected at build time**
(`apps/nova/vite.config.ts`, `nova-csp-meta` plugin). The deploy workflow
passes `VITE_RUNTIME_ORIGIN`; without it the build warns and `frame-src`
falls back to `default-src 'self'` (runtime frame blocked — a loud
misconfiguration, never a silent loosening). `scripts/verify-static-deploy.mjs`
fails the deploy if the built HTML does not pin `frame-src` to the configured
runtime origin.

### Runtime origin (intentionally permissive, compensated)

Game HTML may need: inline scripts; HTTPS scripts/modules; HTTPS and WSS
connections; remote images/fonts/audio/video/models; blob URLs; camera/mic
permission delegation. So the runtime page ships **no restrictive CSP**
(no CSP meta at all on GitHub Pages). The permissiveness is compensated by:

- hosting on a separate origin (per-site isolation);
- no Nova secrets, no auth cookies on the origin (ADR-0008);
- no service workers — `apps/runtime/src/main.ts` sweeps any registration on
  load, and browsers reject registration from the sandboxed game frame;
- no top navigation — the game frame sandbox has no `allow-top-navigation`
  (U3);
- framing prevented by unrelated origins — via `frame-ancestors` on
  header-capable hosts (§5); on GitHub Pages the runtime page is secret-free
  and validates the exact bootstrap origin, so the residual framing risk is
  documented (threat model; B8 note in §8);
- the main origin stays strict.

## 4. SPA fallback routing

GitHub Pages has no rewrite rules. The deploy workflow copies
`apps/nova/dist/index.html` to `404.html` in the artifact: GitHub serves
404.html's content at any unknown path, the SPA boots at that
`location.pathname`, and TanStack Router matches it. The router basepath is
`import.meta.env.BASE_URL` (`apps/nova/src/lib/basepath.ts`), so project-site
layouts (`/nova/…`) work too. `404.html` is a byte-copy of the built
index.html — no inline script, so the strict CSP holds. On header-capable
hosts the same behavior comes from `deploy/nova/_redirects`
(`/* /index.html 200`).

## 5. Headers and caching per host

| Capability                     | GitHub Pages                                                                                                                    | Netlify / Cloudflare Pages (`deploy/*`)              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Custom headers                 | Not supported                                                                                                                   | `_headers` per origin (see below)                    |
| CSP                            | Build-time meta tag (main origin; none on runtime)                                                                              | Same meta tag PLUS `_headers` CSP (identical policy) |
| Frame protection               | Header-only directives impossible; bootstrap-origin validation + secret-free runtime                                            | `frame-ancestors` in `_headers`                      |
| Referrer                       | `<meta name="referrer" content="no-referrer">` in both `index.html` files                                                       | meta tag (same)                                      |
| SPA fallback                   | 404.html copy (workflow)                                                                                                        | `_redirects`                                         |
| Immutable hashed-asset caching | **Not supported** — GitHub Pages serves fixed `Cache-Control: max-age=600`; acceptable for v1 (hashed URLs + ETag revalidation) | `/assets/*` → `max-age=31536000, immutable`          |

Per-origin header files (Netlify/Cloudflare format, substitute YOUR real
origins in the CSP `frame-src`/`frame-ancestors` before use):

- `deploy/nova/_headers` — strict main-origin policy
  (`script-src 'self'`, `frame-src <runtime>`, `frame-ancestors 'none'`,
  no camera/mic permissions, no-referrer).
- `deploy/runtime/_headers` — permissive runtime policy
  (`default-src * data: blob: 'unsafe-inline' 'unsafe-eval'`,
  `frame-ancestors <main>`, camera/mic/clipboard `(self)` for delegation,
  no-referrer).

The strict meta CSP is generated only on `vite build`; local dev stays
header-free (Vite dev needs inline scripts).

## 6. The deploy workflow (`.github/workflows/deploy.yml`)

Manual-only (`workflow_dispatch`) — nothing deploys automatically. Run it in
**each repo whose Pages site is one origin** (strategy (a): two repos with
the two CNAME custom domains; strategy (b): one repo per account). The
workflow builds only the selected app, adds the 404.html fallback (nova),
verifies the output with `scripts/verify-static-deploy.mjs`, and deploys
with `actions/upload-pages-artifact` + `actions/deploy-pages` (set the
repo's Pages source to "GitHub Actions", and the custom domain in each
repo's Pages settings).

Inputs:

| Input            | Used for | Meaning                                                                                                                      |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `origin`         | both     | `nova` (main app) or `runtime` (runtime origin)                                                                              |
| `base`           | both     | Vite base of THIS site: `/` for user/org sites and custom domains; `/<repo>/` for project sites                              |
| `runtime_origin` | nova     | The runtime origin, e.g. `https://runtime.nova.example` — REQUIRED; baked into the iframe URL and CSP `frame-src`            |
| `runtime_base`   | nova     | Base path of the runtime site when it is a project site, e.g. `/runtime/` (default `/`)                                      |
| `main_origin`    | runtime  | The main origin for the exact-origin bootstrap check; derived (strip `runtime.`) unless the deployment is not on a subdomain |

Build-time pins (also documented in `apps/nova/.env.example` and
`apps/runtime/.env.example`): `VITE_RUNTIME_ORIGIN`, `VITE_RUNTIME_BASE`
(nova); `VITE_MAIN_ORIGIN` (runtime).

## 7. Local HTTPS development (both origins)

Production is HTTPS-only, and the runtime iframe requires a distinct origin,
so local HTTPS matters (self-signed, gitignored — local tooling only):

```sh
npm run gen-certs       # generates .certs/ for localhost (idempotent)
npm run dev:https       # nova on https://localhost:5173, runtime on https://localhost:5174
```

Accept the self-signed-cert warning once per browser. The origin derivation
swaps ports in dev, so no hostname editing is needed. For physical-device
testing on the LAN, include the machine's IP and serve with `--host`:

```sh
node scripts/gen-certs.mjs 192.168.1.10   # SAN: localhost + that IP
npm run dev:https
# devices open https://192.168.1.10:5173 (accept the cert warning)
```

(`scripts/gen-certs.mjs` generalises the F4 spike tooling;
`spikes/runtime-sandbox/scripts/gen-certs.mjs` remains for the spike.)

## 8. Deployment, verification, rollback

Deploy:

1. Choose a strategy and own the domain(s) (the pending user decision).
2. Repo per origin; set Pages source to "GitHub Actions"; set custom domains
   (strategy (a)) or nothing (strategy (b) project sites).
3. Run "Deploy to GitHub Pages" with the input table above.

Verify after each deploy:

```sh
curl -sI https://nova.example/            # HTTPS, CSP meta tag in the body
curl -s  https://nova.example/party/ABCD  # 200, app HTML (404.html fallback)
curl -sI https://runtime.nova.example/    # runtime origin serves its page
```

Plus `npm run verify:deploy` against local build output (the same checks the
workflow runs): CSP meta + pinned `frame-src`, no inline scripts, 404.html
fallback (nova); no CSP meta + no service workers (runtime). "Invite
fragments are not sent in HTTP requests" is covered by
`e2e/deployment.spec.ts` and the fact that fragments never leave the
browser.

Rollback: re-run the workflow on the previous release's commit (Pages keeps
deployment history; the latest deploy wins). Unpublish: disable the Pages
environment in the repo settings. On alternate hosts, roll back in the
host's dashboard/CLI to a previous deployment.

Residual risks (B8 note): GitHub Pages cannot send custom security headers,
immutable-cache headers, or `frame-ancestors`. Accepted for v1 on strategy
(a) via the meta CSP + no-referrer + secret-free runtime + strict
bootstrap-origin validation; strategies (b)/(c) are available if header
control becomes mandatory. See also ADR-0008 (shared runtime-origin storage
limitations).
