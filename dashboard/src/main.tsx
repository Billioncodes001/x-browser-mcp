import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  FileSearch,
  FolderOpen,
  Globe2,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./styles.css";
import type { PreparedAction, SessionState, RecordData } from "../../src/types";
import type { SavedSearch, Snapshot } from "../../src/store";
import { ReviewedExport } from "./review-export";

type Summary = {
  id: string;
  label?: string;
  kind: string;
  sourceUrl: string;
  capturedAt: string;
  count: number;
};
type State = {
  version: string;
  mode: string;
  session: SessionState;
  searches: SavedSearch[];
  snapshots: Summary[];
  prepared: PreparedAction[];
  receipts: Record<string, unknown>[];
  config: {
    dataDir: string;
    profileDir: string;
    browserChannel: string;
    browserAvailable: boolean | null;
    headless: boolean;
    enableWrites: boolean;
    delayMs: number;
    customBrowser: boolean;
    overrides: string[];
  };
  mcpConfig: string;
};
const token =
  document.querySelector<HTMLMetaElement>('meta[name="dashboard-token"]')
    ?.content ?? "";
async function request(path: string, body?: unknown) {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Dashboard-Token": token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({
      message: "The local service could not complete this request.",
    }));
    throw new Error(data.message);
  }
  return response;
}
async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  return (await request(path, body)).json();
}
function navigate(route: string) {
  location.hash = route;
}
function stamp(value: unknown) {
  if (!value) return "Not yet";
  const d = new Date(String(value));
  return Number.isNaN(+d)
    ? String(value)
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function human(value: unknown) {
  return String(value ?? "").replaceAll("_", " ");
}
function safeUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function shortSource(value: string) {
  try {
    const u = new URL(value);
    return u.pathname === "/search"
      ? u.searchParams.get("q") || "X search"
      : u.pathname;
  } catch {
    return value;
  }
}
const Ctx = createContext<{
  data: State;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}>(null!);
const useApp = () => useContext(Ctx);
function IconLogo() {
  return (
    <span className="logo-mark">
      <img src="/mark.svg" alt="" />
    </span>
  );
}
function Button({
  children,
  variant = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return (
    <button
      className={"button " + variant + " " + (props.className ?? "")}
      {...props}
    >
      {children}
    </button>
  );
}
function Notice({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <div
      className={"notice " + tone}
      role={tone === "error" ? "alert" : undefined}
    >
      <ShieldCheck size={16} />
      <div>{children}</div>
    </div>
  );
}
function Badge({ value }: { value: unknown }) {
  const v = String(value);
  return (
    <span
      className={
        "badge " +
        (["logged_in", "verified", "ready"].includes(v)
          ? "good"
          : [
                "failed_or_uncertain",
                "checkpoint",
                "rate_limited",
                "unavailable",
              ].includes(v)
            ? "warn"
            : "")
      }
    >
      <span />
      {human(v)}
    </span>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
function Checkbox({
  children,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...props} />
      <span>{children}</span>
    </label>
  );
}
function Form({
  children,
  onSubmit,
  className = "",
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className={className}
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (busy) return;
        const data = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await onSubmit(data);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Operation failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>{children}</fieldset>
      {busy && (
        <p role="status" className="working">
          <LoaderCircle className="spin" size={14} />
          Working. Browser collections can take a minute.
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}
function Action({
  children,
  onClick,
  variant = "",
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => Promise<void>;
  variant?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="inline-action">
      <Button
        variant={variant}
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await onClick();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Operation failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <LoaderCircle className="spin" size={15} /> : null}
        {children}
      </Button>
      {error && (
        <p role="alert" className="action-error">
          {error}
        </p>
      )}
    </div>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <FolderOpen size={25} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
function Section({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
function External({ href, children }: { href: unknown; children: ReactNode }) {
  const url = safeUrl(href);
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="external"
    >
      {children}
      <ArrowUpRight size={13} />
    </a>
  ) : (
    <span>{children}</span>
  );
}
async function download(id: string, format: string) {
  const response = await request("/export", { id, format });
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `x-collection-${id}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function CollectionRows({ items }: { items: Summary[] }) {
  return (
    <div className="collection-rows">
      {items.map((s) => (
        <a className="collection-row" href={"#snapshot/" + s.id} key={s.id}>
          <span className="file-icon">
            <FileSearch size={18} />
          </span>
          <div>
            <h3>{s.label || shortSource(s.sourceUrl)}</h3>
            <p>
              {human(s.kind)} · {stamp(s.capturedAt)}
            </p>
          </div>
          <span className="count">
            {s.count} {s.count === 1 ? "record" : "records"}
          </span>
          <ChevronRight size={15} />
        </a>
      ))}
    </div>
  );
}

function Overview() {
  const { data: d, refresh } = useApp();
  return (
    <>
      <Heading
        eyebrow="YOUR RESEARCH WORKSPACE"
        title="A little more perspective."
        description="Your X research, organized in one private place."
        action={
          <span className="local-pill">
            <span />
            Running on this computer
          </span>
        }
      />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">OBSERVE. COLLECT. UNDERSTAND.</p>
          <h2>
            A clear view of
            <br />
            <em>the conversation.</em>
          </h2>
          <p>
            Follow the subjects that matter. Gather original posts, compare
            observations, and keep a clear record of what you find.
          </p>
          <Button onClick={() => navigate("research")}>
            Start a collection
            <ArrowRight size={16} />
          </Button>
          <div className="hero-foot">
            <LockKeyhole size={13} />
            Private browser session · Local storage
          </div>
        </div>
        <div className="hero-photo">
          <img
            src="/research-desk.png"
            alt="Newspapers, a pencil and a magnifying glass on a research desk"
          />
          <span>LOOK CLOSER. KEEP THE SOURCE.</span>
        </div>
      </section>
      <div className="overview-grid">
        <section className="card session-card">
          <Section
            title="Your browser session"
            action={<Badge value={d.session.state} />}
          />
          <div className="session-identity">
            <span className="account-mark">𝕏</span>
            <div>
              <h3>
                {d.session.account
                  ? "@" + d.session.account
                  : "Connect your X account"}
              </h3>
              <p>
                {d.session.account
                  ? "Dedicated research profile"
                  : "Sign in directly in the browser that opens."}
              </p>
            </div>
          </div>
          <p className="muted session-message">
            {d.session.state === "closed"
              ? "Your saved login stays in a dedicated profile on this computer. Open the browser when you are ready."
              : d.session.message}
          </p>
          <div className="button-row">
            <Action
              onClick={async () => {
                await api("/session/open", {});
                await refresh();
              }}
            >
              <Monitor size={15} />
              {d.session.state === "closed"
                ? "Open X browser"
                : "Check X browser"}
            </Action>
            <Button variant="quiet" onClick={() => navigate("setup")}>
              Manage setup
              <ArrowRight size={14} />
            </Button>
          </div>
        </section>
        <div className="summary-cards">
          <a className="card summary" href="#collections">
            <FolderOpen size={18} />
            <strong>{d.snapshots.length}</strong>
            <span>Recent collections</span>
            <ChevronRight size={15} />
          </a>
          <a className="card summary" href="#searches">
            <Bookmark size={18} />
            <strong>{d.searches.length}</strong>
            <span>Saved searches</span>
            <ChevronRight size={15} />
          </a>
          <a className="card summary" href="#actions">
            <SquarePen size={18} />
            <strong>{d.prepared.length}</strong>
            <span>Actions to review</span>
            <ChevronRight size={15} />
          </a>
        </div>
      </div>
      <div className="two-column">
        <section className="card">
          <Section
            title="Recent collections"
            description="Original sources, preserved with capture times."
            action={
              <a className="text-link" href="#collections">
                View all
                <ArrowRight size={14} />
              </a>
            }
          />
          {d.snapshots.length ? (
            <CollectionRows items={d.snapshots.slice(0, 4)} />
          ) : (
            <Empty title="Your research begins here">
              Run a search or read a timeline to create your first collection.
            </Empty>
          )}
        </section>
        <section className="card getting-started">
          <Section title="A considered workflow" />
          <div>
            <span>01</span>
            <div>
              <h3>Connect your browser</h3>
              <p>Use a dedicated profile and sign in yourself.</p>
            </div>
          </div>
          <div>
            <span>02</span>
            <div>
              <h3>Collect with a purpose</h3>
              <p>Search a topic, follow a profile, or read a thread.</p>
            </div>
          </div>
          <div>
            <span>03</span>
            <div>
              <h3>Keep the evidence</h3>
              <p>Inspect the sample, compare it, and export your findings.</p>
            </div>
          </div>
          <a className="text-link" href="#setup">
            Complete your setup
            <ArrowRight size={14} />
          </a>
        </section>
      </div>
      <Notice>
        Collections are bounded samples of what X displays. Each keeps its
        source, capture time and coverage limits.
      </Notice>
    </>
  );
}

function Setup() {
  const { data: d, refresh, notify } = useApp();
  const c = d.config;
  const locked = (field: string) => c.overrides.includes(field);
  const [picture, setPicture] = useState("");
  useEffect(
    () => () => {
      if (picture) URL.revokeObjectURL(picture);
    },
    [picture],
  );
  return (
    <>
      <Heading
        eyebrow="LOCAL SETUP"
        title="Make yourself at home."
        description="Choose your browser, connect your account and bring the workspace into your MCP client."
      />
      <div className="two-column">
        <section className="card padded">
          <Section
            title="01 · Browser preferences"
            description="Saved on this computer and reused on the next launch."
          />
          {d.session.state !== "closed" && (
            <Notice>
              Close the browser session below before saving preferences. Your
              login will be preserved.
            </Notice>
          )}
          <Form
            key={JSON.stringify(c)}
            onSubmit={async (f) => {
              await api("/settings", {
                browserChannel: String(f.get("browser") || c.browserChannel),
                delayMs: Number(f.get("delay") || c.delayMs),
                headless: locked("headless") ? c.headless : f.has("headless"),
                enableWrites: locked("enableWrites")
                  ? c.enableWrites
                  : f.has("writes"),
              });
              notify("Browser preferences saved");
              await refresh();
            }}
          >
            <Field
              label="Browser"
              hint={
                c.customBrowser
                  ? "A custom executable or CDP connection is configured in your launch environment."
                  : "Chrome and Edge use a separate profile, not your everyday browser profile."
              }
            >
              {(id) => (
                <select
                  id={id}
                  name="browser"
                  defaultValue={c.browserChannel}
                  disabled={locked("browserChannel")}
                >
                  <option value="chromium">Playwright Chromium</option>
                  <option value="chrome">Google Chrome</option>
                  <option value="msedge">Microsoft Edge</option>
                </select>
              )}
            </Field>
            {c.browserAvailable === false && (
              <Notice tone="error">
                Chromium is not installed. Run{" "}
                <code>npx playwright install chromium</code>, or select
                installed Chrome / Edge.
              </Notice>
            )}
            <Field
              label="Delay between page operations (milliseconds)"
              hint="A measured pace gives X time to render. Allowed range: 500–10,000 ms."
            >
              {(id) => (
                <input
                  id={id}
                  name="delay"
                  type="number"
                  min="500"
                  max="10000"
                  required
                  defaultValue={c.delayMs}
                  disabled={locked("delayMs")}
                />
              )}
            </Field>
            <Checkbox
              name="headless"
              defaultChecked={c.headless}
              disabled={locked("headless")}
            >
              Run the browser without a visible window after signing in
            </Checkbox>
            <Checkbox
              name="writes"
              defaultChecked={c.enableWrites}
              disabled={locked("enableWrites")}
            >
              Allow account actions after reviewing and confirming each preview
            </Checkbox>
            {c.overrides.length > 0 && (
              <p className="hint">
                Some settings are controlled by your launch environment and are
                locked here.
              </p>
            )}
            <Button type="submit" disabled={d.session.state !== "closed"}>
              <Check size={16} />
              Save preferences
            </Button>
          </Form>
        </section>
        <div className="stack">
          <section className="card padded">
            <Section
              title="02 · Connect your account"
              action={<Badge value={d.session.state} />}
            />
            <p className="muted">
              Open X, complete sign-in in its own window, then return here.
              Passwords and verification codes never go through this dashboard.
            </p>
            {c.headless && (
              <Notice>
                Turn off the hidden browser setting for first-time sign-in.
              </Notice>
            )}
            <div className="button-row mt">
              <Action
                onClick={async () => {
                  await api("/session/open", {});
                  await refresh();
                }}
              >
                <Monitor size={15} />
                Open X browser
              </Action>
              <Action variant="secondary" onClick={refresh}>
                <RefreshCw size={14} />
                Refresh status
              </Action>
            </div>
            <p className="session-note">
              {d.session.state === "closed"
                ? "The browser is closed."
                : d.session.message}
            </p>
            <div className="button-row">
              <Action
                variant="quiet"
                disabled={d.session.state === "closed"}
                onClick={async () => {
                  await api("/session/close", {});
                  setPicture("");
                  await refresh();
                  notify("Browser closed; saved login retained");
                }}
              >
                Close browser
              </Action>
              <Action
                variant="quiet"
                disabled={d.session.state !== "logged_in"}
                onClick={async () => {
                  const r = await request("/session/screenshot", {});
                  setPicture(URL.createObjectURL(await r.blob()));
                }}
              >
                Inspect screenshot
              </Action>
            </div>
            {picture && (
              <figure className="session-picture">
                <img src={picture} alt="Current X browser viewport" />
                <figcaption>Private session screenshot</figcaption>
              </figure>
            )}
          </section>
          <section className="card padded storage">
            <Section title="Stored on your computer" />
            <p>Browser profile</p>
            <code>{c.profileDir}</code>
            <p>Collections and preferences</p>
            <code>{c.dataDir}</code>
            <div className="storage-foot">
              <LockKeyhole size={15} />
              Private account data stays outside the repository.
            </div>
          </section>
        </div>
      </div>
      <section className="card padded">
        <Section
          title="03 · Connect your MCP client"
          description="This configuration starts the dashboard and MCP together, sharing one browser."
          action={
            <Action
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(d.mcpConfig);
                notify("MCP configuration copied");
              }}
            >
              <Copy size={14} />
              Copy configuration
            </Action>
          }
        />
        <pre className="code-block">{d.mcpConfig}</pre>
        <Notice>
          {d.mode === "shared"
            ? "This dashboard already shares its session with the MCP server."
            : "You are running the standalone dashboard. Stop this process before launching the shared MCP configuration, so only one process owns this profile and port."}
        </Notice>
      </section>
    </>
  );
}

const surfaces = [
  ["search", "Search X"],
  ["timeline", "Home timeline"],
  ["profile_posts", "Profile posts"],
  ["thread", "Post & conversation"],
  ["bookmarks", "Bookmarks"],
  ["connections", "Followers / following"],
  ["notifications", "Notifications"],
  ["trends", "Trends"],
];
const tabs: Record<string, string[]> = {
  search: ["latest", "top", "people", "photos", "videos"],
  timeline: ["Following", "For you"],
  profile_posts: ["posts", "replies", "media"],
  connections: ["followers", "following"],
  notifications: ["all", "mentions"],
};
function Research() {
  const { data: d, refresh, notify } = useApp();
  const [source, setSource] = useState("search"),
    [tab, setTab] = useState("latest"),
    [profile, setProfile] = useState<RecordData | null>(null);
  return (
    <>
      <Heading
        eyebrow="RESEARCH DESK"
        title="Follow a question."
        description="Collect a purposeful sample from the browser you have connected."
        action={<Badge value={d.session.state} />}
      />
      <div className="two-column">
        <section className="card padded">
          <Section
            title="Start a collection"
            description="Choose a surface and set clear collection limits."
          />
          <Form
            onSubmit={async (f) => {
              const result = await api<Snapshot>("/read", {
                source,
                ...(tabs[source] ? { tab } : {}),
                ...(source === "search"
                  ? { query: String(f.get("query")) }
                  : {}),
                ...(["profile_posts", "connections"].includes(source)
                  ? { handle: String(f.get("handle")) }
                  : {}),
                ...(source === "thread" ? { url: String(f.get("url")) } : {}),
                limit: Number(f.get("limit")),
                maxScrolls: Number(f.get("scrolls")),
              });
              await refresh();
              navigate("snapshot/" + result.id);
            }}
          >
            <Field label="Content source">
              {(id) => (
                <select
                  id={id}
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setTab(tabs[e.target.value]?.[0] ?? "");
                  }}
                >
                  {surfaces.map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {source === "search" && (
              <Field
                label="Search query"
                hint="Use X operators such as from:NASA, a quoted phrase, or lang:en."
              >
                {(id) => (
                  <input
                    id={id}
                    name="query"
                    placeholder='"space exploration" lang:en'
                    maxLength={1000}
                    required
                  />
                )}
              </Field>
            )}
            {["profile_posts", "connections"].includes(source) && (
              <Field label="Account handle">
                {(id) => (
                  <input
                    id={id}
                    name="handle"
                    placeholder="@account"
                    maxLength={16}
                    required
                  />
                )}
              </Field>
            )}
            {source === "thread" && (
              <Field label="Post URL">
                {(id) => (
                  <input
                    id={id}
                    name="url"
                    type="url"
                    placeholder="https://x.com/account/status/123"
                    maxLength={300}
                    required
                  />
                )}
              </Field>
            )}
            {tabs[source] && (
              <Field label="Selected tab">
                {(id) => (
                  <select
                    id={id}
                    value={tab}
                    onChange={(e) => setTab(e.target.value)}
                  >
                    {tabs[source].map((t) => (
                      <option key={t} value={t}>
                        {human(t)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <div className="form-grid">
              <Field label="Maximum records">
                {(id) => (
                  <input
                    id={id}
                    name="limit"
                    type="number"
                    min="1"
                    max="200"
                    defaultValue="40"
                    required
                  />
                )}
              </Field>
              <Field label="Maximum scrolls">
                {(id) => (
                  <input
                    id={id}
                    name="scrolls"
                    type="number"
                    min="0"
                    max="30"
                    defaultValue="8"
                    required
                  />
                )}
              </Field>
            </div>
            {source === "notifications" && (
              <Notice>Opening notifications can mark them seen in X.</Notice>
            )}
            <Button type="submit">
              <Search size={16} />
              Collect records
              <ArrowRight size={16} />
            </Button>
          </Form>
        </section>
        <div className="stack">
          <section className="card padded">
            <Section title="Before you collect" />
            <ul className="check-list">
              <li>
                <Check size={16} />
                Open your browser and confirm the account.
              </li>
              <li>
                <Check size={16} />
                Use the English X interface for labeled controls.
              </li>
              <li>
                <Check size={16} />
                Start with a focused query and modest limits.
              </li>
              <li>
                <Check size={16} />
                Read the coverage notes with your results.
              </li>
            </ul>
            {d.session.state !== "logged_in" && (
              <a className="text-link" href="#setup">
                Connect your browser
                <ArrowRight size={14} />
              </a>
            )}
            <p className="hint mt">
              X may show checkpoints, rate limits or changed layouts. The tool
              reports these instead of claiming a complete collection.
            </p>
          </section>
          <section className="card padded">
            <Section
              title="Look up a profile"
              description="Inspect the visible biography, links and displayed counts."
            />
            <Form
              onSubmit={async (f) => {
                setProfile(
                  await api<RecordData>("/profile", {
                    handle: String(f.get("handle")),
                  }),
                );
                notify("Profile retrieved");
              }}
            >
              <Field label="Profile handle">
                {(id) => (
                  <input
                    name="handle"
                    id={id}
                    placeholder="@account"
                    required
                    maxLength={16}
                  />
                )}
              </Field>
              <Button variant="secondary" type="submit">
                Read profile
                <ArrowUpRight size={15} />
              </Button>
            </Form>
            {profile && (
              <details className="details" open>
                <summary>Profile details</summary>
                <pre>{JSON.stringify(profile, null, 2)}</pre>
              </details>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Searches() {
  const { data: d, refresh, notify } = useApp();
  const [editing, setEditing] = useState<SavedSearch | null>(null),
    [comparison, setComparison] = useState<Record<string, unknown> | null>(
      null,
    );
  return (
    <>
      <Heading
        eyebrow="REPEATABLE RESEARCH"
        title="Keep the questions that matter."
        description="Save a search, run it again and compare what you observe."
      />
      <div className="two-column">
        <section className="card">
          <Section
            title="Saved searches"
            description="Each run creates a new local snapshot."
          />
          {d.searches.length ? (
            <div className="saved-list">
              {d.searches.map((s) => (
                <article key={s.name}>
                  <div className="saved-heading">
                    <Bookmark size={17} />
                    <h3>{s.name}</h3>
                    <span>{s.tab}</span>
                  </div>
                  <p>{s.query}</p>
                  <div className="saved-meta">
                    Up to {s.limit} records · {s.maxScrolls} scrolls
                    {s.lastSnapshotId && (
                      <a href={"#snapshot/" + s.lastSnapshotId}>
                        Last collection
                        <ArrowUpRight size={12} />
                      </a>
                    )}
                  </div>
                  <div className="button-row">
                    <Action
                      onClick={async () => {
                        const result = await api<{
                          snapshot: Snapshot;
                          comparison: Record<string, unknown> | null;
                          baselineAdvanced: boolean;
                        }>("/searches/run", { name: s.name });
                        setComparison(result.comparison);
                        await refresh();
                        notify(
                          result.baselineAdvanced
                            ? "Search completed; comparison baseline updated"
                            : "Collection saved; comparison baseline unchanged",
                        );
                        navigate("snapshot/" + result.snapshot.id);
                      }}
                    >
                      <Play size={13} />
                      Run search
                    </Action>
                    <Button variant="quiet" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Action
                      variant="quiet"
                      onClick={async () => {
                        await api("/searches/delete", { name: s.name });
                        if (editing?.name === s.name) setEditing(null);
                        await refresh();
                        notify("Saved search removed; collections retained");
                      }}
                    >
                      <Trash2 size={13} />
                      Remove
                    </Action>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title="A useful question is worth saving">
              Create your first saved search alongside. Run it whenever you need
              a fresh sample.
            </Empty>
          )}
        </section>
        <section className="card padded">
          <Section
            title={editing ? "Edit saved search" : "Save a new search"}
            description="Runs happen when you request them; no background schedule is created."
          />
          <Form
            key={editing?.name ?? "new"}
            onSubmit={async (f) => {
              await api("/searches/save", {
                name: String(f.get("name")),
                query: String(f.get("query")),
                tab: String(f.get("tab")),
                limit: Number(f.get("limit")),
                maxScrolls: Number(f.get("scrolls")),
              });
              setEditing(null);
              await refresh();
              notify("Saved search updated");
            }}
          >
            <Field
              label="Search name"
              hint="Letters, numbers, hyphens and underscores."
            >
              {(id) => (
                <input
                  id={id}
                  name="name"
                  defaultValue={editing?.name ?? ""}
                  readOnly={!!editing}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
                  maxLength={64}
                  placeholder="industry-news"
                  required
                />
              )}
            </Field>
            <Field label="Query">
              {(id) => (
                <textarea
                  id={id}
                  name="query"
                  defaultValue={editing?.query ?? ""}
                  maxLength={1000}
                  rows={3}
                  required
                  placeholder='"your subject" lang:en'
                />
              )}
            </Field>
            <Field label="Search tab">
              {(id) => (
                <select
                  id={id}
                  name="tab"
                  defaultValue={editing?.tab ?? "latest"}
                >
                  {tabs.search.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              )}
            </Field>
            <div className="form-grid">
              <Field label="Record limit">
                {(id) => (
                  <input
                    id={id}
                    name="limit"
                    type="number"
                    min="1"
                    max="200"
                    defaultValue={editing?.limit ?? 40}
                    required
                  />
                )}
              </Field>
              <Field label="Scroll limit">
                {(id) => (
                  <input
                    id={id}
                    name="scrolls"
                    type="number"
                    min="0"
                    max="30"
                    defaultValue={editing?.maxScrolls ?? 8}
                    required
                  />
                )}
              </Field>
            </div>
            {editing && (
              <Notice>
                Saving changes resets this search’s comparison baseline.
                Existing collections remain available.
              </Notice>
            )}
            <div className="button-row">
              <Button type="submit">
                <Bookmark size={15} />
                Save search
              </Button>
              {editing && (
                <Button
                  variant="quiet"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancel editing
                </Button>
              )}
            </div>
          </Form>
        </section>
      </div>
      {comparison && <pre>{JSON.stringify(comparison, null, 2)}</pre>}
    </>
  );
}

function Collections() {
  const { data: d } = useApp();
  const [filter, setFilter] = useState(""),
    [comparison, setComparison] = useState<Record<string, unknown> | null>(
      null,
    );
  const items = d.snapshots.filter((s) =>
    (s.label + " " + s.sourceUrl + " " + s.kind)
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <>
      <Heading
        eyebrow="LOCAL ARCHIVE"
        title="A record you can return to."
        description="Inspect your latest 100 collections, compare samples and export the original records."
      />
      <section className="card">
        <Section
          title="Your collections"
          action={
            <label className="filter-input">
              <Search size={15} />
              <input
                aria-label="Filter collections"
                placeholder="Find a collection"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
          }
        />
        {items.length ? (
          <CollectionRows items={items} />
        ) : (
          <Empty title="No matching collections">
            Run a collection or adjust the filter to find your saved work.
          </Empty>
        )}
      </section>
      {d.snapshots.length > 1 && (
        <section className="card padded">
          <Section
            title="Compare two observations"
            description="Choose collections from the same source and tab. Not observed does not mean deleted."
          />
          <Form
            onSubmit={async (f) =>
              setComparison(
                await api<Record<string, unknown>>("/compare", {
                  before: String(f.get("before")),
                  after: String(f.get("after")),
                }),
              )
            }
          >
            <div className="form-grid">
              {["before", "after"].map((name, i) => (
                <Field
                  key={name}
                  label={i ? "Later collection" : "Earlier collection"}
                >
                  {(id) => (
                    <select
                      id={id}
                      name={name}
                      defaultValue={d.snapshots[i ? 0 : 1].id}
                    >
                      {d.snapshots.map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.label || shortSource(s.sourceUrl)} ·{" "}
                          {stamp(s.capturedAt)} · {s.id.slice(0, 6)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              ))}
            </div>
            <Button variant="secondary" type="submit">
              <ListFilter size={15} />
              Compare collections
            </Button>
          </Form>
          {comparison && (
            <div className="comparison">
              <div className="comparison-counts">
                {["added", "changed", "notObserved"].map((k) => (
                  <div key={k}>
                    <strong>{(comparison[k] as unknown[]).length}</strong>
                    <span>
                      {k === "notObserved" ? "Not observed" : human(k)}
                    </span>
                  </div>
                ))}
              </div>
              <Notice>{String(comparison.warning)}</Notice>
              <details className="details">
                <summary>Inspect record differences</summary>
                <pre>{JSON.stringify(comparison, null, 2)}</pre>
              </details>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function SnapshotPage({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("");
  useEffect(() => {
    let valid = true;
    setSnapshot(null);
    setError("");
    api<Snapshot>("/snapshot?id=" + encodeURIComponent(id)).then(
      (s) => {
        if (valid) setSnapshot(s);
      },
      (e) => {
        if (valid) setError(e.message);
      },
    );
    return () => {
      valid = false;
    };
  }, [id]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!snapshot)
    return (
      <p role="status" className="loading">
        <LoaderCircle className="spin" />
        Loading the collection…
      </p>
    );
  const s = snapshot;
  const items = s.data.items.filter((i) =>
    JSON.stringify(i).toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <a className="back-link" href="#collections">
        ← Back to collections
      </a>
      <Heading
        eyebrow={"COLLECTION · " + s.id.slice(0, 8)}
        title={s.label || "The original records."}
        description={stamp(s.data.capturedAt) + " · " + human(s.data.kind)}
        action={
          <div className="button-row">
            {["csv", "json", "md"].map((f) => (
              <Action
                key={f}
                variant="secondary"
                onClick={() => download(s.id, f)}
              >
                <ArrowDownToLine size={14} />
                {f.toUpperCase()}
              </Action>
            ))}
          </div>
        }
      />
      <section className="card padded">
        <div className="snapshot-summary">
          <div>
            <span className="eyebrow">ORIGINAL SOURCE</span>
            <External href={s.data.sourceUrl}>
              {shortSource(s.data.sourceUrl)}
            </External>
          </div>
          <div>
            <strong>{s.data.items.length}</strong>
            <span>records collected</span>
          </div>
          <div>
            <strong>{s.data.scrolls}</strong>
            <span>scrolls</span>
          </div>
          <Badge value={s.data.stopReason} />
        </div>
        <Notice>
          This is a bounded sample, not a complete archive. Collection stopped
          because: {human(s.data.stopReason)}.
        </Notice>
        {s.data.warnings.map((w, i) => (
          <Notice key={i}>{w}</Notice>
        ))}
      </section>
      <ReviewedExport key={s.id} id={s.id} request={request} />
      <section className="card">
        <Section
          title="Collected records"
          description="Text is preserved as observed; missing fields stay missing."
          action={
            <label className="filter-input">
              <Search size={15} />
              <input
                aria-label="Filter records"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search within this sample"
              />
            </label>
          }
        />
        {items.length ? (
          <div className="records">
            {items.map((item, i) => (
              <article className="record" key={String(item.id) + i}>
                <div className="record-header">
                  <span className="record-avatar">
                    {String(item.authorHandle ?? item.handle ?? "X")
                      .replace("@", "")
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <div>
                    <h3>
                      {String(
                        item.authorName ??
                          item.name ??
                          item.authorHandle ??
                          item.handle ??
                          "Observed record",
                      )}
                    </h3>
                    <span>
                      {String(item.authorHandle ?? item.handle ?? item.id)}
                      {item.timestamp ? " · " + stamp(item.timestamp) : ""}
                    </span>
                  </div>
                  <External href={item.url}>Original</External>
                </div>
                <p className="record-text">
                  {String(
                    item.text ??
                      item.description ??
                      item.bio ??
                      "No text field was captured for this record.",
                  )}
                </p>
                <details className="details">
                  <summary>All captured fields</summary>
                  <pre>{JSON.stringify(item, null, 2)}</pre>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No records to show">
            The sample may be empty, or no records match your filter.
          </Empty>
        )}
      </section>
    </>
  );
}

function Actions() {
  const { data: d, refresh, notify } = useApp();
  const [kind, setKind] = useState("post"),
    [confirm, setConfirm] = useState<Record<string, boolean>>({}),
    [receipts, setReceipts] = useState("");
  return (
    <>
      <Heading
        eyebrow="ACCOUNT WORKFLOWS"
        title="Consider it before you send it."
        description="Prepare an exact preview, review the account and target, then confirm the action."
        action={
          <Badge
            value={d.config.enableWrites ? "Actions enabled" : "Read-only mode"}
          />
        }
      />
      {!d.config.enableWrites && (
        <Notice>
          Previews are available. Execution is disabled until you enable
          reviewed account actions in Browser setup.
        </Notice>
      )}
      <div className="two-column">
        <section className="card padded">
          <Section
            title="Prepare an action"
            description="Creating a preview does not publish or submit it."
          />
          <Form
            onSubmit={async (f) => {
              await api("/actions/prepare", {
                action: kind,
                expectedAccount: String(f.get("account")),
                ...(kind !== "post" ? { target: String(f.get("target")) } : {}),
                ...(["post", "reply"].includes(kind)
                  ? { text: String(f.get("text")) }
                  : {}),
              });
              await refresh();
              notify("Preview ready for review");
            }}
          >
            <Field label="Expected account handle">
              {(id) => (
                <input
                  id={id}
                  name="account"
                  defaultValue={d.session.account ?? ""}
                  placeholder="@your_account"
                  required
                  maxLength={16}
                />
              )}
            </Field>
            <Field label="Action">
              {(id) => (
                <select
                  id={id}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  {[
                    "post",
                    "reply",
                    "like",
                    "unlike",
                    "bookmark",
                    "unbookmark",
                    "repost",
                    "unrepost",
                    "follow",
                    "unfollow",
                  ].map((k) => (
                    <option key={k} value={k}>
                      {k === "unrepost" ? "Undo repost" : human(k)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {kind !== "post" && (
              <Field
                label={
                  ["follow", "unfollow"].includes(kind)
                    ? "Target handle"
                    : "Target post URL"
                }
              >
                {(id) => (
                  <input
                    id={id}
                    name="target"
                    key={kind}
                    type={
                      ["follow", "unfollow"].includes(kind) ? "text" : "url"
                    }
                    maxLength={300}
                    required
                    placeholder={
                      ["follow", "unfollow"].includes(kind)
                        ? "@account"
                        : "https://x.com/account/status/123"
                    }
                  />
                )}
              </Field>
            )}
            {["post", "reply"].includes(kind) && (
              <Field label="Exact text">
                {(id) => (
                  <textarea
                    id={id}
                    name="text"
                    rows={5}
                    maxLength={25000}
                    required
                    placeholder="Write the exact text you want to preview."
                  />
                )}
              </Field>
            )}
            <Button type="submit">
              <SquarePen size={15} />
              Prepare preview
            </Button>
          </Form>
        </section>
        <section className="card">
          <Section
            title="Ready for your review"
            description="Previews expire after 10 minutes and allow one execution attempt."
          />
          {d.prepared.length ? (
            <div className="drafts">
              {d.prepared.map((p) => (
                <article key={p.id}>
                  <div className="draft-heading">
                    <h3>
                      {human(p.input.action)} · @{p.account}
                    </h3>
                    <Badge value="preview" />
                  </div>
                  <p className="hint">Expires {stamp(p.expiresAt)}</p>
                  {p.input.target && (
                    <p className="draft-target">Target: {p.input.target}</p>
                  )}
                  {p.input.text && <blockquote>{p.input.text}</blockquote>}
                  <details className="details">
                    <summary>Inspect target preview</summary>
                    <pre>{JSON.stringify(p.preview, null, 2)}</pre>
                  </details>
                  <Checkbox
                    checked={!!confirm[p.id]}
                    onChange={(e) =>
                      setConfirm({ ...confirm, [p.id]: e.target.checked })
                    }
                  >
                    I authorize this exact action for @{p.account} and the
                    target shown above.
                  </Checkbox>
                  <div className="button-row">
                    <Action
                      disabled={!d.config.enableWrites || !confirm[p.id]}
                      onClick={async () => {
                        try {
                          const r = await api<Record<string, unknown>>(
                            "/actions/execute",
                            { id: p.id, confirmed: true },
                          );
                          notify("Action result: " + human(r.status));
                        } catch (error) {
                          notify(
                            "Action did not finish successfully. Inspect its receipt before considering another attempt.",
                          );
                          throw error;
                        } finally {
                          await refresh();
                        }
                      }}
                    >
                      Confirm & execute
                      <ArrowRight size={14} />
                    </Action>
                    <Action
                      variant="quiet"
                      onClick={async () => {
                        await api("/actions/cancel", { id: p.id });
                        await refresh();
                        notify("Preview cancelled");
                      }}
                    >
                      Cancel preview
                    </Action>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title="No pending previews">
              Prepare an action to review its exact content and account here.
            </Empty>
          )}
        </section>
      </div>
      <section className="card">
        <Section
          title="Action receipts"
          description="Inspect the outcome before considering another attempt."
          action={
            <label className="filter-input">
              <Search size={15} />
              <input
                value={receipts}
                onChange={(e) => setReceipts(e.target.value)}
                aria-label="Filter action receipts"
                placeholder="Find a receipt"
              />
            </label>
          }
        />
        {d.receipts.length ? (
          <div className="receipt-list">
            {d.receipts
              .filter((r) =>
                JSON.stringify(r)
                  .toLowerCase()
                  .includes(receipts.toLowerCase()),
              )
              .map((r) => (
                <details key={String(r.id)}>
                  <summary>
                    <span>
                      {human(r.action)} · @{String(r.account)}
                    </span>
                    <span>{stamp(r.attemptedAt)}</span>
                    <Badge value={r.status} />
                  </summary>
                  <pre>{JSON.stringify(r, null, 2)}</pre>
                </details>
              ))}
          </div>
        ) : (
          <Empty title="No actions attempted">
            An execution attempt leaves a local receipt, including uncertain
            outcomes.
          </Empty>
        )}
      </section>
      <Notice>
        Failed or uncertain actions are never retried automatically. Inspect the
        receipt and X before preparing a replacement.
      </Notice>
    </>
  );
}

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "research", label: "Research desk", icon: Search },
  { id: "searches", label: "Saved searches", icon: Bookmark },
  { id: "collections", label: "Collections", icon: FolderOpen },
  { id: "actions", label: "Account actions", icon: SquarePen },
  { id: "setup", label: "Browser setup", icon: Settings2 },
];
function App() {
  const [data, setData] = useState<State | null>(null),
    [failure, setFailure] = useState(""),
    [route, setRoute] = useState(location.hash.slice(1) || "overview"),
    [toast, setToast] = useState(""),
    [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const refresh = async () => {
    try {
      const state = await api<State>("/state");
      setData(state);
      setFailure("");
    } catch (e) {
      setFailure(
        e instanceof Error ? e.message : "The local service is unavailable.",
      );
    }
  };
  useEffect(() => {
    void refresh();
    let running = false;
    const timer = setInterval(async () => {
      if (document.hidden || running) return;
      running = true;
      await refresh();
      running = false;
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1) || "overview");
      setOpen(false);
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!open) return;
    const element = document.getElementById("workspace-navigation");
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.querySelector<HTMLElement>("button")?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          element?.querySelectorAll<HTMLElement>("a,button") ?? [],
        );
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && index <= 0) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && index === nodes.length - 1) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = previous;
      removeEventListener("keydown", handle);
      toggle.current?.focus();
    };
  }, [open]);
  useEffect(() => {
    const wide = matchMedia("(min-width: 1024px)");
    const resize = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", resize);
    return () => wide.removeEventListener("change", resize);
  }, []);
  if (!data)
    return (
      <div className="boot">
        <IconLogo />
        <h1>X Browser</h1>
        {failure ? (
          <Notice tone="error">{failure}</Notice>
        ) : (
          <p role="status">Opening your local workspace…</p>
        )}
        <Button variant="secondary" onClick={() => location.reload()}>
          Reload workspace
        </Button>
      </div>
    );
  const active = route.startsWith("snapshot/") ? "collections" : route;
  const title = navigation.find((n) => n.id === active)?.label ?? "Workspace";
  const pages: Record<string, ReactNode> = {
    overview: <Overview />,
    setup: <Setup />,
    research: <Research />,
    searches: <Searches />,
    collections: <Collections />,
    actions: <Actions />,
  };
  return (
    <Ctx.Provider value={{ data, refresh, notify: setToast }}>
      <a
        href="#main-content"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      {open && (
        <div
          className="nav-scrim"
          onClick={() => {
            setOpen(false);
            toggle.current?.focus();
          }}
        />
      )}
      <aside
        id="workspace-navigation"
        className={"sidebar " + (open ? "open" : "")}
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label="Workspace navigation"
      >
        <a className="brand" href="#overview">
          <IconLogo />
          <div>
            X Browser<span>RESEARCH WORKSPACE</span>
          </div>
        </a>
        <button
          className="close-menu"
          aria-label="Close navigation"
          onClick={() => {
            setOpen(false);
            toggle.current?.focus();
          }}
        >
          <PanelLeftClose size={20} />
        </button>
        <div className="workspace-card">
          <span>𝕏</span>
          <div>
            {data.session.account
              ? "@" + data.session.account
              : "Personal workspace"}
            <p>Local browser connection</p>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {navigation.map((n) => (
            <a
              key={n.id}
              href={"#" + n.id}
              className={active === n.id ? "active" : ""}
              aria-current={active === n.id ? "page" : undefined}
            >
              <n.icon size={17} />
              {n.label}
              {n.id === "setup" && data.session.state === "closed" && (
                <span className="nav-dot" />
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <LockKeyhole size={17} />
          <div>
            Your workspace. Your session.
            <p>Private by design, local by default.</p>
          </div>
        </div>
        <div className="sidebar-version">
          <span>X Browser MCP</span>
          <span>v{data.version.replace(".0", "")}</span>
        </div>
      </aside>
      <div className="main-shell" inert={open}>
        <header className="topbar">
          <button
            ref={toggle}
            className="menu-button"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu size={19} />
          </button>
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={13} />
            <span>{title}</span>
          </div>
          <div className="topbar-right">
            <span className="local-dot" />
            Local session
            <span className="divider" />
            <span className="top-account">
              {data.session.account
                ? "@" + data.session.account
                : "Not connected"}
            </span>
            <button
              aria-label="Refresh workspace"
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {failure && (
            <Notice tone="error">
              <div className="reconnect-notice">
                <span>{failure}</span>
                <Button variant="secondary" onClick={() => location.reload()}>
                  Reload workspace
                </Button>
              </div>
            </Notice>
          )}
          <motion.div
            className="page-content"
            key={route}
            initial={reduced ? false : { opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {route.startsWith("snapshot/") ? (
              <SnapshotPage id={route.slice(9)} />
            ) : (
              (pages[route] ?? (
                <Notice tone="error">
                  This page was not found.{" "}
                  <a href="#overview">Return to overview.</a>
                </Notice>
              ))
            )}
          </motion.div>
          <footer>
            <span>Thoughtful research starts with the original source.</span>
            <span>
              <LockKeyhole size={12} />
              Stored on this computer
            </span>
          </footer>
        </main>
      </div>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="status"
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Check size={17} />
            {toast}
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
