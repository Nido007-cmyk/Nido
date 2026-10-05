> **Language:** English · [Español](es/NIDO_INFORMATION_ARCHITECTURE.md)

# NIDO Information Architecture

**Status:** design proposal, v0.1 — for review, not implementation.
**Principle:** NIDO is an agent you talk to. Navigation exists to *find things the agent did*, not to operate the agent.

---

## 1. App map

```
Onboarding (first run only)
└── Home (default)
    ├── Conversation (thread; opened from Home input or task)
    ├── Tasks
    │   └── Task detail (NIDO ↔ NIDO view when the task is inter-agent)
    ├── Contacts (NIDOs)
    │   └── Contact permissions (per contact: ✓ / • / ✕ tiers)
    ├── Privacy Activity ("Privacy Center")
    └── Settings
        └── Connection mode (Offline / Local-first / Online enhanced)
Approval request → modal sheet, reachable from anywhere (system-level)
```

**Bottom tabs (4):** Home · Contacts · Tasks · Privacy. (Settings via Home header gear. Conversation is not a tab — it's where you already are when talking.)

Rationale: the four things a user checks without asking are *people I trust*, *things in flight*, and *what left my device*. Everything else lives one tap from Home.

---

## 2. Screen definitions

### 2.1 Onboarding (3 steps, skippable after step 1)
1. **Meet Nidito** — hero mascot (≤160px, once), one-line promise: *"An assistant that lives in your pocket — not in the cloud."*
2. **Private by design** — three plain statements: *Processed on device · You approve what leaves · No account, no cloud.*
3. **Choose how connected** — mode picker: **Local-first** (recommended) / Offline / Online enhanced, in plain words. Choice is changeable in Settings; it never nags later.
Why: establish warmth + the privacy contract + the mode mental model before any data exists.

### 2.2 Home
Communicates *"this is MY NIDO"* in one glance:
- Greeting (Display M, time-aware) + date.
- Agent status line: Nidito 40px + status text (*Ready*, *Working on 2 tasks*, *Offline — fully usable*) + subtle mode pill.
- **Main input pill** (voice/text equals) — the primary action of the screen.
- *Relevant now* — max 3 task cards the agent surfaced (not a dashboard of buttons).
- *Recent* — max 3 plain-language rows (what happened, what was shared).
- Privacy footer chip: *Processed on device · Nothing left your phone today* (or today's disclosure count).
Why not a button grid: the product thesis is "tell it what you need". Grids of Calendar/Messages/Files buttons would reframe NIDO as an app launcher.

### 2.3 Conversation
Standard thread: user bubbles (olive-ghost, right), NIDO bubbles (paper, left, 28px mascot). Result cards (e.g. availability intervals) render as structured cards, not prose. Every disclosure carries a **privacy note card**: *"I didn't include event details to keep your information private."* Peer-originated content is quoted with attribution (*From María's NIDO — not verified*). Long tasks hand off to Tasks with a persistent card instead of infinite status scroll.

### 2.4 NIDO ↔ NIDO task (task detail variant)
Must answer in 3 seconds: *who is involved, what is happening, what left my device.*
- **Identity legend** (always visible at top): You · Your NIDO · María · María's NIDO — four distinct treatments (initials vs mascot solid vs mascot outline).
- **Bridge card**: dual-mascot bridge glyph, *"Your NIDO ↔ María's NIDO"*, one status line (*Negotiating availability…* → *Found a time — 6:00 PM*). Waiting states name who holds the next step.
- **Shared so far** list: plain-language disclosure log for this task (*Shared: Availability 6–7 PM · No calendar details shared*).
- **Never shown:** inter-agent messages, protocol states, chain-of-thought, raw envelopes.
- Terminal actions: *Propose to calendar* (ASK → approval sheet), *Done*.

### 2.5 Approval request (modal sheet, system-level)
Fires for every `ASK_USER` decision, from anywhere. Content, in order:
1. Who: *María's NIDO asks* (+ *From María's NIDO — not verified*).
2. What: capability in plain words (*Propose a calendar event* + micro `calendar.event.propose/v1`).
3. **What would leave your phone** (categories, never content dumps): *Proposed time 6:00 PM. No event titles. No calendar details.*
4. Three buttons: **Only this time** / **Always for María** / **Never**. (Maps to `ALLOW_ONCE` / `ALLOW_FOR_CONTACT` / `DENY`.)
5. Optional: *Why am I seeing this?* → one-line rule explanation (*Your rule: event proposals always ask*).
Anti-fatigue: the sheet groups identical pending requests; approving "Always" writes a version-pinned rule the user can inspect in Contact permissions.

### 2.6 Tasks
Four fixed sections, in this order: **Working** · **Waiting for another NIDO** · **Needs your approval** · **Completed**. Each row: title, counterpart (if any), state chip, progress or next-step line. Long tasks persist here with resumable state; tapping opens Conversation anchored at the task or the NIDO↔NIDO view. Revoked/denied tasks show an honest terminal row (*Stopped — you revoked access · 2 of 5 steps done*).

### 2.7 Contacts / NIDOs
People-first list: each row = person (name, initial avatar), beneath it their NIDO's connection state: *Direct connection* (bridge glyph, olive), *Reachable via relay*, *Pending pairing*, *Revoked*. Tapping → Contact permissions. A *Pair new NIDO* row (QR/pairing entry) sits at top. No capability inventories, no model/provider info — discovery advertises interfaces, not inventories.

### 2.8 Contact permissions
The Policy Engine made tangible. Header: person + NIDO + connection. Then the **three tiers**:
- **Can automatically** ✓ — e.g. *Ask if I'm available* (`availability.query/v1`)
- **Must ask me** • — e.g. *Create calendar events*, *Request files*
- **Never** ✕ — e.g. *Access location*, *Read calendar details*
Each row: plain words + micro `capability/version`. Tapping cycles tiers; widening requires explicit confirm (*"This lets María's NIDO do X without asking. Allow?"*). Footer note: *"Rules pin the exact capability and version. Updates never widen them silently."* + *Add rule* (guided, with safe defaults by sensitivity).

### 2.9 Privacy Activity ("Privacy Center")
One question answered: **what left my device, in seconds, in plain language.**
- Today strip: *Nothing left your phone today* OR a count + list.
- Timeline rows, each: nest glyph, plain sentence (*Shared availability 6–7 PM with María's NIDO*), sub-line (*No calendar details shared · 2 of 20 hourly checks used*), time.
- Sections: **Local processing** (*312 requests processed on device this week*), **Internet usage** (*No Internet used* / per-mode), **Connected NIDOs** (shortcuts), **Permissions** (shortcut), **What was shared** (the timeline), **Recent agent actions** (decisions: allowed/asked/denied with rule refs).
- Every row expandable to the audit chain (*Why?* → decision events, no chain-of-thought).

### 2.10 Settings / Offline–Online controls
- **Connection mode** (the only "technical" control, kept calm): three radio cards —
  - *Offline* — "No network at all. NIDO↔NIDO over Bluetooth only."
  - *Local-first* (recommended) — "Everything local; network only when you ask."
  - *Online enhanced* — "May use online services you approve, per task."
- Device & security: biometric lock, change/rotate identity (with human confirmation), paired devices.
- Data: export vault, delete vault (both with explicit confirmation).
- About: version, *How NIDO protects you* (docs link), licenses.
The current mode also surfaces as the subtle pill in Home/headers — Settings is where it changes, not where it shouts.

---

## 3. Navigation principles

1. **Talk first.** The fastest path to any action is the Home input, not a menu.
2. **Approvals interrupt; everything else waits.** The approval sheet is the only system-modal surface.
3. **No dead ends.** Every agent result links to its task; every task links to its disclosures; every disclosure links to its rule.
4. **Identity is always labeled.** Anywhere two NIDOs appear, the four-way legend (You / Your NIDO / person / their NIDO) is present or one tap away.
5. **Modes are states, not screens.** Offline/Local-first/Online-enhanced is a pill + Settings section, never a full-screen banner.
