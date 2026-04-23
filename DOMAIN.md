# DOMAIN.md — What Hawk Eye Actually Does

> **Functional reference for AI agents and humans.**
> Read this to understand WHAT every page, role, and number means in operational terms — not how the code is structured. For "do not break" rules see `AGENTS.md`. For settled per-feature rules see `.local/memory/`.

---

## 1. The big picture

Hawk Eye replaces a stack of paper forms and Excel sheets used by Royal Jordanian Air Force (RJAF) helicopter squadrons. One Squadron deploys it as a small network of Windows PCs (one per role) plus mobile phones for individual pilots. Every PC keeps its own local copy of the squadron's data, talks to a shared Supabase database for cross-PC features, and prints / exports the same paper forms the squadron has always used — now filled in automatically.

A live deployment looks like:
- **1 Operations PC** (the data-entry workhorse)
- **1+ Flight Commander PCs** (one per flight inside the squadron)
- **1 Squadron Commander PC**
- **1 Wing Commander PC** (sees several squadrons)
- **1 Base Commander PC** (sees several wings)
- **1 HQ PC** (sees all bases)
- **N Pilot phones** (mobile app, one per pilot)
- **1 Super Admin PC** (RJAF-wide, license keys, audit, the system itself)

---

## 2. Roles — who is who, and what they do

### 2.1 Operations PC ("Ops")
**The data-entry workhorse of the squadron.** Almost every number in Hawk Eye starts here.

**Daily job:** log every sortie that flew today, log leaves and unavailability, mark Duty Week assignments, build tomorrow's flight program, fill the risk assessment, file NOTAMs, post messages.

**Has access to:** Roster, Sortie Log, Flight Program, Schedule (drafting), Currency, Reminders, Duty Week, Risk Assessment, Coordinating Form, NOTAMs, Nav Routes, PDF Exports, Historical Import, Archives, Assigned Ops Pilots, Settings, Monthly Report. **Does NOT approve schedules** — they only submit them up the chain.

### 2.2 Flight Commander PC
**Subordinate to a specific Squadron Commander.** Each flight inside a squadron has one.

**Daily job:** monitor the pilots in their flight, draft mini-schedules and submit them to the Squadron Commander for approval, exchange messages.

**Has access to:** filtered roster (their flight's pilots), schedule drafting, messages with their Squadron Cmdr.

### 2.3 Squadron Commander PC
**Commands one squadron.** First approver in the schedule chain.

**Daily job:** review the day's flight schedule submitted from Ops or a Flight Cmdr, **approve / reject / hold / edit-and-return**, sign off the Monthly Report, watch the squadron's currency dashboard, message the Wing Cmdr.

**Has access to:** Commander Dashboard (their squadron's snapshot), Pilots, Alerts, Currency, Simulator history, Flight Records, Flight Program (read), Messages, **Final Schedules**, Schedule Chain.

### 2.4 Wing Commander PC
**Commands several squadrons.** Second approver in the schedule chain.

**Daily job:** see incoming approved schedules from each squadron under them, approve and forward to Base, or reject/edit-and-return. Filter the dashboard by squadron to drill into any single one.

**What they monitor:** total pilot strength across their squadrons, who is current/expired, schedules in flight, messages from any of their Squadron Cmdrs.

**Has access to:** same pages as Squadron Cmdr, but with a **squadron picker** at the top to switch between any squadron under them.

### 2.5 Base Commander PC
**Commands several wings.** Third approver in the schedule chain.

**Daily job:** receive schedules from Wings, approve and forward to HQ, or send back. Aggregate visibility over every squadron under their base.

**Has access to:** wing-rolled-up dashboard with the same squadron picker, plus the option to filter by wing.

### 2.6 HQ PC
**Final tier.** Sees everything across all bases. Approves schedules at the top of the chain. The "everything is OK across the air force" view.

### 2.7 Super Admin PC
**Above the operational chain. Manages Hawk Eye itself, not flying.**

**Daily job (rarely daily):** issue or revoke license keys, bind a license to a hardware ID + user, add or remove squadrons from the global directory, manage commander accounts, configure system-wide reminder cadences, override broken Flight→Squadron reporting chains, view the full audit log, manage TOTP for their own 2FA.

**Has access to:** Admin Overview, License Keys, Commanders, Squadrons, Audit Log, Security (2FA), Reminders Schedule. **Does NOT see flight data** unless they impersonate a squadron, and that action is audited.

### 2.8 Pilot Mobile App (individual pilot, on their phone)
**One install per pilot, paired to their record on the squadron.**

**What they see:** their own monthly hours (Day / Night / NVG, both seats), their own currency status with red/yellow/green warnings, their own simulator history, recent NOTAMs, their personal reminders (medical expiring, IRT expiring, NVG currency lapsing), the duty week roster, half-year (H1/H2) progress bars against annual targets.

**What they CANNOT do:** log new sorties, edit any record, see other pilots' personal totals. Read-only by design — squadron Ops PC owns the truth.

---

## 3. Pages — what every menu item is

| Page | Plain-English purpose |
|---|---|
| **Dashboard** | At-a-glance squadron health: today's sorties, who's on duty, alerts, expired currencies, schedule status. Different per role (commander view vs ops view). |
| **Pilot Roster (Pilot Unit Manager)** | The master list of every pilot in the squadron — name (EN/AR), military number, rank, call sign, qualifications, the six "last X flown" dates (Day, Night, NVG, IRT, Medical, Sim), Initial Hours baseline, phone-pair indicator, and currency state. Click a row → full detail page with hour breakdowns. |
| **Sortie Log** | Chronological list of every flight ever logged at this squadron. Add / edit / delete (delete is gated by a 12-month "frozen" window — older records require Super Admin authorization). Each row = one sortie. |
| **Flight Program** | The digital replacement for the paper "Daily Mission" sheet. Builds tomorrow's flying schedule: flight bands, briefing times, day-ops lead, night-ops lead, lecture, CAPTE, reporting time, A/C needed (main + standby for day and night), NVG slots, day slots. |
| **Schedule (chain view)** | Where Ops/Flight submits a schedule and watches it travel up Squadron → Wing → Base → HQ. Shows current holder, status, who edited it, what the diff is. |
| **Final Schedules** | Commander-only view of approved schedules ready to execute. |
| **Monthly Report** | The big monthly export. See section 5. |
| **Currency** | Matrix of every pilot vs every currency type (Day, Night, NVG, IRT, Medical, Sim). Color-coded green/yellow/red by days-until-expiry. |
| **Reminders** | Auto-generated nags: "Pilot X medical expires in 7 days", "Pilot Y NVG currency lost", etc. Configurable cadence per category. |
| **Duty Week** | Sun–Thu (RJAF work week) assignments: Main Duty pilot, Standby pilot, RCM. |
| **Risk Assessment** | Daily mission risk form — weather, crew rest, environment factors. Required before flying. |
| **Coordinating Form** | Inter-unit coordination paperwork (e.g., when two squadrons share an airspace or asset). |
| **NOTAMs** | Squadron-relevant Notices to Airmen — local and external. Pushed to pilot phones. |
| **Nav Routes** | Approved navigation routes for training flights. |
| **PDF Exports** | One-click PDF of any printable form (front sheet, monthly report, schedule, etc.). |
| **Audit Log** | Every action ever taken in Hawk Eye on this PC, with who/when/IP. Searchable. Auto-trims to 1 year. |
| **Historical Import** | Bulk upload pre-Hawk-Eye CSV/XLSX data. 1-click undo for the most recent import. |
| **Archives** | Local cold storage of sorties older than 3 years — kept available, removed from the active query path. |
| **Assigned Ops Pilots** | Which pilots are currently posted to Ops duty. |
| **Messages** | Tier-to-tier private threads (Flight↔Squadron, Squadron↔Wing, Wing↔Base, Base↔HQ, plus Ops↔Wing). Auto-archive at 3 months. |
| **Help & Getting Started** | In-app onboarding for new operators. |
| **Settings** | Per-PC config: language (EN/AR), squadron name/branding, printer setup, reminder cadence, link this PC to the squadron, register/revoke phones. |

**Super Admin only:** Admin Overview, License Keys, Commanders, Squadrons, Security (2FA), Reminders Schedule.

---

## 4. What a sortie is, exactly

A **sortie** is one logged flight. Fields:
- **Date** + **aircraft type** (UH-60M, Bell 407, AH-1F, MD500, etc.) + **tail number**
- **Crew:** Pilot (P1, usually Captain) + Co-Pilot (P2). Optionally a third (instructor).
- **Sortie type:** MSN (mission), TRG (training), SAR, MEDEVAC, IRT (Instrument Rating Test), Stand Eval, etc. The type drives auto-credit rules (see section 5).
- **Conditions:** Day / Night / NVG (Night Vision Goggles). NVG is tracked **separately** from Night.
- **Times:** Block Off → Takeoff → Landing → Block On (HH:MM 24h). Total time = Landing − Takeoff.
- **Other:** route, mission/duty notes, fuel, ATC use (takeoff + landing airfields), remarks, classification.

**Guest pilots** have no row in this squadron's roster. They're recorded as `pilotExternal: { name, military_number, home_squadron }` and a parallel record is sent to their home squadron's Ops PC for confirmation (see section 7).

---

## 5. How hours are calculated

**Per-seat credit:** both pilots get the full cockpit time. There is no "split". If a sortie is 3.5h, both seats book 3.5h.

**Captain bucket:** only the seat flagged as Captain (usually P1) gets Captain hours.

**Day / Night / NVG bucket:** decided by the sortie's Conditions tag.
- Tagged Day → goes to **Day** bucket.
- Tagged Night → goes to **Night** bucket.
- Tagged NVG → goes to **NVG** bucket. NVG and Night are independent buckets.

**Dual hours (instructor time) — auto-credit rule:** for these six sortie types, the co-pilot's seat is automatically marked Dual:
IRT, Stand Eval, Check Ride, Instructor Upgrade, Mission Qualification, Type Conversion. (Source of truth: `.local/memory/dual-hour-rules.md`.)
Day Dual / Night Dual / NVG Dual are separate buckets from plain Day/Night/NVG.

**Initial Hours:** the lifetime hour total a pilot brought into Hawk Eye when they were first added. Recorded once per pilot per bucket (Day, Night, NVG, total, plus per-aircraft breakdown if known). Combined with logged hours for the **Grand Total** displayed on PDFs and the mobile app. Does NOT influence currency expiry — only logged sorties move currency dates. (Source of truth: `.local/memory/initial-hours.md`.)

**Half-year split (H1 / H2):** Jan–Jun = H1, Jul–Dec = H2. Annual targets are split per half.

**Guest hours:** a guest pilot's hours flow to **their home squadron**, not the hosting one. The hosting squadron credits the local pilot they were paired with for the full cockpit time.

---

## 6. Currency tracking

Each pilot has six "last flown / last passed" dates:
1. Last Day flight
2. Last Night flight
3. Last NVG flight
4. Last IRT (Instrument Rating Test)
5. Last Medical
6. Last Simulator

Each currency has a **window** (e.g. Night = 30 days, Medical = 365). If `today − last > window`, the pilot is **Expired** for that currency and shows red. Yellow at 80% of the window. Green otherwise.

When a sortie is logged, the matching currency dates auto-refresh. (Source of truth: `.local/memory/currency-refresh.md`.)

---

## 7. Schedule chain — how a flight schedule travels up

### 7.1 Operator-stated authoritative chain (v1.1.94, captured verbatim)

The operator described the schedule chain as follows. This is the **contract** the system must satisfy; any divergence in code is a bug.

```
Ops Officer ──draft & send──► Flight Cmdr ──edit-bounce──► Ops
                                  │                         (Ops re-edits, returns)
                                  │ approve
                                  ▼
                              Sqn Cmdr ──edit-bounce──► Flight Cmdr
                                  │
                                  │ approve
                                  ▼
                              Wing Cmdr ──edit-bounce / forward
                                  │
                                  │ approve
                                  ▼
                              Base Cmdr ──FINAL APPROVE──► archived for that
                                                            specific day +
                                                            specific squadron
```

Either **Ops** or **Flight Cmdr** can be the originator. Edit-bounces always return one tier downward. Final storage happens on **Base Cmdr's approve**, not Wing's.

### 7.2 What the code does today (v1.1.94 baseline — known divergences)

The current `useDecideSchedule` enforces a **4-tier** chain `flight | squadron | wing | base` where:
- `flight → squadron` and `squadron → wing` are the only forward hops.
- **Wing tier is terminal** — Wing's Approve releases the sheet to Base/HQ as **read-only viewers** via `canViewFinalSchedules`. Base does not have a separate Approve action.
- **There is no separate "ops" tier**: Ops officers operate the squadron-tier PC. Edit-bounces from Sqn Cmdr land on the squadron PC where the Ops officer sits.

**Reconciled in v1.1.96 — operator confirmed:**
1. **Ops is NOT a separate tier** — one Officer PC per squadron, the Ops officer sits there.
2. **Wing → Base forward + Base Approve = final archive — WIRED** (cross-pc.ts:1659; UI was already present at ScheduleChain.tsx:651-700, only the throw was blocking it).
3. **Wing.approve without Base forward also stays valid** — operator: "if the wing commander didn't want to send it to the base commander, it's OK; it will be saved on that day for that specific squadron."
4. **Wing edit-bounce → Sqn Cmdr** — verified live; root cause of the persistent 42501 was the `audit_log` policy (not the schedule policy), fixed in migration 0036.

**Live-verified end-to-end (5/5) on v1.1.96:** ops submit → sqn→wing → wing→base → base.approve → ops sees final approval.

### 7.3 Common rules at every tier

- **Any participating PC** can view the full history (every action, who did it, when).
- **Reject** sends the sheet back to the originator with a reason.
- **Hold** pauses with a note.
- **Edit** attaches edited rows + bounces one tier down for re-approval (the receiver must accept the diff).
- **Delete** can be issued by any PC that has touched the share (v1.1.60 widening) — wipes from every screen with one click.

---

## 8. Cross-PC / messaging

**Active vs offline:** a PC is "active" if its `xpc_registry.last_seen` is within 90 seconds. Offline PCs are still pingable — messages and shares queue and deliver when they next come online. (Source of truth: `.local/memory/active-pc-visibility.md`.)

**Messages:** plain text threads, sender + recipient. Allowed pairs: any two roles in the chain (Flight↔Squadron, Squadron↔Wing, Wing↔Base, Base↔HQ, Ops↔Wing). Mark-as-read, move-to-history, delete. Auto-purge at 3 months.

**Guest-pilot handoff:**
1. Hosting Ops logs a sortie with a guest pilot (military number + home squadron).
2. A row is inserted into `xpc_pending` for the home squadron.
3. Home Ops PC sees it in their Pending list with the guest's name + military number + which seat they sat in.
4. Home Ops **Accepts** (hours flow into the guest's home totals via the same calc engine), **Rejects** (with reason), **Edits** (corrects hours then accepts), or asks for a **military-number backfill** if the hosting squadron didn't have it.

---

## 9. Monthly Report — what's in it

Generated for any calendar month, with optional manual overrides for the non-flying numbers (lectures, ammo, morale).

| Sheet | What it shows |
|---|---|
| **Form 1** | Per-pilot monthly breakdown: Day / Night / NVG hours per seat, Captain hours, Dual hours, sortie counts, total cockpit time. One row per pilot. |
| **Form 2** | Per-pilot currency state at month-end + cumulative lifetime totals (logged + initial hours). |
| **Form 3** | Squadron-wide mission totals: GH (general hours), IF (instrument flying), NF (night flying), per-aircraft type. Planned vs achieved. |
| **Form 4** | Next month's training plan: hours target per pilot, fuel-burn projection, ammunition requirements per weapon system. |
| **Front Sheet** | Day/NVG schedule recap, with the duplex-print rule that ensures Day fills the front and NVG starts on the back (`page-break-after: right`). (Source of truth: `.local/memory/print-system.md`.) |

All sheets export to PDF (printable) and XLSX (editable). The XLSX export is round-trippable — the same file can be re-imported via Historical Import. Aggregation uses the live Sortie Log as the source of truth; no double-bookkeeping.

---

## 10. Where to look for more detail

- **`.local/memory/`** — settled rules per area (dual-hour, initial-hours, multi-squadron, currency-refresh, print-system, release-process, supabase-admin, active-pc-visibility, add-pilot-form, phone-pair-indicator, reminders-wording, user-management). **These override everything else when there's a conflict — they are operator-settled truth.**
- **`.local/HAWK-EYE-OVERNIGHT-MASTER-REPORT.md`** — what was built in each version v1.1.75 → present.
- **`AGENTS.md`** — the must-read briefing on do-nots, test commands, migration recipe.
- **`replit.md`** — full project overview, brand assets, workflow inventory.
- **Code source-of-truth files:**
  - `artifacts/pilot-dashboard/src/lib/cross-pc.ts` — every cross-PC interaction (schedule chain, messages, guest pilots, registry, claims).
  - `artifacts/pilot-dashboard/src/lib/squadron-data.ts` — local squadron state (roster, sorties, currency).
  - `artifacts/pilot-dashboard/src/lib/monthly-report.ts` — Form 1–4 builders.
  - `artifacts/pilot-dashboard/src/pages/` — every page in the menu.

---

**When this document is wrong, fix it.** The instant a domain rule changes, update the matching `.local/memory/<area>.md` file AND this guide. Future agents (and future you) depend on it.
