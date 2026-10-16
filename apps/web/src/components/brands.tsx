import {
  siAirtable,
  siAsana,
  siCalendly,
  siClaude,
  siConfluence,
  siDiscord,
  siDropbox,
  siFigma,
  siGithub,
  siGitlab,
  siGmail,
  siGooglecalendar,
  siGoogledocs,
  siGoogledrive,
  siGooglemeet,
  siGooglesheets,
  siHubspot,
  siInstagram,
  siIntercom,
  siJira,
  siLinear,
  siMailchimp,
  siNotion,
  siQuickbooks,
  siSentry,
  siShopify,
  siStripe,
  siSupabase,
  siTrello,
  siVercel,
  siWhatsapp,
  siX,
  siXero,
  siYoutube,
  siZendesk,
  siZoom,
} from "simple-icons";

type Icon = { title: string; hex: string; path: string };

const ICONS: Record<string, Icon> = {
  Airtable: siAirtable,
  Asana: siAsana,
  Calendly: siCalendly,
  Claude: siClaude,
  Confluence: siConfluence,
  Discord: siDiscord,
  Dropbox: siDropbox,
  Figma: siFigma,
  GitHub: siGithub,
  GitLab: siGitlab,
  Gmail: siGmail,
  "Google Calendar": siGooglecalendar,
  "Google Docs": siGoogledocs,
  "Google Drive": siGoogledrive,
  "Google Meet": siGooglemeet,
  "Google Sheets": siGooglesheets,
  HubSpot: siHubspot,
  Instagram: siInstagram,
  Intercom: siIntercom,
  Jira: siJira,
  Linear: siLinear,
  Mailchimp: siMailchimp,
  Notion: siNotion,
  QuickBooks: siQuickbooks,
  Sentry: siSentry,
  Shopify: siShopify,
  Stripe: siStripe,
  Supabase: siSupabase,
  Trello: siTrello,
  Vercel: siVercel,
  WhatsApp: siWhatsapp,
  X: siX,
  Xero: siXero,
  YouTube: siYoutube,
  Zendesk: siZendesk,
  Zoom: siZoom,
};

const FILES: Record<string, string> = {
  Slack: "/logos/slack.svg",
  LinkedIn: "/logos/linkedin.svg",
  Salesforce: "/logos/salesforce.svg",
  "Microsoft Teams": "/logos/teams.svg",
};

export function BrandIcon({ name, size = 16, mono = false }: { name: string; size?: number; mono?: boolean }) {
  const file = FILES[name];
  if (file)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={file} alt="" width={size} height={size} style={{ width: size, height: size, filter: mono ? "grayscale(1)" : undefined }} />;
  const ic = ICONS[name];
  if (!ic) {
    if (name === "Codex")
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <rect width="24" height="24" rx="6" fill="#0a0a0a" />
          <path d="M8 8.5 11.5 12 8 15.5M13 15.5h4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    return (
      <span
        className="grid place-items-center rounded-[5px] bg-ink text-[9px] font-bold text-white"
        style={{ width: size, height: size }}
      >
        {name[0]}
      </span>
    );
  }
  const dark = ["000000", "181717", "0A0A0A"].includes(ic.hex.toUpperCase());
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d={ic.path} fill={mono ? "currentColor" : dark ? "#0a0a0a" : `#${ic.hex}`} />
    </svg>
  );
}

export function BrandChip({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-white font-semibold text-ink ring-1 ring-black/[0.08] ${
        size === "sm" ? "px-2 py-[3px] text-[11.5px]" : "px-2.5 py-1 text-[13px]"
      }`}
    >
      <BrandIcon name={name} size={size === "sm" ? 12 : 14} />
      {name}
    </span>
  );
}
