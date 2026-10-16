"use client";

import { useEffect, useState } from "react";
import { chooseRepo, githubRepos, githubStatus, type GitHubStatus } from "@/lib/api";
import { Btn } from "../bits";
import { BrandIcon } from "@/components/brands";

/** The office's GitHub: connect the app, pick the repo agents work on. */
export function GitHubCard() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [repos, setRepos] = useState<{ fullName: string }[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => githubStatus().then(setStatus, (e) => setErr(e.message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="rounded-[16px] bg-white p-3.5 ring-1 ring-black/[0.06]">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#f2f0ec]">
          <BrandIcon name="GitHub" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">GitHub</div>
          <div className="truncate text-[12px] text-muted">
            {!status
              ? "Checking…"
              : !status.configured
                ? "Not set up on this server yet"
                : !status.link
                  ? "Agents work on your repo in their own branches. Only you merge."
                  : status.link.repo
                    ? `${status.link.repo} · ${status.link.defaultBranch}`
                    : `Connected as ${status.link.account} · choose a repo`}
          </div>
        </div>
        {status?.configured && !status.link && status.installUrl && (
          <a href={status.installUrl} className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white">
            Connect
          </a>
        )}
        {status?.link && !repos && (
          <Btn className="!py-1 !text-[12px]" onClick={() => githubRepos().then((r) => setRepos(r.repos), (e) => setErr(e.message))}>
            {status.link.repo ? "Change repo" : "Choose repo"}
          </Btn>
        )}
      </div>
      {repos && (
        <select
          defaultValue=""
          onChange={(e) => e.target.value && chooseRepo(e.target.value).then(() => (setRepos(null), load()), (er) => setErr(er.message))}
          className="mt-2.5 w-full rounded-[12px] bg-[#f6f5f2] px-3 py-2 text-[13px] outline-none ring-1 ring-black/[0.06]"
        >
          <option value="">Choose a repo…</option>
          {repos.map((r) => (
            <option key={r.fullName}>{r.fullName}</option>
          ))}
        </select>
      )}
      {status?.link && status.installUrl && (
        <a href={status.installUrl} className="mt-2 inline-block text-[11.5px] font-semibold text-muted hover:text-ink">
          Give the app access to more repos ↗
        </a>
      )}
      {err && <div className="mt-2 text-[12px] text-bad">{err}</div>}
    </div>
  );
}
