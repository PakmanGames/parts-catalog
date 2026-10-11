# Deploying Parts Catalog

> **Status:** Deployed. Parts 1 and 2 are done; the last "Done when" item waits for Phase 2.
> **Last updated:** 2026-10-11

This is the runbook for workstream WS-E and goal G5 in [`PRD.md`](PRD.md).
Deployment is the lowest-priority goal, so none of this should delay the import, table, or quote work.

Dashboard menu names change from time to time.
If a label here doesn't match exactly, look for the closest equivalent.

## How it fits together

```
Browser --> Cloudflare: proxy + Access login --> Railway "web" (Next.js) --> Railway "Postgres" 18
            (parts.example.com)         (SSL/TLS Full)                  (private network)
```

- **Cloudflare** owns the domain, proxies traffic, and puts an Access login in front of the site, so the app needs no auth code (PRD D17).
- **Railway** runs the Next.js app and Postgres 18 in one project, connected over Railway's private network.
- **`.railway/railway.ts`** declares the Railway project: both services, the database volume, the web service's settings and variables, and the custom domain (PRD D18).
- Migrations run on Railway before each deploy, so nothing needs to connect to the database from outside Railway.

Placeholders used below:

| Placeholder | Meaning |
| --- | --- |
| `parts.example.com` | The subdomain you choose for the app. |
| `you@example.com` | The email address allowed through Cloudflare Access. |
| `<team>` | The Zero Trust team name, as in `<team>.cloudflareaccess.com`. |

## Changing the Railway setup

Railway doesn't read `.railway/railway.ts` when it deploys.
After changing the file, preview the change and then make it:

```sh
railway config plan
railway config apply
```

`plan` is read-only.
`apply` deletes anything in the project that the file doesn't declare, so only apply a plan that says `0 to destroy`, unless you meant to delete something.
Anything added in the Railway dashboard, such as a domain or a variable, has to be added to the file too, or the next apply removes it.
Pushes to `main` deploy the app as usual; only changes to the file need an apply (K17).

## Part 1: accounts and access

None of these steps need the app.

### Railway

1. **Set a usage limit.**
   In your workspace's usage or billing settings, set a hard usage limit, or run `railway usage limit set --target workspace --hard 10 --soft 7`.
   Hobby bills by usage on top of the $5 credit, so a cap prevents surprises.
2. **Create the project and database.**
   Create a new project, add a Postgres database, and pick a region close to you.
   The web service will go in the same region.
   Keep the database service's name as `Postgres`, because `.railway/railway.ts` refers to it by that name.
   The database deploys to your workspace's default region, which may not be the one you want.
   If it lands somewhere else, change it in the database's settings, under Regions, before storing any data.
3. **Confirm it is Postgres 18.**
   Open the database's data tab, or connect with any client, and run `SELECT version();`.
   Local development and the tests are pinned to 18, so production should match.
   If it isn't 18, set the database's source image to `ghcr.io/railwayapp-templates/postgres-ssl:18` and replace its volume with a new empty one before storing any data.
   A data directory created by one major version can't be opened by another.
4. **Note the public networking setting.**
   Railway's Postgres currently starts without a public TCP proxy, so there is usually nothing to remove later.
   To inspect the database from your laptop, run `railway connect Postgres`, which opens a tunnel without making the database public.
   If the database does have a public TCP proxy, plan to remove it in the lock-down step at the end of Part 2.
5. **Install the Railway CLI** and link this repository to the project.

   ```sh
   brew install railway
   railway login
   railway link
   ```

### Cloudflare

1. **Choose the subdomain**, for example `parts.example.com`.
2. **Set the subdomain's SSL/TLS mode to Full.**
   Railway can't get its own certificate for a domain behind Cloudflare Access, so it serves its generic `*.up.railway.app` certificate.
   Full (strict) rejects that certificate with error 526, so the subdomain uses **Full**, which still encrypts the connection to Railway but doesn't check the certificate (PRD D19).
   Go to Rules, choose **Create rule**, then **Configuration Rule**.
   Match requests whose **Hostname** equals `parts.example.com`, add the **SSL** setting, set it to **Full**, and deploy the rule.
   The rule only applies to the subdomain, so other sites on the domain keep the domain-wide mode.
3. **Create a Zero Trust organization** if you don't have one.
   Choose **Zero Trust Free**, which covers this project, though Cloudflare may ask for a payment method even at $0.
   Cloudflare gives the organization a random team name, such as `brave-river-1a2b`.
   It only shows up in the login page's address, `<team>.cloudflareaccess.com`, and you can rename it under Settings.
4. **Add one-time PIN as a login method.**
   New organizations start with only the **Cloudflare** login method, which signs in with a Cloudflare account and only lets in members of your Cloudflare account.
   One-time PIN emails a code to the allowed address instead, and needs no account or identity provider.
   In the Zero Trust dashboard, go to Integrations, then Identity providers, choose **Add an identity provider**, and pick **One-time PIN**.
5. **Create the Access application.**
   This works before the subdomain has a DNS record, because Access matches on the hostname.
   - Go to Access controls, then Applications, choose **Create new application**, and continue with **Self-hosted and private**.
   - Add a public hostname for `parts.example.com`, with no path, so it covers the whole site including `/api`.
   - Choose **Create new policy**, with action **Allow** and an include rule of **Emails** equal to `you@example.com`.
   - Keep **Accept all available identity providers** on, so the login page offers one-time PIN.
   - Keep the default session duration of 24 hours.
6. **Check that Access is active.**
   The subdomain has no DNS record until Part 2, so a browser can't open it yet.
   To check the application anyway, send the request straight to Cloudflare, using the address of any proxied hostname on the domain:

   ```sh
   curl -sI --resolve parts.example.com:443:"$(dig +short example.com | head -1)" https://parts.example.com/
   ```

   It should return `302`, with a `location` header pointing at `<team>.cloudflareaccess.com`.

## Part 2: the web service

### Railway: create and deploy the web service

1. **Apply `.railway/railway.ts`.**
   Run `pnpm install` first, because the file imports the `railway` SDK from the dev dependencies.
   Then run `railway config plan`, check that it only adds or changes the `web` service, and run `railway config apply`.
   The file gives `web` these settings:

   | Setting | Value | Why |
   | --- | --- | --- |
   | Source | GitHub, `main` branch | Every push to `main` deploys. |
   | Region | Same as the database | Keeps queries on the private network and fast. |
   | Build command | `pnpm build` | Builds the standalone server and copies its static files. |
   | Start command | `pnpm start` | Runs `.next/standalone/server.js`. |
   | Pre-deploy command | `pnpm db:migrate` | Runs migrations before each deploy, with production dependencies only. A failed migration stops the deploy. |
   | Healthcheck path | `/api/health` | Railway waits for this to return `200` before switching traffic, and it checks the database connection. |
   | App sleeping | Off | The import runs in the background after the upload request returns (PRD D10), so the service must not sleep. |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway fills in the database's private URL, so traffic stays on the private network. |
   | `HOSTNAME` | `0.0.0.0` | Next.js standalone listens on `HOSTNAME`, which the container otherwise sets to its own ID. |

2. **Connect the GitHub source.**
   The apply sets the repository on the service, but doesn't create the trigger that deploys it, so deploys fail with "No GitHub installation found for repo".
   Connecting the source creates the trigger and starts the first deploy:

   ```sh
   railway service source connect --repo PakmanGames/parts-catalog --branch main --service web
   ```

   The Railway GitHub App also needs access to the repository.
   On GitHub, go to Settings, then Applications, and configure **Railway App** to include it.
3. **Check the deploy.**
   Run `railway deployment list --service web` until the latest deploy shows `SUCCESS`.
   The build log should show pnpm 12 and Node 24, and the deploy log should show the migration, then Next.js listening on `0.0.0.0`.
   Railpack also warns "could not detect pnpm lockfile version", which is harmless (K18).
4. **Check the app.**
   Run `railway domain --service web` to generate a temporary `*.up.railway.app` domain, and check that its `/api/health` returns `{ "ok": true }`.
   The lock-down step removes this domain.

### Railway and Cloudflare: connect the subdomain

1. **Add the custom domain** with `railway domain parts.example.com --service web`.
   It's already in `domains` in `.railway/railway.ts`, so later applies keep it.
   Railway prints two DNS records: a CNAME to a `*.up.railway.app` target, and a TXT record named `_railway-verify.parts` with a `railway-verify=...` value.
2. **Create both records in Cloudflare DNS.**
   Turn the proxy **on** (orange cloud) for the CNAME, because Cloudflare Access needs it.
   The TXT record is always DNS only.
3. **Wait for Railway to verify the domain.**
   `railway domain status parts.example.com --service web` shows `verified` once it sees the TXT record, usually within minutes.
   Railway won't issue a certificate of its own for the domain, which is expected, and is why Part 1 sets the subdomain to Full.
4. **Open `https://parts.example.com` in a private window.**
   You should see the Cloudflare Access login first, then the app after entering the emailed code.
5. **Check that `https://parts.example.com/api/health` returns `{ "ok": true }`** in the same window.

### Lock down

1. **Remove the `*.up.railway.app` domain** with `railway domain delete <domain> --service web`.
   While it exists, anyone can reach the app through it without going through Cloudflare Access.
   Afterwards, the old address returns `404`.
2. **Remove the database's public TCP proxy**, if it has one.
   `railway tcp-proxy list --service Postgres` should list none.
   The app and the migrations both reach the database over the private network.

### After Phase 2

Once the importer and the UI are done (PRD T2.1), upload the full `parts_export.csv` through the deployed site.
Record the import time in PRD section 11, next to the local measurement.

## Giving someone else access

1. In the Zero Trust dashboard, go to Access controls, then Applications, open the application, and edit its **Allow** policy.
2. Add their address to the **Emails** include rule, and save.
   Include rules match any one of their values, so everyone in the list can log in.
   To let in a whole company, use **Emails ending in** with a value such as `@example.com` instead.
3. They log in with one-time PIN, because the Cloudflare login method only lets in members of your Cloudflare account.

Removing an address stops new logins.
A session that has already started lasts until it expires, up to the 24-hour session duration.

## Done when

From PRD WS-E:

- [x] `https://parts.example.com` shows the Cloudflare Access login, then the app.
- [x] `https://parts.example.com/api/health` returns `{ "ok": true }`.
- [x] Migrations run automatically on each deploy.
- [x] The `*.up.railway.app` domain and the database's public proxy are removed.
- [ ] After Phase 2, uploading the full export through the deployed site finishes an import.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| The browser can't find `parts.example.com` | Its DNS record doesn't exist yet. | Expected until Part 2 adds the CNAME. Use the `curl` check in Part 1 to test Access before then. |
| The Access login page has no email field | One-time PIN isn't added as a login method. | Add it as in Part 1, step 4. |
| Cloudflare error 526 after logging in | The subdomain uses Full (strict), which rejects Railway's generic certificate. | Check that the Configuration Rule from Part 1 sets SSL to Full for the subdomain. |
| Too many redirects | SSL/TLS mode is Flexible for the subdomain. | Set it to Full with the Configuration Rule from Part 1. |
| A deploy fails with "No GitHub installation found for repo" | The service has no GitHub deploy trigger, or the Railway GitHub App can't see the repository. | Connect the source as in Part 2, step 2, and check the app's repository access on GitHub. |
| `railway config plan` wants to delete something | The file doesn't declare something that exists on Railway, such as a domain or variable added in the dashboard. | Add it to `.railway/railway.ts`, unless you meant to delete it. |
| Deploy succeeds but the healthcheck fails right away | The server isn't listening on Railway's `PORT` on all interfaces. | Next.js standalone reads `PORT` and `HOSTNAME`. Check that `HOSTNAME=0.0.0.0` is set on the service. |
| `/api/health` reports the database as unreachable | `DATABASE_URL` doesn't reference the database, or the services are in different projects or environments. | Re-check the variable's reference and that both services are in the same project and environment. |
| Upload fails with 413 | The compressed file is over Cloudflare's 100 MB cap. | Not expected at about 36 MB. If the export grows that much, see the object storage item in PRD section 12. |
| Upload fails with 524 | The upload route took more than 100 seconds to respond. | The route must respond `202` before importing (PRD 7.2). |
| An import disappears during a deploy | The import runs in the web process, which a deploy replaces. | Avoid deploying during an import, and upload again if it happens. The catalog is unchanged, because the transaction rolls back (PRD D10). |

## Known limits

- **Access protects the hostname, not the server itself.**
  Removing the `*.up.railway.app` domain closes the obvious way around it.
  Fully closing it means validating Cloudflare Access's signed `Cf-Access-Jwt-Assertion` header in the app, or putting Railway behind a Cloudflare Tunnel.
  Both are post-MVP.
- **Cloudflare doesn't verify Railway's certificate** (PRD D19).
  The connection from Cloudflare to Railway is encrypted, but something that could intercept it could also impersonate Railway.
  A Cloudflare Tunnel would remove this hop's public exposure too.
- **No database backups** are set up, since production hardening is a non-goal (PRD section 3).
