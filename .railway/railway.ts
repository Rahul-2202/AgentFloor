// Railway infrastructure for AgentFloor: the web app and the Control API,
// both built from this monorepo. Preview with `railway config plan`, apply
// with `railway config apply`. Secrets are set in Railway and kept (preserve()).
import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  // Staging deploys every merge to main. Production deploys the "production"
  // branch: promote a tested main with `git push origin main:production`
  // (see docs/LAUNCH.md). Each environment has its own Supabase project and keys.
  const production = ctx.environment === "production";
  const source = github("Rahul-2202/AgentFloor", { branch: production ? "production" : "main" });

  const api = service("api", {
    source,
    // The API also ships the office code (packages/daemon) to office machines: changes there redeploy it.
    build: { builder: "RAILPACK", watchPatterns: ["apps/api/**", "packages/daemon/**", "packages/shared/**", "package-lock.json"] },
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
      // The GitHub App (agents' repo access); the private key is kept as set on Railway.
      GITHUB_APP_ID: preserve(),
      GITHUB_APP_SLUG: preserve(),
      GITHUB_APP_PRIVATE_KEY: preserve(),
      GITHUB_WEBHOOK_SECRET: preserve(),
      // Ada runs on the company's Claude login (claude setup-token); kept as set on Railway.
      AGENTFLOOR_CLAUDE_TOKEN: preserve(),
      ADA_MODEL: "haiku",
      // Linear (office tasks ↔ issues): a personal API key, kept as set on Railway.
      LINEAR_API_KEY: preserve(),
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
