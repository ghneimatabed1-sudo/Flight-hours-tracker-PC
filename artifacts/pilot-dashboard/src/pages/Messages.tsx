import { useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import {
  useMessages,
  useSendMessage,
  useMarkMessageRead,
  useRegisteredPCs,
  getMessageRetentionDays,
  setMessageRetentionDays,
  MESSAGE_RETENTION_MAX_DAYS,
  canUseMessages,
  getLocalPcId,
  getFlightBinding,
  type MessagePriority,
  type PrivateMessage,
} from "@/lib/cross-pc";
import { useToast } from "@/hooks/use-toast";
import { fmtDateTimeDDMM } from "@/lib/format";
import { Mail, Send, Reply, Check, AlertOctagon, Settings } from "lucide-react";

// User-facing labels: keep the DB enum (normal/medium/urgent) but show
// the operator's preferred wording (Normal / High / Very High) and the
// agreed colour scheme — green / yellow / red.
const priorityLabels: Record<MessagePriority, string> = {
  normal: "Normal",
  medium: "High",
  urgent: "Very High",
};

// "Seen" / read-receipt is only meaningful for the chain of command the
// operator described: inside a single squadron (Flight Cmdr ↔ Squadron
// Cmdr) and between a Squadron Cmdr and the Wing Cmdr that monitors
// them. Anything involving a Base PC — or any other tier pair — keeps
// the message visible but hides the seen UI on both ends.
function seenAllowed(m: PrivateMessage): boolean {
  const a = m.fromTier;
  const b = m.toTier;
  if (a === "squadron" && b === "squadron") return true;
  if (a === "squadron" && b === "wing")     return true;
  if (a === "wing"     && b === "squadron") return true;
  // Flight Commander ↔ bound Squadron Commander is treated as the same
  // chain-of-command pair as squadron↔squadron for read-receipt purposes.
  if (a === "flight"   && b === "squadron") return true;
  if (a === "squadron" && b === "flight")   return true;
  return false;
}
const priorityClasses: Record<MessagePriority, string> = {
  normal: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40",
  medium: "bg-amber-400/20 text-amber-100 border-amber-400/40",
  urgent: "bg-rose-500/20 text-rose-100 border-rose-400/40",
};

export default function Messages() {
  const { user, squadron } = useAuth();
  const { toast } = useToast();
  const allowed = canUseMessages(user?.role, user?.scope);
  const myTier: "flight" | "squadron" | "wing" | "base" =
    user?.scope === "wing" ? "wing"
    : user?.scope === "base" ? "base"
    : user?.scope === "flight" ? "flight"
    : "squadron";
  const isFlightCmdr = user?.role === "commander" && user?.scope === "flight";
  const flightBinding = isFlightCmdr ? getFlightBinding() : null;
  // Use the canonical PC id written by registerLocalPC (squadron name for
  // squadron tier, "WING:..." / "BASE:..." for commander tiers) so both
  // the writer (sender) and the reader (recipient inbox filter) agree.
  const canonicalId = getLocalPcId();
  const fallbackId = myTier === "squadron"
    ? (squadron?.name ?? user?.username ?? "")
    : `${myTier.toUpperCase()}:${squadron?.name ?? user?.username ?? user?.displayName ?? "CMD"}`;
  const myPcId = canonicalId || fallbackId || null;
  const myPcName = squadron?.name ?? user?.displayName ?? "Local PC";

  const registry = useRegisteredPCs();
  const inbox = useMessages(myPcId);
  const send = useSendMessage();
  const markRead = useMarkMessageRead();

  const [tab, setTab] = useState<"inbox" | "sent" | "history" | "compose" | "settings">("inbox");
  const [composeTo, setComposeTo] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("normal");
  const [replyTo, setReplyTo] = useState<PrivateMessage | null>(null);
  const [retention, setRetention] = useState(getMessageRetentionDays());

  // Private messages are limited to Squadron / Wing / Base PCs — HQ
  // and any other tiers are excluded from both the recipient picker
  // and the inbox filter. Flight Commander PCs may only message their
  // bound Squadron Commander, so the picker collapses to that one row.
  // Squadron commanders officially link specific flight commander PCs in
  // their squadron at setup time (see LicenseKeys.tsx Setup dialog). Those
  // IDs are persisted to localStorage on this PC so the Messages picker can
  // surface them as extra private-message counterparts — otherwise flight
  // tiers are excluded by the base filter below.
  const linkedFlightPcIds = useMemo<string[]>(() => {
    try {
      const raw = localStorage.getItem("rjaf.linkedFlightPcIds");
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }, []);

  const selectablePCs = useMemo(
    () => {
      // Hide PCs that haven't reported in 30 days. Without this filter the
      // recipient picker grows unbounded as PCs are reinstalled / retired
      // and would become unusable at 100+ deployments. Linked-flight PCs
      // bypass the staleness filter so a freshly-reimaged flight PC is
      // never invisible to its own squadron commander while it warms up.
      const STALE_CUTOFF_MS = Date.now() - 30 * 86_400_000;
      // v1.1.42: drop the "must be linked" gate that was hiding every
      // Flight Cmdr PC from the Sqn Cmdr's recipient picker whenever
      // the operator skipped the linked-flight setup step. Now any
      // Flight/Squadron/Wing/Base PC in the registry is selectable;
      // the staleness cutoff still trims unbounded growth in 100+
      // deployments, and explicitly-linked Flight PCs still bypass it.
      const base = registry.data.filter(
        p => !p.isSelf && (
          p.tier === "squadron" || p.tier === "wing" || p.tier === "base" || p.tier === "flight"
        ),
      ).filter(p => {
        if (p.tier === "flight" && linkedFlightPcIds.includes(p.id)) return true;
        return new Date(p.lastSeen).getTime() >= STALE_CUTOFF_MS;
      }).sort((a, b) => {
        // Sort by tier (base → wing → squadron → flight) then by displayed
        // name so finding a specific PC in a 100-row dropdown is fast.
        const tierOrder = { base: 0, wing: 1, squadron: 2, flight: 3 } as const;
        const ta = tierOrder[a.tier as keyof typeof tierOrder] ?? 9;
        const tb = tierOrder[b.tier as keyof typeof tierOrder] ?? 9;
        if (ta !== tb) return ta - tb;
        return (a.deviceName || a.squadronName).localeCompare(b.deviceName || b.squadronName);
      });
      if (isFlightCmdr && flightBinding) {
        // v1.1.30: a Flight Cmdr PC was previously locked to messaging
        // ONLY the PC it was bound to (the Ops PC, since Ops is the
        // squadron anchor). That meant the squadron commander could
        // never be reached from the flight commander's PC even though
        // both PCs sit in the same squadron group. Widen the picker so
        // the Flight Cmdr can message every squadron-tier PC that
        // belongs to the same squadron as the bound Ops PC — that
        // surfaces both the Ops PC and the Squadron Commander PC.
        // Names are normalised the same way the LicenseKeys setup
        // dialog matches them (lowercase + strip non-alphanumeric, plus
        // a substring + bare-number fallback), so spelling drift like
        // "NO.8" vs "no 8" vs "8 SQN" still groups correctly.
        const boundPc = registry.data.find(p => p.id === flightBinding.pcId);
        const normalize = (s: string | undefined | null) =>
          (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        // v1.1.34: when the Ops PC is fully shut down and its registry
        // row hasn't synced to this Flight PC yet, `boundPc` is
        // undefined — leaving the Sqn Cmdr off the picker. Fall back
        // to this Flight PC's own squadron name from the auth context
        // so the Flight Cmdr ↔ Sqn Cmdr channel keeps working with
        // the Ops PC powered off.
        const opsSqName = boundPc?.squadronName ?? squadron?.name ?? "";
        const boundKey = normalize(opsSqName);
        const boundDigits = opsSqName.match(/\d+/)?.[0] ?? "";
        const sameSquadron = (other: { squadronName?: string }) => {
          const k = normalize(other.squadronName);
          if (!k || !boundKey) return false;
          if (k === boundKey) return true;
          if (k.includes(boundKey) || boundKey.includes(k)) return true;
          if (boundDigits && k.includes(boundDigits)) return true;
          return false;
        };
        return base.filter(p =>
          // Always include the bound Ops PC even if registry doesn't
          // show it (defensive — the binding is the source of truth).
          p.id === flightBinding.pcId
          // Plus every squadron-tier PC sharing the bound squadron —
          // picks up the Squadron Commander PC alongside the Ops PC.
          || (p.tier === "squadron" && sameSquadron(p))
        );
      }
      return base;
    },
    [registry.data, isFlightCmdr, flightBinding?.pcId, linkedFlightPcIds],
  );
  // v1.1.42: forgiving fallback. If the strict tier filter yields zero
  // recipients (registry rows are all stale, or the tier classifier on
  // this PC has lost track of which is which), expose every non-self
  // row so the operator can still pick someone manually. Mirrors the
  // ScheduleChain composer's escape hatch.
  const selectablePCsFallback = useMemo(
    () => registry.data.filter(p => !p.isSelf),
    [registry.data],
  );
  const usingFallbackRecipients = selectablePCs.length === 0 && selectablePCsFallback.length > 0;
  const effectiveSelectablePCs = usingFallbackRecipients ? selectablePCsFallback : selectablePCs;

  if (!allowed) {
    return (
      <div>
        <PageHead title="Messages" />
        <Card>
          <div className="text-sm text-muted-foreground py-6 text-center">
            Private messages are reserved for Squadron, Wing and Base tiers.
          </div>
        </Card>
      </div>
    );
  }

  const composeReset = () => {
    setComposeTo(""); setSubject(""); setBody(""); setPriority("normal"); setReplyTo(null);
  };

  // v1.1.45: virtual logical-seat recipients. The operator can address
  // a TIER+SQUADRON seat (e.g. "Any Flight Cmdr in NO.8") even when no
  // such PC has registered itself yet. The message ships with toPcId =
  // "FLIGHT:<sqn>" (no suffix) and the v1.1.44 logical-seat matcher on
  // the receiving PC catches it because their myLogicalSeat strips the
  // "#<deviceSuffix>" tail.
  const sqName = squadron?.name ?? "";
  const logicalSeatTargets = useMemo(() => {
    if (!sqName) return [] as Array<{ id: string; label: string; tier: "flight"|"squadron"|"wing"|"base" }>;
    const out: Array<{ id: string; label: string; tier: "flight"|"squadron"|"wing"|"base" }> = [];
    if (myTier === "squadron" || myTier === "wing" || myTier === "base") {
      out.push({ id: `FLIGHT:${sqName}`, label: `Any Flight Cmdr in ${sqName}`, tier: "flight" });
    }
    if (myTier === "flight") {
      out.push({ id: `SQDNCMD:${sqName}`, label: `Squadron Cmdr of ${sqName}`, tier: "squadron" });
      out.push({ id: sqName, label: `Squadron Ops PC (${sqName})`, tier: "squadron" });
    }
    return out;
  }, [sqName, myTier]);

  const submitSend = async () => {
    if (!composeTo) { toast({ title: "Pick a recipient PC", variant: "destructive" }); return; }
    if (!subject.trim() || !body.trim()) { toast({ title: "Subject and body required", variant: "destructive" }); return; }
    const realTarget = registry.data.find(p => p.id === composeTo);
    const seatTarget = logicalSeatTargets.find(s => s.id === composeTo);
    if (!realTarget && !seatTarget) { toast({ title: "Recipient not found", variant: "destructive" }); return; }
    const target = realTarget ?? {
      id: seatTarget!.id,
      squadronName: seatTarget!.label,
      tier: seatTarget!.tier,
    } as { id: string; squadronName: string; tier: "flight"|"squadron"|"wing"|"base" };
    if (target.tier !== "squadron" && target.tier !== "wing" && target.tier !== "base" && target.tier !== "flight") {
      toast({ title: "Messages restricted to Flt/Sqn/Wing/Base only", variant: "destructive" });
      return;
    }
    if (isFlightCmdr && flightBinding && !seatTarget) {
      // v1.1.31: Flight Cmdr may message the bound Ops PC OR any
      // squadron-tier PC inside the same squadron (the Squadron Cmdr
      // PC). Anything outside that scope (other squadrons, wing/base,
      // unrelated flight PCs) stays blocked. Mirrors the picker's own
      // selectablePCs filter so what the operator can SEE matches
      // what the send guard accepts.
      const boundPc = registry.data.find(p => p.id === flightBinding.pcId);
      const normalize = (s: string | undefined | null) =>
        (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      // v1.1.34: same fallback as the picker — if the Ops PC is shut
      // down and unreachable in registry, anchor the same-squadron
      // check on this Flight PC's own auth squadron name so the send
      // to the Sqn Cmdr still passes the guard.
      const opsSqName = boundPc?.squadronName ?? squadron?.name ?? "";
      const boundKey = normalize(opsSqName);
      const boundDigits = opsSqName.match(/\d+/)?.[0] ?? "";
      const targetKey = normalize(target.squadronName);
      const sameSquadron =
        !!boundKey && !!targetKey && (
          targetKey === boundKey
          || targetKey.includes(boundKey) || boundKey.includes(targetKey)
          || (!!boundDigits && targetKey.includes(boundDigits))
        );
      const isBound = target.id === flightBinding.pcId;
      const isSquadronPeer = target.tier === "squadron" && sameSquadron;
      if (!isBound && !isSquadronPeer) {
        toast({ title: "Flight Commander may only message PCs in the bound squadron", variant: "destructive" });
        return;
      }
    }
    await send.mutateAsync({
      threadId: replyTo?.threadId,
      fromPcId: myPcId ?? "self",
      fromPcName: myPcName,
      fromTier: myTier,
      fromUser: user?.username ?? "ops",
      toPcId: target.id,
      toPcName: target.squadronName,
      toTier: target.tier,
      subject: subject.trim(),
      body: body.trim(),
      priority,
    });
    if (replyTo) {
      await markRead.mutateAsync({ id: replyTo.id });
    }
    toast({ title: "Message sent" });
    composeReset();
    setTab("sent");
  };

  const startReply = (m: PrivateMessage) => {
    setReplyTo(m);
    setComposeTo(m.fromPcId);
    setSubject(m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`);
    setBody("");
    setPriority(m.priority);
    setTab("compose");
  };

  const tabs = [
    { id: "inbox" as const, label: `Inbox (${inbox.inbox.length})`, icon: Mail },
    { id: "sent" as const, label: "Sent", icon: Send },
    { id: "history" as const, label: "History", icon: Check },
    { id: "compose" as const, label: replyTo ? "Reply" : "Compose", icon: Send },
    { id: "settings" as const, label: "Settings", icon: Settings },
  ];

  return (
    <div>
      <PageHead title="Messages" subtitle="Sqn ↔ Wing ↔ Base · text only · auto-deletes after retention window" />
      <div className="flex gap-2 mb-3 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border inline-flex items-center gap-1.5 ${
              tab === t.id ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-border"
            }`}
            data-testid={`tab-${t.id}`}
          >
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </div>

      {tab === "inbox" && <MessageList items={inbox.inbox} onReply={startReply} onMark={(m) => markRead.mutateAsync({ id: m.id }).then(() => toast({ title: "Marked read" }))} myPcId={myPcId} kind="inbox" />}
      {tab === "sent" && <MessageList items={inbox.sent} myPcId={myPcId} kind="sent" />}
      {tab === "history" && <MessageList items={inbox.history} myPcId={myPcId} kind="history" />}

      {tab === "compose" && (
        <Card>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Recipient PC</label>
              <select
                value={composeTo}
                onChange={e => setComposeTo(e.target.value)}
                className="w-full mt-1 px-3 py-1.5 rounded-md bg-input border border-border text-sm"
                data-testid="select-recipient"
              >
                <option value="">— pick a registered PC or logical seat —</option>
                {logicalSeatTargets.length > 0 && (
                  <optgroup label="By role (delivers to whoever is signed in)">
                    {logicalSeatTargets.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={`Registered PCs (${effectiveSelectablePCs.length})`}>
                  {effectiveSelectablePCs.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.deviceName || p.squadronName} · {p.tier}{p.online ? " · online" : " · offline (will deliver on reconnect)"}
                    </option>
                  ))}
                </optgroup>
              </select>
              {usingFallbackRecipients && (
                <p className="text-[11px] text-amber-300 mt-1">
                  No PC matched the strict tier filter — showing every PC in the registry ({effectiveSelectablePCs.length}). Pick the right one manually.
                </p>
              )}
              {effectiveSelectablePCs.length === 0 && (
                <p className="text-[11px] text-amber-300 mt-1">
                  No other PC has registered yet on this network. Use a "By role" option above — the message will deliver the moment that role's PC comes online.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">
                Registry on this PC: {registry.data.length} PC(s) total
                {registry.data.length > 0 && (
                  <> · {registry.data.filter(p => p.tier === "flight").length} flight, {registry.data.filter(p => p.tier === "squadron").length} squadron, {registry.data.filter(p => p.tier === "wing").length} wing, {registry.data.filter(p => p.tier === "base").length} base</>
                )}
              </p>
              {composeTo && (() => {
                const sel = effectiveSelectablePCs.find(p => p.id === composeTo);
                if (!sel || sel.online) return null;
                return (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                    This PC isn't connected right now. Send anyway — the message is stored on the network and the recipient sees it the moment Hawk Eye next syncs (usually within 30 seconds of them coming online).
                  </p>
                );
              })()}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full mt-1 px-3 py-1.5 rounded-md bg-input border border-border text-sm" data-testid="input-subject" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Priority</label>
                <div className="flex gap-2 mt-1">
                  {(["normal", "medium", "urgent"] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold border capitalize ${
                        priority === p ? priorityClasses[p] : "bg-secondary border-border text-muted-foreground"
                      }`}
                      data-testid={`priority-${p}`}
                    >
                      {p === "urgent" && <AlertOctagon className="h-3 w-3 inline mr-1" />}{priorityLabels[p]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Message (text only)</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={6}
                className="w-full mt-1 px-3 py-1.5 rounded-md bg-input border border-border text-sm font-mono"
                data-testid="input-body"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={submitSend}
                disabled={send.isPending}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                data-testid="button-send"
              >
                <Send className="h-4 w-4" /> Send
              </button>
              <button onClick={composeReset} className="px-4 py-2 rounded-md bg-secondary border border-border text-sm">Clear</button>
            </div>
          </div>
        </Card>
      )}

      {tab === "settings" && (
        <Card>
          <div className="space-y-3">
            <div className="text-sm font-semibold">Auto-delete window</div>
            <div className="text-xs text-muted-foreground">
              Messages are purged automatically after this many days. Hard ceiling: {MESSAGE_RETENTION_MAX_DAYS} days.
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={MESSAGE_RETENTION_MAX_DAYS}
                value={retention}
                onChange={e => setRetention(Number(e.target.value))}
                className="w-24 px-3 py-1.5 rounded-md bg-input border border-border text-sm"
                data-testid="input-retention"
              />
              <span className="text-xs text-muted-foreground">days</span>
              <button
                onClick={() => { setMessageRetentionDays(retention); setRetention(getMessageRetentionDays()); toast({ title: "Retention saved" }); }}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold"
                data-testid="button-save-retention"
              >Save</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function MessageList({ items, onReply, onMark, myPcId, kind }: {
  items: PrivateMessage[];
  onReply?: (m: PrivateMessage) => void;
  onMark?: (m: PrivateMessage) => void;
  myPcId: string | null;
  kind: "inbox" | "sent" | "history";
}) {
  if (items.length === 0) {
    return (
      <Card>
        <div className="text-sm text-muted-foreground text-center py-8">No messages.</div>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map(m => {
        // Read-receipt UI is only available on the chain-of-command pairs
        // the operator authorised: squadron-internal (Sqn Cmdr ↔ Flight
        // Cmdr) and Squadron Cmdr ↔ Wing Cmdr (either direction).
        const seenOK = seenAllowed(m);
        // Render "User · PC" so it's instantly clear who is talking from
        // which PC. The username comes from the sender's own login.
        const fromLabel = `${m.fromUser} · ${m.fromPcName}`;
        const toLabel   = `${m.toPcName}`;
        return (
          <Card key={m.id} className={`!p-3 border-l-4 ${
            m.priority === "urgent" ? "border-l-rose-400"
            : m.priority === "medium" ? "border-l-amber-400"
            : "border-l-emerald-500/60"
          }`} data-testid={`msg-${m.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{m.subject}</div>
                <div className="text-[11px] text-muted-foreground">
                  {kind === "sent" ? `to ${toLabel}` : `from ${fromLabel}`} · {fmtDateTimeDDMM(m.sentAt)}
                  {/* Read-receipt line — only rendered for the authorised
                      chain-of-command pairs. On every other PC pair the
                      message still appears, just without the seen UI. */}
                  {seenOK && (
                    m.readAt
                      ? (kind === "sent"
                          ? ` · seen by ${m.toPcName} ${fmtDateTimeDDMM(m.readAt)}`
                          : ` · seen ${fmtDateTimeDDMM(m.readAt)}`)
                      : (kind === "sent" ? " · not seen yet" : "")
                  )}
                </div>
              </div>
              <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${priorityClasses[m.priority]}`}>{priorityLabels[m.priority]}</span>
            </div>
            <div className="text-sm mt-2 whitespace-pre-wrap font-mono">{m.body}</div>
            {(onReply || onMark) && m.toPcId === myPcId && (
              <div className="flex gap-2 mt-2">
                {onReply && (
                  <button onClick={() => onReply(m)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary border border-border" data-testid={`reply-${m.id}`}>
                    <Reply className="h-3 w-3" /> Reply
                  </button>
                )}
                {onMark && seenOK && !m.readAt && (
                  <button onClick={() => onMark(m)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 font-semibold" data-testid={`mark-${m.id}`}>
                    <Check className="h-3 w-3" /> Mark Seen
                  </button>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
