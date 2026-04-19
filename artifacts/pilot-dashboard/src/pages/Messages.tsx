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
  type MessagePriority,
  type PrivateMessage,
} from "@/lib/cross-pc";
import { useToast } from "@/hooks/use-toast";
import { fmtDateTimeDDMM } from "@/lib/format";
import { Mail, Send, Reply, Check, AlertOctagon, Settings } from "lucide-react";

const priorityClasses: Record<MessagePriority, string> = {
  normal: "bg-secondary text-foreground border-border",
  medium: "bg-amber-400/20 text-amber-100 border-amber-400/40",
  urgent: "bg-rose-500/20 text-rose-100 border-rose-400/40",
};

export default function Messages() {
  const { user, squadron } = useAuth();
  const { toast } = useToast();
  const allowed = canUseMessages(user?.role, user?.scope);
  const myTier: "squadron" | "wing" | "base" =
    user?.scope === "wing" ? "wing"
    : user?.scope === "base" ? "base"
    : "squadron";
  // Use the canonical PC id written by registerLocalPC (squadron name for
  // squadron tier, "WING:..." / "BASE:..." for commander tiers) so both
  // the writer (sender) and the reader (recipient inbox filter) agree.
  const canonicalId = getLocalPcId();
  const fallbackId = myTier === "squadron"
    ? (squadron?.name ?? user?.username ?? "")
    : `${myTier.toUpperCase()}:${user?.displayName ?? user?.username ?? "CMD"}`;
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
  // and the inbox filter.
  const selectablePCs = useMemo(
    () => registry.data.filter(p => !p.isSelf && (p.tier === "squadron" || p.tier === "wing" || p.tier === "base")),
    [registry.data],
  );

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

  const submitSend = async () => {
    if (!composeTo) { toast({ title: "Pick a recipient PC", variant: "destructive" }); return; }
    if (!subject.trim() || !body.trim()) { toast({ title: "Subject and body required", variant: "destructive" }); return; }
    const target = registry.data.find(p => p.id === composeTo);
    if (!target) { toast({ title: "Recipient not found", variant: "destructive" }); return; }
    if (target.tier !== "squadron" && target.tier !== "wing" && target.tier !== "base") {
      toast({ title: "Messages restricted to Sqn/Wing/Base only", variant: "destructive" });
      return;
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
                <option value="">— pick a registered PC —</option>
                {selectablePCs.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.squadronName}{p.base ? ` · ${p.base}` : ""}{p.online ? " · online" : " · offline"}
                  </option>
                ))}
              </select>
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
                      {p === "urgent" && <AlertOctagon className="h-3 w-3 inline mr-1" />}{p}
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
      {items.map(m => (
        <Card key={m.id} className={`!p-3 border-l-4 ${
          m.priority === "urgent" ? "border-l-rose-400"
          : m.priority === "medium" ? "border-l-amber-400"
          : "border-l-border"
        }`} data-testid={`msg-${m.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{m.subject}</div>
              <div className="text-[11px] text-muted-foreground">
                {kind === "sent" ? `to ${m.toPcName}` : `from ${m.fromPcName}`} · {fmtDateTimeDDMM(m.sentAt)}
                {m.readAt && kind !== "sent" ? ` · read ${fmtDateTimeDDMM(m.readAt)}` : ""}
              </div>
            </div>
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${priorityClasses[m.priority]}`}>{m.priority}</span>
          </div>
          <div className="text-sm mt-2 whitespace-pre-wrap font-mono">{m.body}</div>
          {(onReply || onMark) && m.toPcId === myPcId && (
            <div className="flex gap-2 mt-2">
              {onReply && (
                <button onClick={() => onReply(m)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary border border-border" data-testid={`reply-${m.id}`}>
                  <Reply className="h-3 w-3" /> Reply
                </button>
              )}
              {onMark && (
                <button onClick={() => onMark(m)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary border border-border" data-testid={`mark-${m.id}`}>
                  <Check className="h-3 w-3" /> Mark read
                </button>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
