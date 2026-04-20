// Build a professional, colorful, non-technical presentation PDF that
// explains the Hawk Eye ecosystem for senior leadership.  Uses pdfkit so
// it runs entirely in-Node with no headless browser needed.
//
// Layout: landscape A4 (842 x 595 pt), 16:9-ish, so hero images fill the
// page cinematically.  Brand palette: RJAF navy + gold.
//
// Run: node exports/hawkeye-pdf/build.mjs
// Out: exports/hawkeye-pdf/HawkEye-Ecosystem.pdf

import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const OUT = "exports/hawkeye-pdf/HawkEye-Ecosystem.pdf";
const IMG = "exports/hawkeye-pdf/images";
const SCR = "exports/hawkeye-pdf/screens";
const EMBLEM = "artifacts/pilot-dashboard/public/brand/emblem.png";
const WORDMARK = "artifacts/pilot-dashboard/public/brand/hawkeye-logo.png";

// Brand palette
const NAVY_DEEP   = "#05081a";
const NAVY        = "#0b1130";
const NAVY_SOFT   = "#141a3a";
const GOLD        = "#d4af37";
const GOLD_BRIGHT = "#f0c955";
const GOLD_DIM    = "#8a7221";
const INK_HI      = "#f5f2e7";
const INK         = "#cfd3e0";
const INK_DIM     = "#8b90a8";

const PAGE_W = 842;  // landscape A4
const PAGE_H = 595;

// --------------------------------------------------------------------------
// Drawing helpers
// --------------------------------------------------------------------------

function bg(doc, color = NAVY_DEEP) {
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(color);
}

function vignette(doc) {
  // Manual radial-ish gradient by stacking translucent ellipses. pdfkit's
  // gradients work, but this is cheaper and looks rich on top of a dark
  // base.
  for (let i = 0; i < 6; i++) {
    const alpha = 0.06 - i * 0.009;
    doc.fillOpacity(alpha).fill(GOLD);
    doc.circle(PAGE_W / 2, PAGE_H / 2, 300 + i * 40);
    doc.fill();
  }
  doc.fillOpacity(1);
}

function topBar(doc, title, page) {
  // Thin gold divider under a small emblem + wordmark.
  doc.save();
  doc.image(EMBLEM, 40, 28, { width: 24 });
  doc.fillColor(INK_HI).fontSize(11).font("Helvetica-Bold")
     .text("HAWK EYE", 72, 32, { lineBreak: false });
  doc.fillColor(INK_DIM).fontSize(8).font("Helvetica")
     .text("RJAF SQUADRON OPS", 72, 47, { lineBreak: false });
  if (title) {
    doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold")
       .text(title.toUpperCase(), 200, 37, { characterSpacing: 2, lineBreak: false });
  }
  doc.fillColor(INK_DIM).fontSize(8).font("Helvetica")
     .text(`PAGE ${page}`, PAGE_W - 90, 40, { width: 50, align: "right" });
  doc.moveTo(40, 66).lineTo(PAGE_W - 40, 66).lineWidth(0.6).strokeColor(GOLD_DIM).stroke();
  doc.restore();
}

function bottomBar(doc) {
  doc.save();
  doc.moveTo(40, PAGE_H - 36).lineTo(PAGE_W - 40, PAGE_H - 36).lineWidth(0.4).strokeColor(GOLD_DIM).stroke();
  doc.fillColor(INK_DIM).fontSize(8).font("Helvetica")
     .text("ROYAL JORDANIAN AIR FORCE  ·  SQUADRON OPERATIONS", 40, PAGE_H - 26, { lineBreak: false });
  doc.fillColor(INK_DIM).fontSize(8)
     .text("CONFIDENTIAL — FOR COMMAND REVIEW", PAGE_W - 260, PAGE_H - 26, { width: 220, align: "right" });
  doc.restore();
}

function sectionTitle(doc, x, y, eyebrow, title) {
  doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold")
     .text(eyebrow.toUpperCase(), x, y, { characterSpacing: 3, lineBreak: false });
  doc.fillColor(INK_HI).fontSize(26).font("Helvetica-Bold")
     .text(title, x, y + 16, { lineBreak: false });
  doc.moveTo(x, y + 54).lineTo(x + 54, y + 54).lineWidth(2).strokeColor(GOLD).stroke();
}

function body(doc, x, y, w, text, opts = {}) {
  doc.fillColor(opts.color || INK).fontSize(opts.size || 11).font(opts.font || "Helvetica");
  doc.text(text, x, y, { width: w, align: opts.align || "left", lineGap: opts.lineGap ?? 3 });
}

function bulletList(doc, x, y, w, items, opts = {}) {
  const size = opts.size || 11;
  doc.fontSize(size).font("Helvetica");
  let cy = y;
  for (const it of items) {
    // Gold diamond bullet
    doc.save();
    doc.translate(x, cy + size * 0.45);
    doc.rotate(45);
    doc.rect(-3, -3, 6, 6).fill(GOLD);
    doc.restore();
    const [head, ...rest] = Array.isArray(it) ? it : [it];
    doc.fillColor(INK_HI).font("Helvetica-Bold").fontSize(size)
       .text(head, x + 14, cy, { width: w - 14, lineGap: 2, continued: rest.length > 0 });
    if (rest.length > 0) {
      doc.fillColor(INK).font("Helvetica").text(" " + rest.join(" "), { lineGap: 2 });
    }
    cy = doc.y + 6;
  }
  return cy;
}

function badge(doc, x, y, label, color = GOLD) {
  const w = doc.widthOfString(label, { size: 8 }) + 18;
  doc.roundedRect(x, y, w, 16, 8).lineWidth(0.8).strokeColor(color).stroke();
  doc.fillColor(color).fontSize(8).font("Helvetica-Bold")
     .text(label, x + 9, y + 4, { characterSpacing: 1.5, lineBreak: false });
  return w;
}

function card(doc, x, y, w, h, title, text, iconFn) {
  // Soft card with gold hairline border.
  doc.save();
  doc.roundedRect(x, y, w, h, 8).fill(NAVY_SOFT);
  doc.roundedRect(x, y, w, h, 8).lineWidth(0.7).strokeColor(GOLD_DIM).stroke();
  if (iconFn) iconFn(doc, x + 16, y + 16);
  doc.fillColor(GOLD_BRIGHT).fontSize(13).font("Helvetica-Bold")
     .text(title, x + 16, y + 56, { width: w - 32 });
  doc.fillColor(INK).fontSize(10).font("Helvetica")
     .text(text, x + 16, doc.y + 4, { width: w - 32, lineGap: 2 });
  doc.restore();
}

// Simple glyph icons drawn as primitives so we don't need an icon font.
function iconPC(doc, x, y) {
  doc.roundedRect(x, y, 28, 20, 2).lineWidth(1).strokeColor(GOLD).stroke();
  doc.rect(x + 10, y + 22, 8, 4).fill(GOLD);
  doc.rect(x + 4, y + 27, 20, 1.5).fill(GOLD);
}
function iconPhone(doc, x, y) {
  doc.roundedRect(x + 6, y, 18, 30, 3).lineWidth(1).strokeColor(GOLD).stroke();
  doc.circle(x + 15, y + 27, 1.2).fill(GOLD);
  doc.rect(x + 11, y + 3, 8, 1).fill(GOLD);
}
function iconCloud(doc, x, y) {
  doc.save().translate(x, y);
  doc.circle(8, 18, 7).circle(18, 14, 9).circle(26, 20, 7).fillAndStroke(NAVY_SOFT, GOLD);
  doc.rect(4, 18, 26, 10).fillAndStroke(NAVY_SOFT, GOLD);
  doc.restore();
}
function iconShield(doc, x, y) {
  doc.save().translate(x, y);
  doc.moveTo(14, 0).lineTo(28, 6).lineTo(28, 18).lineTo(14, 30).lineTo(0, 18).lineTo(0, 6).closePath()
     .lineWidth(1).strokeColor(GOLD).stroke();
  doc.moveTo(8, 14).lineTo(13, 20).lineTo(22, 10).lineWidth(1.5).strokeColor(GOLD).stroke();
  doc.restore();
}
function iconBell(doc, x, y) {
  doc.save().translate(x, y);
  doc.moveTo(4, 22).lineTo(26, 22).lineWidth(1).strokeColor(GOLD).stroke();
  doc.moveTo(6, 22).quadraticCurveTo(6, 6, 15, 6).quadraticCurveTo(24, 6, 24, 22).strokeColor(GOLD).stroke();
  doc.circle(15, 27, 2).fill(GOLD);
  doc.restore();
}
function iconChain(doc, x, y) {
  doc.save().translate(x, y);
  doc.roundedRect(0, 8, 14, 12, 4).lineWidth(1.2).strokeColor(GOLD).stroke();
  doc.roundedRect(14, 8, 14, 12, 4).lineWidth(1.2).strokeColor(GOLD).stroke();
  doc.restore();
}

// --------------------------------------------------------------------------
// Pages
// --------------------------------------------------------------------------

function pageCover(doc) {
  bg(doc, NAVY_DEEP);
  // Hero image full-bleed with a dark overlay for legibility.
  if (fs.existsSync(`${IMG}/cover_hero.png`)) {
    doc.image(`${IMG}/cover_hero.png`, 0, 0, { width: PAGE_W, height: PAGE_H });
  }
  // Dark gradient overlay (manual — fill rects with decreasing alpha)
  for (let i = 0; i < 20; i++) {
    doc.fillOpacity(0.05).fill(NAVY_DEEP);
    doc.rect(0, i * (PAGE_H / 20), PAGE_W, PAGE_H / 20 + 1);
  }
  doc.fillOpacity(0.55).rect(0, 0, PAGE_W, PAGE_H).fill(NAVY_DEEP);
  doc.fillOpacity(1);

  // Top-left emblem
  doc.image(EMBLEM, 48, 48, { width: 54 });

  // Top-right chip
  doc.roundedRect(PAGE_W - 200, 52, 152, 22, 11).lineWidth(0.6).strokeColor(GOLD).stroke();
  doc.fillColor(GOLD).fontSize(8).font("Helvetica-Bold")
     .text("COMMAND BRIEFING · 2026", PAGE_W - 190, 58, { characterSpacing: 2.5, lineBreak: false });

  // Giant title block centred lower third
  doc.fillColor(GOLD).fontSize(11).font("Helvetica-Bold")
     .text("ROYAL JORDANIAN AIR FORCE", 48, 320, { characterSpacing: 5, lineBreak: false });
  doc.fillColor(INK_HI).fontSize(64).font("Helvetica-Bold")
     .text("HAWK EYE", 48, 340, { lineBreak: false });
  doc.fillColor(INK).fontSize(20).font("Helvetica")
     .text("The Digital Squadron Operations Ecosystem", 48, 420, { lineBreak: false });
  doc.fillColor(INK_DIM).fontSize(12).font("Helvetica-Oblique")
     .text("One logbook. Every pilot. Every squadron. Every decision — in sync.",
           48, 452, { lineBreak: false });

  // Footer signature
  doc.moveTo(48, PAGE_H - 48).lineTo(160, PAGE_H - 48).lineWidth(1.5).strokeColor(GOLD).stroke();
  doc.fillColor(INK_DIM).fontSize(9).font("Helvetica")
     .text("Prepared for Command Review", 48, PAGE_H - 40, { lineBreak: false });
  doc.fillColor(INK_DIM).fontSize(9)
     .text("Version 1.0.48  ·  April 2026", PAGE_W - 240, PAGE_H - 40,
           { width: 200, align: "right" });
}

function pageWhatIs(doc) {
  bg(doc, NAVY);
  topBar(doc, "Overview", 2);
  sectionTitle(doc, 48, 100, "What is Hawk Eye?",
               "A single nerve centre for the squadron.");

  body(doc, 48, 180, 360,
    "Hawk Eye replaces paper logbooks, spreadsheets, WhatsApp group chats " +
    "and scattered clipboards with one living system that every pilot and " +
    "every commander can trust.\n\n" +
    "From the moment a pilot lands to the moment the wing commander signs " +
    "off the monthly report, the same data flows across the entire chain " +
    "— no copy-paste, no lost pages, no guesswork about who has the latest " +
    "numbers.",
    { lineGap: 4, size: 11.5 }
  );

  // Right-side image
  if (fs.existsSync(`${IMG}/logbook_modern.png`)) {
    doc.save();
    doc.roundedRect(440, 100, 354, 380, 10).clip();
    doc.image(`${IMG}/logbook_modern.png`, 440, 100, { width: 354, height: 380 });
    doc.restore();
    doc.roundedRect(440, 100, 354, 380, 10).lineWidth(0.8).strokeColor(GOLD_DIM).stroke();
  }

  // Stat row
  const stats = [
    ["One",      "logbook across the whole squadron"],
    ["Zero",     "paper forms to lose or forge"],
    ["Real-time","sync between PC and mobile"],
    ["24 / 7",   "availability from anywhere secure"],
  ];
  const sx = 48, sy = 500, sw = 185;
  stats.forEach((s, i) => {
    doc.fillColor(GOLD_BRIGHT).fontSize(22).font("Helvetica-Bold")
       .text(s[0], sx + i * sw, sy, { lineBreak: false });
    doc.fillColor(INK_DIM).fontSize(9).font("Helvetica")
       .text(s[1], sx + i * sw, sy + 28, { width: sw - 10 });
  });
  bottomBar(doc);
}

function pageEcosystem(doc) {
  bg(doc, NAVY);
  topBar(doc, "Ecosystem", 3);
  sectionTitle(doc, 48, 100, "Three doors, one room",
               "How the pieces fit together.");

  if (fs.existsSync(`${IMG}/ecosystem_diagram.png`)) {
    doc.save();
    doc.roundedRect(340, 150, 454, 300, 10).clip();
    doc.image(`${IMG}/ecosystem_diagram.png`, 340, 150, { width: 454, height: 300 });
    doc.restore();
    doc.roundedRect(340, 150, 454, 300, 10).lineWidth(0.8).strokeColor(GOLD_DIM).stroke();
  }

  const boxes = [
    {
      t: "Commander's PC",
      d: "Windows desktop installer used at every squadron, wing and base command post. Full command view, schedule authoring, message inbox, reports.",
      i: iconPC,
    },
    {
      t: "Pilot's Phone",
      d: "Android & iOS app for every pilot. Log sorties from the flight line, read alerts from command, track currency, get reminders before certifications expire.",
      i: iconPhone,
    },
    {
      t: "Secure Cloud",
      d: "A dedicated private database holds the shared state. Every PC and every phone talks only to this cloud — never directly to each other.",
      i: iconCloud,
    },
  ];
  let cy = 160;
  for (const b of boxes) {
    card(doc, 48, cy, 280, 90, b.t, b.d, b.i);
    cy += 104;
  }

  // Bottom callout
  doc.roundedRect(48, 480, 746, 48, 8).fill(NAVY_SOFT);
  doc.roundedRect(48, 480, 746, 48, 8).lineWidth(0.7).strokeColor(GOLD_DIM).stroke();
  doc.fillColor(GOLD).fontSize(10).font("Helvetica-Bold")
     .text("THE KEY IDEA", 64, 492, { characterSpacing: 3, lineBreak: false });
  doc.fillColor(INK_HI).fontSize(11).font("Helvetica")
     .text("A number entered on any pilot's phone appears on every authorised commander's screen within seconds — and vice versa.",
           150, 493, { width: 630 });
  bottomBar(doc);
}

function pageDashboard(doc) {
  bg(doc, NAVY);
  topBar(doc, "PC Dashboard", 4);
  sectionTitle(doc, 48, 100, "For commanders",
               "The Hawk Eye dashboard.");

  // Feature list left
  const feats = [
    ["Sortie log & live entry —",  "add, approve and audit every flight."],
    ["Flight schedule authoring —","draft, review and release the next day's plan."],
    ["Currency & expiry tracking —","NVG, instrument, tactical, medical — no surprises."],
    ["Roster & ranking view —",     "a league table that keeps the squadron sharp."],
    ["Leaves & unavailability —",   "see who can fly before you assign anyone."],
    ["NOTAMs, navigation routes, risk assessments —", "all in one tabbed workspace."],
    ["Monthly reports —",            "RCN Forms 1 – 4 auto-generated, bilingual (EN / AR)."],
    ["PDF exports —",                "every view, one click, ready for the wing commander."],
  ];
  bulletList(doc, 48, 180, 360, feats, { size: 10.5 });

  // Right: splash screenshot in a frame
  const shot = fs.existsSync(`${SCR}/splash2.jpg`) ? `${SCR}/splash2.jpg` : `${SCR}/dashboard-home.jpg`;
  if (fs.existsSync(shot)) {
    doc.roundedRect(430, 180, 364, 280, 8).fill("#000");
    doc.save();
    doc.roundedRect(434, 184, 356, 272, 6).clip();
    doc.image(shot, 434, 184, { width: 356, height: 272 });
    doc.restore();
    doc.roundedRect(430, 180, 364, 280, 8).lineWidth(0.8).strokeColor(GOLD_DIM).stroke();
    doc.fillColor(INK_DIM).fontSize(8).font("Helvetica-Oblique")
       .text("Hawk Eye dashboard · sign-in screen", 430, 466, { width: 364, align: "center" });
  }

  // Language strip
  doc.roundedRect(430, 490, 364, 40, 6).fill(NAVY_SOFT)
     .roundedRect(430, 490, 364, 40, 6).lineWidth(0.6).strokeColor(GOLD_DIM).stroke();
  doc.fillColor(GOLD).fontSize(9).font("Helvetica-Bold")
     .text("BILINGUAL", 446, 502, { characterSpacing: 2, lineBreak: false });
  doc.fillColor(INK_HI).fontSize(10.5).font("Helvetica")
     .text("Full English & Arabic interface, right-to-left aware.", 510, 503, { width: 270 });
  bottomBar(doc);
}

function pageMobile(doc) {
  bg(doc, NAVY);
  topBar(doc, "Pilot App", 5);
  sectionTitle(doc, 48, 100, "For pilots",
               "The logbook in every pilot's pocket.");

  if (fs.existsSync(`${IMG}/squadron_lineup.png`)) {
    doc.save();
    doc.roundedRect(430, 100, 364, 380, 10).clip();
    doc.image(`${IMG}/squadron_lineup.png`, 430, 100, { width: 364, height: 380 });
    doc.restore();
    doc.roundedRect(430, 100, 364, 380, 10).lineWidth(0.8).strokeColor(GOLD_DIM).stroke();
  }

  const feats = [
    ["Log a sortie in under a minute —", "taxi-out, taxi-in, mission type, remarks."],
    ["My hours, my currencies —",        "always up-to-date, at a glance."],
    ["Incoming alerts from command —",   "priority-tagged, impossible to miss."],
    ["Smart reminders —",                "before NVG, instrument or medical expire."],
    ["Leave requests —",                 "submit from the field, commander approves on PC."],
    ["Push notifications —",             "audible heads-up the moment a new order goes out."],
    ["Works in English & Arabic —",      "full right-to-left layout."],
    ["Android & iOS —",                  "the same login, the same data, either device."],
  ];
  bulletList(doc, 48, 180, 360, feats, { size: 10.5 });

  bottomBar(doc);
}

function pageStayInSync(doc) {
  bg(doc, NAVY);
  topBar(doc, "In Sync", 6);
  sectionTitle(doc, 48, 100, "Everything stays in sync",
               "How information moves between commands.");

  body(doc, 48, 180, 740,
    "Flights are rarely private to one squadron. Guest pilots visit, wing " +
    "commanders approve, the base tracks the cycle. Hawk Eye carries the " +
    "paperwork for you:",
    { size: 11.5, lineGap: 3 }
  );

  const col1 = [
    ["Shared flight schedules —",
     "a squadron's draft rolls up to wing, the wing edits cascade to base, and the changes flow back down — every tier always sees who has the current version."],
    ["Cross-squadron guest pilots —",
     "if a pilot from another squadron flies with you, the sortie automatically appears as a Pending Approval on their home squadron's PC — no phone calls, no emails, no lost hours."],
  ];
  const col2 = [
    ["PC-to-PC messaging —",
     "private, priority-flagged, with a full audit trail. Replaces WhatsApp groups that leak information outside the chain of command."],
    ["Role-aware sidebar —",
     "ops officers, deputies, flight commanders and wing staff each see exactly the tools they need — and nothing they shouldn't touch."],
  ];
  bulletList(doc, 48, 230, 360, col1, { size: 10.5 });
  bulletList(doc, 430, 230, 360, col2, { size: 10.5 });

  bottomBar(doc);
}

function pageAlerts(doc) {
  bg(doc, NAVY);
  topBar(doc, "Alerts", 7);
  sectionTitle(doc, 48, 100, "When it matters, you hear it",
               "Per-PC alerts with sound & pop-up.");

  if (fs.existsSync(`${IMG}/network_nodes.png`)) {
    doc.save();
    doc.roundedRect(430, 150, 364, 240, 10).clip();
    doc.image(`${IMG}/network_nodes.png`, 430, 150, { width: 364, height: 240 });
    doc.restore();
    doc.roundedRect(430, 150, 364, 240, 10).lineWidth(0.8).strokeColor(GOLD_DIM).stroke();
  }

  body(doc, 48, 180, 360,
    "A commander shouldn't have to stare at the screen to catch an incoming " +
    "order. When a message, a schedule, or a cross-squadron approval lands " +
    "on a specific PC, Hawk Eye:",
    { size: 11, lineGap: 3 }
  );

  bulletList(doc, 48, 260, 360, [
    ["Plays an unmistakable tone", "on the receiving PC's speakers."],
    ["Flashes a clear pop-up",     "with the sender, the subject and a preview."],
    ["Fires a Windows notification","that surfaces even when another app is on top."],
  ], { size: 10.5 });

  doc.roundedRect(48, 430, 746, 90, 8).fill(NAVY_SOFT);
  doc.roundedRect(48, 430, 746, 90, 8).lineWidth(0.7).strokeColor(GOLD_DIM).stroke();
  doc.fillColor(GOLD).fontSize(10).font("Helvetica-Bold")
     .text("ONLY THE RIGHT PC CHIMES", 64, 442, { characterSpacing: 3, lineBreak: false });
  doc.fillColor(INK_HI).fontSize(11).font("Helvetica")
     .text("Other command posts stay silent — a wing PC does not chime when a " +
           "squadron sends a schedule to a different wing, other squadrons do " +
           "not chime on pending rows that are not theirs, and the sender is " +
           "never alerted on their own copy.  Signal, not noise.",
           64, 460, { width: 714, lineGap: 2 });
  bottomBar(doc);
}

function pageSecurity(doc) {
  bg(doc, NAVY);
  topBar(doc, "Security & Privacy", 8);
  sectionTitle(doc, 48, 100, "Built for trust",
               "Security & privacy, in plain language.");

  if (fs.existsSync(`${IMG}/security_envelope.png`)) {
    doc.save();
    doc.roundedRect(500, 100, 294, 380, 10).clip();
    doc.image(`${IMG}/security_envelope.png`, 500, 100, { width: 294, height: 380 });
    doc.restore();
    doc.roundedRect(500, 100, 294, 380, 10).lineWidth(0.8).strokeColor(GOLD_DIM).stroke();
  }

  // Envelope metaphor box
  doc.roundedRect(48, 180, 420, 110, 8).fill(NAVY_SOFT);
  doc.roundedRect(48, 180, 420, 110, 8).lineWidth(0.7).strokeColor(GOLD_DIM).stroke();
  doc.fillColor(GOLD).fontSize(10).font("Helvetica-Bold")
     .text("THE SEALED-ENVELOPE PRINCIPLE", 64, 194, { characterSpacing: 2.5, lineBreak: false });
  doc.fillColor(INK_HI).fontSize(10.5).font("Helvetica")
     .text("Every piece of information that leaves a PC or a phone travels " +
           "inside a sealed digital envelope.  Only the authorised server can " +
           "open it.  A third party tapping the line would see sealed " +
           "envelopes — never the letters inside.  Industry calls this " +
           "\u201Ctransport security\u201D; we call it: what you send is what " +
           "only the intended command post reads.",
           64, 214, { width: 390, lineGap: 2 });

  bulletList(doc, 48, 310, 420, [
    ["Two-factor sign-in —", "each commander pairs an authenticator app; a stolen password alone is not enough to get in."],
    ["Role-based access —",  "a flight commander sees flight data, a wing commander sees wing data, a pilot sees their own record. Nothing beyond their mandate."],
    ["Private by design —",  "the database is locked down at the server level — even someone with a direct database connection only sees rows their role is entitled to."],
  ], { size: 10 });

  bottomBar(doc);
}

function pageTrustStack(doc) {
  bg(doc, NAVY);
  topBar(doc, "Security continued", 9);
  sectionTitle(doc, 48, 100, "Defence in depth",
               "More than one lock on the door.");

  const items = [
    { t: "Encrypted in flight", d: "Every request from a PC or phone is wrapped in the same protection banks use for online transactions.", i: iconShield },
    { t: "Encrypted at rest",   d: "The cloud database is stored on encrypted disks; stolen hardware reveals nothing readable.",             i: iconShield },
    { t: "Full audit trail",    d: "Who changed what, when, and from which device — recorded automatically and unalterable by the person who made the change.", i: iconChain },
    { t: "Password hygiene",    d: "Passwords are never stored — only a one-way fingerprint. A database leak cannot reveal them.",          i: iconShield },
    { t: "Lockout on abuse",    d: "Repeatedly wrong sign-in attempts freeze the account for a cool-down window. Brute force is blocked.",  i: iconBell },
    { t: "Rotate without drama",d: "Any credential can be rotated without re-installing anything; the change reaches every device at next sign-in.", i: iconChain },
  ];

  const cols = 3, rows = 2;
  const cw = (PAGE_W - 96 - (cols - 1) * 14) / cols;
  const ch = 160;
  items.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    card(doc, 48 + c * (cw + 14), 180 + r * (ch + 14), cw, ch, it.t, it.d, it.i);
  });

  bottomBar(doc);
}

function pageWhatItReplaces(doc) {
  bg(doc, NAVY);
  topBar(doc, "Before vs After", 10);
  sectionTitle(doc, 48, 100, "From paper to hawk-eyed",
               "What Hawk Eye replaces.");

  const rows = [
    ["Paper logbooks in a drawer",          "A live, searchable electronic logbook on every device."],
    ["WhatsApp groups for schedule changes","Private PC-to-PC messages, audited and priority-tagged."],
    ["Manually typed monthly reports",     "Auto-generated RCN Forms 1 – 4, bilingual, PDF-ready."],
    ["Forgotten currency expirations",     "Reminders before each pilot's next expiry."],
    ["Guest-pilot hours lost between squadrons", "Automatic cross-squadron approval flow."],
    ["Phone calls to confirm the latest schedule","Shared schedule chain — everyone sees the same version."],
  ];

  const leftX = 60, rightX = 430, rowH = 50, topY = 190;
  doc.fillColor(GOLD).fontSize(10).font("Helvetica-Bold")
     .text("YESTERDAY", leftX, topY - 22, { characterSpacing: 3, lineBreak: false })
     .text("WITH HAWK EYE", rightX, topY - 22, { characterSpacing: 3, lineBreak: false });

  rows.forEach((r, i) => {
    const y = topY + i * rowH;
    doc.roundedRect(48, y, 360, rowH - 8, 6).fill(NAVY_SOFT)
       .roundedRect(48, y, 360, rowH - 8, 6).lineWidth(0.5).strokeColor(GOLD_DIM).stroke();
    doc.fillColor(INK).fontSize(10.5).font("Helvetica")
       .text(r[0], 60, y + 12, { width: 336, lineGap: 2 });

    // Arrow
    doc.save();
    doc.moveTo(415, y + (rowH - 8) / 2).lineTo(425, y + (rowH - 8) / 2)
       .lineTo(420, y + (rowH - 8) / 2 - 4).moveTo(425, y + (rowH - 8) / 2)
       .lineTo(420, y + (rowH - 8) / 2 + 4).lineWidth(1.2).strokeColor(GOLD).stroke();
    doc.restore();

    doc.roundedRect(430, y, 364, rowH - 8, 6).fill(NAVY_SOFT)
       .roundedRect(430, y, 364, rowH - 8, 6).lineWidth(0.5).strokeColor(GOLD).stroke();
    doc.fillColor(INK_HI).fontSize(10.5).font("Helvetica-Bold")
       .text(r[1], 442, y + 12, { width: 340, lineGap: 2 });
  });

  bottomBar(doc);
}

function pageClosing(doc) {
  bg(doc, NAVY_DEEP);
  vignette(doc);

  doc.image(EMBLEM, PAGE_W / 2 - 45, 110, { width: 90 });

  doc.fillColor(GOLD).fontSize(11).font("Helvetica-Bold")
     .text("HAWK EYE", 0, 220, { width: PAGE_W, align: "center", characterSpacing: 6 });
  doc.fillColor(INK_HI).fontSize(32).font("Helvetica-Bold")
     .text("Sharper eyes. Stronger squadron.", 0, 245, { width: PAGE_W, align: "center" });
  doc.fillColor(INK).fontSize(14).font("Helvetica")
     .text("Every sortie counted. Every pilot ready. Every commander informed.",
           0, 295, { width: PAGE_W, align: "center" });

  // Chip row
  const chips = ["Windows Desktop", "Android & iOS", "Bilingual EN / AR",
                 "Two-factor login", "Encrypted end-to-end", "Full audit trail"];
  let cx = 80, cy = 360;
  doc.fontSize(9).font("Helvetica-Bold");
  for (const c of chips) {
    const w = doc.widthOfString(c) + 24;
    doc.roundedRect(cx, cy, w, 24, 12).lineWidth(0.8).strokeColor(GOLD).stroke();
    doc.fillColor(GOLD).text(c, cx + 12, cy + 7, { lineBreak: false, characterSpacing: 1.2 });
    cx += w + 8;
    if (cx > PAGE_W - 180) { cx = 80; cy += 34; }
  }

  doc.moveTo(PAGE_W / 2 - 40, PAGE_H - 120).lineTo(PAGE_W / 2 + 40, PAGE_H - 120)
     .lineWidth(1.5).strokeColor(GOLD).stroke();
  doc.fillColor(INK_DIM).fontSize(10).font("Helvetica")
     .text("Royal Jordanian Air Force  ·  Squadron Operations",
           0, PAGE_H - 108, { width: PAGE_W, align: "center" });
  doc.fillColor(INK_DIM).fontSize(9).font("Helvetica-Oblique")
     .text("Prepared for command review  ·  Version 1.0.48  ·  April 2026",
           0, PAGE_H - 88, { width: PAGE_W, align: "center" });
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const doc = new PDFDocument({
  size: [PAGE_W, PAGE_H],
  margin: 0,
  info: {
    Title: "Hawk Eye — Digital Squadron Operations",
    Author: "Royal Jordanian Air Force",
    Subject: "Command Briefing",
  },
});
doc.pipe(fs.createWriteStream(OUT));

pageCover(doc);

doc.addPage(); pageWhatIs(doc);
doc.addPage(); pageEcosystem(doc);
doc.addPage(); pageDashboard(doc);
doc.addPage(); pageMobile(doc);
doc.addPage(); pageStayInSync(doc);
doc.addPage(); pageAlerts(doc);
doc.addPage(); pageSecurity(doc);
doc.addPage(); pageTrustStack(doc);
doc.addPage(); pageWhatItReplaces(doc);
doc.addPage(); pageClosing(doc);

doc.end();

await new Promise(res => doc.on("end", res));
const stat = fs.statSync(OUT);
console.log(`wrote ${OUT} (${(stat.size / 1024).toFixed(1)} KB)`);
