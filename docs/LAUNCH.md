# Internal launch: production

Staging deploys every merge to `main`. Production is the same two Railway services in the `production` environment, deploying the `production` branch, with their own Supabase project and keys.

## One-time setup (Rahul)

1. **Supabase production project** (`AgentFloor`, region near the team).
   - Enable **point-in-time recovery** (Database → Backups; Pro plan).
   - Auth → Providers → **GitHub** (a second GitHub OAuth app, callback `https://<prod-ref>.supabase.co/auth/v1/callback`), Site URL = the production web URL.
   - Apply the schema: `supabase link --project-ref <prod-ref>` then `supabase db push`.
2. **Railway production environment:** `railway environment production`, then `railway config apply` (from this repo's `.railway/railway.ts`). Set the kept (`preserve()`) variables:
   - API: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (production project), `DAYTONA_API_KEY`, `OFFICE_SNAPSHOT`, `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET`, `AGENTFLOOR_CLAUDE_TOKEN`, `LINEAR_API_KEY`.
   - Web: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (production project).
3. **GitHub App:** a production app (or add the production URLs to the existing one): Setup URL = `<prod web>/github/installed`, webhook = `<prod api>/github/webhook`.
4. **Domain (optional):** add it to the web service in Railway, then update Supabase's Site URL and the GitHub App URLs.
5. **Allowlist:** the migration seeds Rahul-2202 as admin; add the team in `<prod web>/admin`.

## Releasing

```bash
git push origin main:production
```

Then `API_URL=<prod api> WEB_URL=<prod web> npm run live-check -w @agentfloor/infra` (with production keys in the environment). Roll back by pushing the previous commit to `production`.

## Launch checklist

- [ ] Live check passes against production.
- [ ] Sign in as an allowlisted user → Ada's onboarding → the office builds.
- [ ] Start the office → agents connect; Pause → the machine stops (check `/admin` machine hours).
- [ ] GitHub: connect, pick a repo, an agent opens a PR, the CEO merges.
- [ ] Linear: connect a team, a task becomes an issue; move it in Linear → the task follows.
- [ ] A meeting: start, talk, end → minutes appear; action items become tasks.
- [ ] `/admin`: spend, machine hours and errors look right; *Back up now* works.
- [ ] Someone not on the allowlist is turned away.
