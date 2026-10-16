// Railway infrastructure for AgentFloor: the web app and the Control API,
// both built from this monorepo. Preview with `railway config plan`, apply
// with `railway config apply`. Secrets are set in Railway and kept (preserve()).
import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  // Production comes with the internal launch (M8); staging deploys from main.
  if (ctx.environment === "production") return project("AgentFloor", { resources: [] });

  const source = github("Rahul-2202/AgentFloor", { branch: "main" });

  const api = service("api", {
    source,
    build: { builder: "RAILPACK", watchPatterns: ["apps/api/**", "packages/shared/**", "package-lock.json"] },
    start: "npm run start -w @agentfloor/api",
    healthcheck: "/health",
    healthcheckTimeout: 60,
    env: {
      SUPABASE_URL: preserve(),
      SUPABASE_SECRET_KEY: preserve(),
      WEB_ORIGINS: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",
      // Office machines (Daytona). The snapshot name comes from infra/build-office-snapshot.ts.
      DAYTONA_API_KEY: preserve(),
      OFFICE_SNAPSHOT: preserve(),
      OFFICE_SANDBOX_KIND: "container",
    },
  });

  const web = service("web", {
    source,
    build: {
      builder: "RAILPACK",
      buildCommand: "npm run build -w @agentfloor/web",
      watchPatterns: ["apps/web/**", "packages/shared/**", "package-lock.json"],
    },
    start: "npm run start -w @agentfloor/web",
    healthcheck: "/",
    healthcheckTimeout: 120,
    env: {
      SUPABASE_URL: preserve(),
      SUPABASE_PUBLISHABLE_KEY: preserve(),
      NEXT_PUBLIC_API_URL: "https://${{api.RAILWAY_PUBLIC_DOMAIN}}",
    },
  });

  return project("AgentFloor", { resources: [api, web] });
});
