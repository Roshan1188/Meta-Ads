# AutoAds AI

AI-powered Meta (Facebook + Instagram) ads platform. Paste a website URL, a daily
budget, and a goal — the platform researches the business, writes the copy, generates
the creatives, publishes the campaign, and then optimises it day to day.

```
Website URL → AI Analysis → AI Research → AI Copy → AI Creatives
→ Meta API → Ads Published → Tracking → AI Optimisation → Reports → Repeat
```

## Status

| Phase | Scope | State |
| --- | --- | --- |
| **0** | Scaffold: auth, database, dashboard shell | **Done** |
| **1** | AI ad generation (copy, images, audience, budget) | **Done** |
| **2** | Publish to Meta via the Marketing API | **Done** |
| **3** | Automated optimisation (rules engine, A/B, auto-creative) | **Done** |
| **4** | Agency platform (multi-tenant, billing, reports) | **Done** |

Routes for later phases exist in the navigation and say which phase they land in.
Nothing is stubbed to look like it works when it doesn't.

## Stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind v4 · shadcn/ui · Prisma 6 +
PostgreSQL · Auth.js v5 · Zod · TanStack Query · Inngest · Anthropic SDK

## Setup

### 1. Install

```bash
npm install
```

### 2. Database

You need a PostgreSQL 14+ database. Either:

**Local, via Docker**

```bash
docker compose up -d
```

This matches the default `DATABASE_URL` in `.env.example` exactly — no edits needed.

**Or hosted** — create a free branch on [Neon](https://neon.tech) or
[Supabase](https://supabase.com) and copy the connection string.

### 3. Environment

```bash
cp .env.example .env
```

Then set:

- `DATABASE_URL` — from step 2.
- `NEXTAUTH_SECRET` — generate one with `npx auth secret`.

Every other variable can stay empty for now; each is labelled with the phase that
needs it. Facebook login only appears on the login page once `META_APP_ID` and
`META_APP_SECRET` are set, so it can't 500 on a half-configured app.

### 4. Migrate and run

```bash
npm run db:migrate     # creates the tables
npm run dev
```

Open <http://localhost:3000>. Register an account, and you land on an empty dashboard.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | `prisma generate` + production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Create/apply a migration |
| `npm run db:push` | Push schema without a migration file |
| `npm run db:studio` | Prisma Studio (browse the data) |
| `npm run inngest:dev` | Local Inngest dev server (background jobs) |

## Layout

```
src/
├── app/
│   ├── (marketing)/    public landing page
│   ├── (auth)/         login, register
│   ├── (dashboard)/    protected — dashboard, generate, campaigns, reports, settings
│   └── api/            auth, register, inngest
├── components/
│   ├── ui/             shadcn primitives
│   └── features/       app-specific components
├── lib/
│   ├── ai/             Phase 1 — copy.ts, image.ts, video.ts, analyze.ts
│   ├── meta/           Phase 2 — client.ts, campaigns.ts, insights.ts
│   ├── billing/        Phase 4 — razorpay
│   ├── notify/         Phase 4 — email + whatsapp
│   ├── inngest/        background jobs
│   ├── auth.ts         Auth.js config
│   └── db.ts           Prisma client
└── types/
```

Every external AI/media provider sits behind an interface in `lib/ai/*` so providers
can be swapped without touching feature code.

## Generation (Phase 1)

`/generate` runs a five-step wizard: **Website → Analysis → Copy → Creatives → Review**.

| Stage | Route | Provider | Without its key |
| --- | --- | --- | --- |
| Website analysis | `POST /api/generate/analyze` | Claude (`claude-opus-4-8`) | Mock analysis, clearly labelled |
| Copy + campaign plan | `POST /api/generate/copy` | Claude | Mock copy and plan |
| Images | `POST /api/generate/creatives` | Replicate (Flux Schnell) | Mock SVG placeholders |
| Video (optional) | same | Shotstack | **Skipped**, not mocked |
| Save draft | `POST /api/generate/save` | — | — |

Output per run: 10 headlines (≤40 chars), 5 primary texts, 10 images, an audience, a
budget split, and a campaign structure — all editable, then saved as a `DRAFT`
`GenerationJob`. **Publish is deliberately disabled** until Phase 2.

Notes:

- Claude returns **structured outputs** constrained to the Zod schemas in
  `lib/ai/schemas.ts`, so a malformed response can't reach the database.
- Missing keys produce **mocks that say so** in the UI. A fake video URL would be
  worse than none, so video is skipped rather than mocked.
- Image and video calls cost money per request, so generations are capped per user
  per day — `GENERATION_DAILY_LIMIT` (default 10).

## Publishing to Meta (Phase 2)

`Settings → Meta` connects Facebook, then you pick an ad account, a Page, and
optionally a Pixel. Instagram is detected automatically from whichever account is
linked to the Page — no link just means Facebook-only placements.

From `Campaigns`, a DRAFT publishes as: **campaign → ad sets → image uploads →
creatives → ads**, streamed step by step so you see which one failed if one does.

### Guardrails

These exist because the failure mode here is *spending someone's money wrongly*:

- **Everything is created `PAUSED`.** Publishing cannot start spend. Activation is a
  separate action behind a dialog that names the exact daily figure, and the client
  must echo that figure back — a stale page is refused rather than run.
- **Lead campaigns require a Pixel.** Meta can only optimise for leads if something
  reports them. Rather than silently downgrading the campaign to link clicks (which
  would spend the budget chasing a different goal), publishing is refused with an
  explanation.
- **Placeholder images are refused.** A draft generated without `REPLICATE_API_TOKEN`
  contains mock images; publishing those would run a real ad with a grey box.
- **Budget floors are checked before Meta sees them**, so you get "this ad set would
  get ₹40/day, below Meta's minimum" rather than Meta's "Invalid parameter".
- **Unmatched interests are reported, not dropped silently.**
- Activation cascades to ad sets *and* ads — Meta gates delivery at every level, so a
  campaign flipped live with paused ad sets looks broken and never spends.

### Why not `facebook-nodejs-business-sdk`

The spec called for it, but it ships **no TypeScript definitions** and no `@types`
package exists, so every Meta call would be `any` — exactly where a mistyped field
costs real ad spend. The Marketing API is plain REST, so `lib/meta/client.ts` is a
typed `fetch` wrapper with retry on Meta's transient error codes and readable messages
for the common failures (expired token, missing permission, budget below minimum).

## Optimisation (Phase 3)

An Inngest cron runs at 03:00 UTC, fans out one job per client, syncs yesterday's
numbers from Meta into `Metric` / `AdMetric`, then runs the rules.

**The rules engine (`lib/optimize/rules.ts`) is a pure function** — stats in,
decisions out, no IO. It reads our snapshots, never Meta directly, so every decision
is reproducible from the numbers that caused it. `npm run check:rules` exercises it
against 12 scenarios (winners, losers, caps, floors, A/B margins).

Defaults: raise budget at **CTR ≥ 3%**, pause an ad below **CTR 1%** after **4,000
impressions**, budget moves capped at **±20% per day**, A/B winner must beat the loser
by **2×**.

### Safety

The failure mode here is an autonomous system spending money wrongly, so:

- **Auto-pilot is off by default, per client.** Off means the optimiser does nothing —
  it doesn't even suggest.
- **"Ask me first" is on by default.** Decisions land in the timeline as `PENDING` and
  wait for a click rather than hitting Meta.
- **A hard daily spend ceiling** per client. The optimiser will never raise a budget
  past it, whatever the rules say. The UI warns when auto-pilot runs uncapped.
- **It never pauses the last active ad in an ad set** — that stops delivery entirely,
  which is worse than running a weak ad.
- **It never judges on small samples** (under 4,000 impressions) and never cuts a
  budget below Meta's ad-set minimum.
- **Every action is logged with its reason and its previous value**, so it can be
  undone from the timeline.
- **Regenerated creatives refuse to publish as mocks.** Without real AI keys, an
  auto-replacement would put a placeholder image on a live, spending ad set.

## Agency platform (Phase 4)

**Everyone is an agency, including a solo user** — an "agency of one". One tenant
model, not two code paths that drift apart.

### Tenancy

Every query is scoped by `agencyId`, and every one of them goes through
`server/tenant.ts`. `requireMember()` resolves the caller's agency, role, and plan;
`requireClient()` proves a client id from the browser actually belongs to them. A raw
id is never authorisation.

The Facebook *token* stays on the user who connected it; where a client's ads go is a
per-client choice (`Client.metaAdAccountId`, `metaPageId`, `metaPixelId`, falling back
to the connector's defaults). A client also records *whose* token publishes it, because
the nightly optimiser runs with nobody logged in and would otherwise have no credential.

### Roles

| | Employee | Manager | Admin | Owner |
| --- | :-: | :-: | :-: | :-: |
| Generate drafts | ✅ | ✅ | ✅ | ✅ |
| Publish & activate (spends money) | — | ✅ | ✅ | ✅ |
| Auto-pilot | — | ✅ | ✅ | ✅ |
| Team | — | — | ✅ | ✅ |
| Branding | — | — | ✅ | ✅ |
| Billing | — | — | — | ✅ |

`npm run check:permissions` asserts this matrix (32 cases), including that an Employee
genuinely cannot publish and an Admin genuinely cannot reach billing.

### Billing

Razorpay subscriptions over REST, on their hosted checkout — we never touch card
details. **The signed webhook, not the checkout redirect, is what grants a plan**:
someone who abandons the payment page must not land on a paid tier, and someone who
pays must get it even if they never come back.

A lapsed subscription **drops to Free limits rather than locking the agency out of its
own data** — and that genuinely stops the optimiser touching Meta, rather than just
hiding the toggle.

### Reports & notifications

Weekly per-client reports (Monday 04:00 UTC), rendered once as self-contained HTML and
reused by the web view and the email, so what the client reads and what the agency sees
can't drift. Numbers come from our own snapshots, so a report is reproducible after the
fact and doesn't break when a token expires. Delivery by **Resend** and **WhatsApp Cloud
API**, each independent — one failing never suppresses the other, and the UI says which
channels actually went out rather than a blanket "Sent!".

Note: WhatsApp business-initiated messages **must** use a pre-approved template
(`WHATSAPP_REPORT_TEMPLATE`); a plain text body is silently rejected by Meta.

Daily anomaly watch emails owners and admins on a **spend spike** (>2× the weekly
average) or a **CPL jump** (>1.5×).

### Scheduled campaigns

`Campaign.startAt` / `endAt`, applied hourly. `endAt` is a hard stop, and a campaign
whose window has already closed is never started by a late run.

## Verification

There is no database or API key in this repo, so the parts that *can* be verified
without one are, and they're the parts where a silent bug costs money:

```bash
npm run check              # typecheck + both suites below
npm run check:rules        # 12 cases — optimiser decisions
npm run check:permissions  # 32 cases — role matrix and plan gates
```

## Conventions

- **Auth**: credentials (email + bcrypt) and Facebook OAuth. JWT sessions, because
  Credentials providers require them; the Prisma adapter still persists OAuth accounts.
  Routes are gated in `src/app/(dashboard)/layout.tsx` — a server component, so there
  is no unauthenticated flash.
- **Money** is stored as integer paise, never floats.
- **Branding**: `--brand` in `globals.css` is the single accent colour token (currently
  `#1E5631`); `APP_NAME` in `src/lib/constants.ts` is the single product-name string.
- **Validation**: every API input goes through Zod.

## Before real users can connect Meta (Phase 2)

Publishing needs the `ads_management` scope, which requires **Meta App Review** plus
**Business Verification**. Build and test against a Developer/Test user first — those
work without review. Budget several weeks for approval.

Also note: Meta enforces a minimum daily budget per ad set, so validate budgets before
publishing rather than letting the API reject them.
