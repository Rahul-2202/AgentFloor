"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LogoMark } from "@/components/Logo";
import {
  adminAllow,
  adminAllowlist,
  adminBackup,
  adminDisallow,
  adminDismiss,
  adminErrors,
  adminLetIn,
  adminOverview,
  ApiError,
  type AdminError,
  type AccessRequest,
  type AdminOverview,
  type AdminPeople,
  type AllowEntry,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";

const usd = (n: number) => `$${n.toFixed(2)}`;
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[16px] bg-white px-4 py-3 ring-1 ring-black/[0.06]">
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div className="font-display text-[24px] font-semibold tracking-[-0.02em] text-ink">{value}</div>
      {sub && <div className="text-[11.5px] text-faint">{sub}</div>}
    </div>
  );
}

/** For the people who run AgentFloor: every office, what it costs, what's breaking, and who may sign in. */
export default function Admin() {
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [errors, setErrors] = useState<AdminError[]>([]);
  const [allow, setAllow] = useState<AllowEntry[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const setPeople = (p: AdminPeople) => {
    setAllow(p.entries);
    setRequests(p.requests);
  };
  const [open, setOpen] = useState<number | null>(null);
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const [o, e, a] = await Promise.all([adminOverview(), adminErrors(), adminAllowlist()]);
      setOverview(o);
      setErrors(e.errors);
      setAllow(a.entries);
      setRequests(a.requests);
      setState("ready");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 401)) setState("denied");
      else setMsg((err as Error).message);
    }
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "INITIAL_SESSION") return;
      if (!session) setState("denied");
      else void load();
    });
    const t = setInterval(() => void load(), 60_000);
    return () => {
      data.subscription.unsubscribe();
      clearInterval(t);
    };
  }, [load]);

  if (state !== "ready")
    return (
      <main className="grid min-h-dvh place-items-center px-4 text-sm text-muted">
        {state === "loading" ? "Loading…" : (
          <span>
            Admins only. <Link href="/" className="underline">Back to your office</Link>
          </span>
        )}
      </main>
    );

  const t = overview!.totals;
  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <div>
            <h1 className="font-display text-xl font-semibold">AgentFloor admin</h1>
            <p className="text-[12.5px] text-muted">Every office, what it costs, and what&apos;s breaking. Refreshes every minute.</p>
          </div>
        </div>
        <Link href="/" className="text-sm text-muted underline">
          Your office
        </Link>
      </header>
      {msg && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">{msg}</p>}

      <section className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Offices" value={String(t.offices)} sub={`${t.running} running now`} />
        <Stat label="Model spend today" value={usd(t.spend.today)} sub={`${usd(t.spend.week)} this week`} />
        <Stat label="Model spend, 30 days" value={usd(t.spend.month)} sub="API-equivalent" />
        <Stat label="Machine hours, 7 days" value={t.machineHours.week.toFixed(1)} sub={`${t.machineHours.month.toFixed(1)} in 30 days`} />
        <Stat label="Errors, 24 h" value={String(t.errors24h)} />
      </section>

      <section className="mt-6">
        <h2 className="text-[13px] font-semibold text-muted">Offices</h2>
        <div className="mt-2 overflow-x-auto rounded-[16px] bg-white ring-1 ring-black/[0.06]">
          <table className="w-full min-w-[760px] text-left text-[12.5px]">
            <thead className="text-faint">
              <tr>
                {["Office", "Owner", "Machine", "Office link", "Spend today / 7 d / 30 d", "Machine h 7 d / 30 d", "Errors 24 h", "Created"].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overview!.offices.map((o) => (
                <tr key={o.id} className="border-t border-black/[0.05]">
                  <td className="px-3 py-2 font-semibold text-ink">
                    {o.name}
                    {!o.onboarded && <span className="ml-1.5 text-[11px] font-normal text-faint">onboarding</span>}
                  </td>
                  <td className="px-3 py-2">{o.owner ?? "?"}</td>
                  <td className="px-3 py-2">
                    <span className={o.machine === "started" ? "text-ok" : o.machine === "error" ? "text-bad" : "text-muted"}>{o.machine}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{o.connected ? "connected" : `seen ${ago(o.seenAt)}`}</td>
                  <td className="px-3 py-2">
                    {usd(o.spend.today)} / {usd(o.spend.week)} / {usd(o.spend.month)}
                  </td>
                  <td className="px-3 py-2">
                    {o.machineHours.week.toFixed(1)} / {o.machineHours.month.toFixed(1)}
                  </td>
                  <td className={`px-3 py-2 ${o.errors24h ? "font-semibold text-bad" : "text-muted"}`}>{o.errors24h}</td>
                  <td className="px-3 py-2 text-muted">{ago(o.createdAt)}</td>
                </tr>
              ))}
              {!overview!.offices.length && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-faint">
                    No offices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section>
          <h2 className="text-[13px] font-semibold text-muted">Errors · newest first</h2>
          <div className="mt-2 flex flex-col gap-1.5">
            {errors.map((e) => (
              <button key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)} className="rounded-[12px] bg-white px-3 py-2 text-left ring-1 ring-black/[0.06] hover:ring-black/15">
                <div className="flex items-center gap-2 text-[11.5px] text-faint">
                  <span className={`rounded-full px-1.5 py-[1px] font-bold uppercase ${e.source === "web" ? "bg-[#eef0fb] text-[#4a55a8]" : e.source === "office" ? "bg-[#fdf3e0] text-[#8a5a10]" : "bg-[#fdecea] text-[#9b2c24]"}`}>{e.source}</span>
                  <span>
                    ×{e.count} · last {ago(e.last_seen)} · first {ago(e.first_seen)}
                  </span>
                  {e.office_id && <span className="font-mono">{overview!.offices.find((o) => o.id === e.office_id)?.name ?? e.office_id.slice(0, 8)}</span>}
                </div>
                <div className="mt-0.5 break-words font-mono text-[12px] text-ink">{e.message}</div>
                {open === e.id && (e.stack || Object.keys(e.context ?? {}).length > 0) && (
                  <pre className="mt-2 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-[8px] bg-[#fbfaf8] p-2 text-[11px] text-ink-2">
                    {e.stack}
                    {Object.keys(e.context ?? {}).length ? `\n\n${JSON.stringify(e.context, null, 2)}` : ""}
                  </pre>
                )}
              </button>
            ))}
            {!errors.length && <p className="text-[12.5px] text-faint">No errors recorded.</p>}
          </div>
        </section>

        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
              Asking to join
              {requests.length > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">{requests.length}</span>}
            </h2>
            <div className="mt-2 rounded-[16px] bg-white p-2 ring-1 ring-black/[0.06]">
              {requests.map((r) => (
                <div key={r.id} className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[12.5px] hover:bg-[#f6f5f2]">
                  {r.githubLogin ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`https://github.com/${r.githubLogin}.png?size=64`} alt="" className="h-8 w-8 shrink-0 rounded-full bg-[#f2f0ec]" />
                  ) : (
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#f2f0ec] text-[12px] font-bold text-muted">{(r.name ?? r.email ?? "?")[0]!.toUpperCase()}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    {r.githubLogin ? (
                      <a href={`https://github.com/${r.githubLogin}`} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:underline">
                        {r.githubLogin}
                      </a>
                    ) : (
                      <span className="font-semibold text-ink">{r.email}</span>
                    )}
                    <span className="block truncate text-[11.5px] text-faint">
                      {[r.name, r.githubLogin && r.email].filter(Boolean).join(" · ")}
                      {r.name || (r.githubLogin && r.email) ? " · " : ""}tried {ago(r.lastAt)}
                    </span>
                  </span>
                  <button
                    onClick={() => adminLetIn(r.id).then(setPeople, (e) => setMsg((e as Error).message))}
                    className="shrink-0 rounded-[8px] bg-ink px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-black"
                  >
                    Let in
                  </button>
                  <button
                    onClick={() => adminDismiss(r.id).then(setPeople, (e) => setMsg((e as Error).message))}
                    className="shrink-0 text-[11.5px] font-semibold text-muted hover:text-bad"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
              {!requests.length && <p className="px-2 py-1.5 text-[12.5px] text-faint">Nobody waiting. People who sign in without an invite show up here.</p>}
            </div>
          </section>

          <section>
            <h2 className="text-[13px] font-semibold text-muted">Who may sign in</h2>
            <div className="mt-2 rounded-[16px] bg-white p-2 ring-1 ring-black/[0.06]">
              {allow.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-[10px] px-2 py-1.5 text-[12.5px] hover:bg-[#f6f5f2]">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{a.githubLogin ?? a.email}</span>
                    {a.admin && <span className="ml-1.5 rounded bg-ink px-1 text-[9.5px] font-bold uppercase text-white">admin</span>}
                    {a.note && <span className="block truncate text-[11.5px] text-faint">{a.note}</span>}
                  </span>
                  <button
                    onClick={() => adminDisallow(a.id).then(setPeople, (e) => setMsg((e as Error).message))}
                    className="shrink-0 text-[11.5px] font-semibold text-muted hover:text-bad"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <form
                className="mt-2 flex flex-col gap-1.5 border-t border-black/[0.05] p-1.5 pt-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = who.trim();
                  if (!v) return;
                  void adminAllow(v.includes("@") ? { email: v, note } : { githubLogin: v, note }).then(
                    (r) => {
                      setPeople(r);
                      setWho("");
                      setNote("");
                    },
                    (err) => setMsg((err as Error).message),
                  );
                }}
              >
                <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="GitHub login or email" className="rounded-[10px] bg-[#f6f5f2] px-2.5 py-1.5 text-[12.5px] outline-none ring-1 ring-black/[0.06]" />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (who they are)" className="rounded-[10px] bg-[#f6f5f2] px-2.5 py-1.5 text-[12.5px] outline-none ring-1 ring-black/[0.06]" />
                <button className="rounded-[10px] bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white">Let them in</button>
              </form>
            </div>
          </section>

          <section>
            <h2 className="text-[13px] font-semibold text-muted">Backups</h2>
            <div className="mt-2 rounded-[16px] bg-white p-3 text-[12.5px] text-ink-2 ring-1 ring-black/[0.06]">
              Every office&apos;s memory is copied to the private <span className="font-mono">backups</span> bucket nightly at 03:00 UTC (30 days kept). Database recovery is Supabase&apos;s point-in-time recovery.
              <button
                onClick={() => adminBackup().then((r) => setMsg(`Backed up memory for ${r.offices} offices.`), (e) => setMsg((e as Error).message))}
                className="mt-2 block rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-black/[0.1] hover:bg-[#f6f5f2]"
              >
                Back up now
              </button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
