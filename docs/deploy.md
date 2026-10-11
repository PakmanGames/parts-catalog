# Deploying Parts Catalog

> **Status:** Draft - Part 1 can be done now; Part 2 waits for the scaffold (PRD T0.2).
> **Last updated:** 2026-10-10

This is the runbook for workstream WS-E and goal G5 in [`PRD.md`](PRD.md).
Deployment is the lowest-priority goal, so none of this should delay the import, table, or quote work.
Steps marked **TBD** depend on what the scaffold produces, and get filled in once it merges.

Dashboard menu names change from time to time.
If a label here doesn't match exactly, look for the closest equivalent.

## How it fits together

```
Browser --> Cloudflare: proxy + Access login --> Railway "web" (Next.js) --> Railway "Postgres" 17
            (parts.example.com)                                         (private network)
```

- **Cloudflare** owns the domain, proxies traffic, and puts an Access login in front of the site, so the app needs no auth code (PRD D17).
- **Railway** runs the Next.js app and Postgres 17 in one project, connected over Railway's private network.
- Migrations run on Railway before each deploy, so nothing needs to connect to the database from outside Railway.

Placeholders used below:

| Placeholder | Meaning |
| --- | --- |
| `parts.example.com` | The subdomain you choose for the app. |
| `you@example.com` | The email address allowed through Cloudflare Access. |

## Part 1: do now

None of these steps need the app.

### Railway

1. **Set a usage limit.**
   In your workspace's usage or billing settings, set a hard usage limit.
   Hobby bills by usage on top of the $5 credit, so a cap prevents surprises.
2. **Create the project and database.**
   Create a new project, add a Postgres database, and pick a region close to you.
   The web service will go in the same region.
   Keep the database service's name as `Postgres`, because Part 2 refers to it by that name.
3. **Confirm it is Postgres 17.**
   Open the database's data tab, or connect with any client, and run `SELECT version();`.
   Local development and the tests are pinned to 17, so production should match.
   If it isn't 17, delete the database and add it again, choosing version 17.
4. **Note the public networking setting.**
   If the database has a public TCP proxy enabled, plan to remove it in the lock-down step at the end of Part 2.
   It's fine to keep it for now if you want to inspect the database from your laptop.
5. **Optional: install the Railway CLI** for logs and one-off commands.

   ```sh
   brew install railway
   railway login
   ```

### Cloudflare

1. **Choose the subdomain**, for example `parts.example.com`.
2. **Check the SSL/TLS encryption mode before changing it.**
   This app needs **Full (strict)**, but the mode applies to the whole domain.
   - If nothing else on the domain relies on **Flexible**, set the domain to Full (strict).
   - Otherwise, leave the domain alone and add a **Configuration Rule** that sets Full (strict) only for requests whose hostname equals `parts.example.com`.
3. **Create a Zero Trust organization** if you don't have one.
   The free plan covers this project, though Cloudflare may ask for a payment method even at $0.
4. **Create the Access application.**
   This works before the subdomain exists, because Access matches on the hostname.
   - In the Zero Trust dashboard, go to Access, then Applications, and add a **Self-hosted** application.
   - Set the application domain to `parts.example.com`, with no path, so it covers the whole site including `/api`.
   - Keep the default session duration (24 hours is fine).
   - Add a policy with action **Allow** that includes **Emails** equal to `you@example.com`.
   - Use the default **One-time PIN** login method, which emails you a code and needs no identity provider.

## Part 2: after the scaffold merges

### Railway: add the web service

1. In the project, add a new service from the GitHub repo, deploying the `main` branch.
2. Set these variables on the web service:

   | Variable | Value | Why |
   | --- | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway fills in the database's private URL, so traffic stays on the private network. |

3. Set these service settings:

   | Setting | Value | Notes |
   | --- | --- | --- |
   | Region | Same as the database | Keeps queries on the private network and fast. |
   | Build command | **TBD** | Set from the scaffold's `output: "standalone"` build. |
   | Start command | **TBD** | Set from the scaffold. |
   | Pre-deploy command | `pnpm db:migrate` | Runs migrations before each deploy. The scaffold has to make sure this works in the built image, since `drizzle-kit` is usually a dev dependency. |
   | Healthcheck path | `/api/health` | Railway waits for this to return `200` before switching traffic, and it checks the database connection. |
   | Serverless (app sleeping) | Off | The import runs in the background after the upload request returns (PRD D10), so the service must not sleep. |

4. Deploy, then open the Railway-generated `*.up.railway.app` domain and check that `/api/health` returns `{ "ok": true }`.

### Railway and Cloudflare: connect the subdomain

1. On the web service, add `parts.example.com` as a custom domain.
   Railway shows the DNS records to create: a CNAME, and a TXT verification record if it asks for one.
2. In Cloudflare DNS, create exactly those records.
   Turn the proxy **on** (orange cloud) for the CNAME, because Cloudflare Access needs it.
3. Wait for Railway to show the domain as verified with a certificate issued.
   If the certificate stays pending for a long time, set the CNAME to DNS only (grey cloud) until it issues, then turn the proxy back on.
4. Open `https://parts.example.com` in a private window.
   You should see the Cloudflare Access login first, then the app after entering the emailed code.
5. Check `https://parts.example.com/api/health` returns `{ "ok": true }`.

### Lock down

1. **Remove the `*.up.railway.app` domain** from the web service.
   While it exists, anyone can reach the app through it without going through Cloudflare Access.
2. **Remove the database's public TCP proxy**, if it has one.
   The app and the migrations both reach the database over the private network.

### After Phase 2

Once the importer and the UI are done (PRD T2.1), upload the full `parts_export.csv` through the deployed site.
Record the import time in PRD section 11, next to the local measurement.

## Done when

From PRD WS-E:

- [ ] `https://parts.example.com` shows the Cloudflare Access login, then the app.
- [ ] `https://parts.example.com/api/health` returns `{ "ok": true }`.
- [ ] Migrations run automatically on each deploy.
- [ ] The `*.up.railway.app` domain and the database's public proxy are removed.
- [ ] After Phase 2, uploading the full export through the deployed site finishes an import.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Too many redirects | SSL/TLS mode is Flexible for the subdomain. | Set Full (strict), at the domain level or with the Configuration Rule from Part 1. |
| Cloudflare error 526 | Full (strict) can't validate Railway's certificate yet. | Wait for Railway to issue it, using the grey-cloud step in Part 2 if needed. |
| Deploy succeeds but the healthcheck fails right away | The server isn't listening on Railway's `PORT` on all interfaces. | Next.js standalone reads `PORT` and `HOSTNAME`, so add `HOSTNAME=0.0.0.0` as a variable. |
| `/api/health` reports the database as unreachable | `DATABASE_URL` doesn't reference the database, or the services are in different projects or environments. | Re-check the variable's reference and that both services are in the same project and environment. |
| Upload fails with 413 | The compressed file is over Cloudflare's 100 MB cap. | Not expected at about 36 MB. If the export grows that much, see the object storage item in PRD section 12. |
| Upload fails with 524 | The upload route took more than 100 seconds to respond. | The route must respond `202` before importing (PRD 7.2). |
| An import disappears during a deploy | The import runs in the web process, which a deploy replaces. | Avoid deploying during an import, and upload again if it happens. The catalog is unchanged, because the transaction rolls back (PRD D10). |

## Known limits

- **Access protects the hostname, not the server itself.**
  Removing the `*.up.railway.app` domain closes the obvious way around it.
  Fully closing it means validating Cloudflare Access's signed `Cf-Access-Jwt-Assertion` header in the app, or putting Railway behind a Cloudflare Tunnel.
  Both are post-MVP.
- **No database backups** are set up, since production hardening is a non-goal (PRD section 3).
