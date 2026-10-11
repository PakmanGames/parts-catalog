/**
 * The Railway project as code (PRD WS-E, docs/deploy.md).
 *
 * Railway doesn't read this file when it deploys. Preview changes with `railway config plan`, then
 * make them with `railway config apply`. An apply deletes anything in the project that isn't
 * declared here, so every resource stays listed, including ones only Railway's dashboard touches.
 */
import { defineRailway, github, postgres, project, service, volume } from "railway/iac";

// Railway's US East (Virginia) region. The web service and the database share it, so queries stay
// on the private network.
const region = "us-east4-eqdc4a";

export default defineRailway(() => {
  // Railway's Postgres template, which runs Postgres 18 (PRD 7.1).
  const db = postgres("Postgres", { region });
  db.networking = { privateNetworkEndpoint: "postgres" };
  // The database's data. Railway attaches it to the database itself; it's declared so an apply
  // doesn't delete it.
  const dbData = volume("postgres-volume-HUy5", {
    region,
    sizeMB: 5000,
    allowOnlineResize: true,
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
  });

  const web = service("web", {
    source: github("PakmanGames/parts-catalog", { branch: "main" }),
    build: "pnpm build",
    start: "pnpm start",
    // Runs with production dependencies only (src/db/migrate.ts). A failure stops the deploy.
    preDeploy: "pnpm db:migrate",
    // Railway switches traffic only once this returns 200, which needs a working database connection.
    healthcheck: "/api/health",
    replicas: { [region]: 1 },
    // Behind Cloudflare Access (docs/deploy.md). Railway's generated *.up.railway.app domain isn't
    // declared here; it's removed after setup because it bypasses Access.
    domains: ["parts-catalog.apak.ca"],
    // Imports run in the background after the upload request returns (PRD D10), so the service
    // must never sleep.
    deploy: { sleepApplication: false },
    env: {
      // The database's private URL, so traffic stays on Railway's private network.
      DATABASE_URL: db.env.DATABASE_URL,
      // Next.js standalone listens on HOSTNAME, which the container otherwise sets to its own ID.
      HOSTNAME: "0.0.0.0",
    },
  });

  return project("parts-catalog", {
    resources: [db, dbData, web],
  });
});
