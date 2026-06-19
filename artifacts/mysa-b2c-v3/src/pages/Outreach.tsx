import { useState, useRef, useCallback, useEffect } from "react";
import {
  useListOutreachEmails,
  useUpdateOutreachEmail,
  useSendOutreachEmail,
  useDeleteOutreachEmail,
  getListOutreachEmailsQueryKey,
} from "@workspace/api-client-react";
import ComposeModal from "@/components/ComposeModal";
import type { OutreachEmailEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Zap, Send, Mail, CheckCircle2, XCircle, Clock, Trash2,
  Edit3, Save, X, RefreshCw, ChevronRight, Globe, Pencil, Eye
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

type Tab = "draft" | "sent" | "failed";

function initials(first: string, last: string) {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
}

function CurrencyFlag({ currency }: { currency: string }) {
  const map: Record<string, string> = {
    INR: "🇮🇳", AED: "🇦🇪", SAR: "🇸🇦", GBP: "🇬🇧",
    EUR: "🇪🇺", AUD: "🇦🇺", SGD: "🇸🇬", CAD: "🇨🇦", USD: "🇺🇸",
  };
  return <span className="text-sm">{map[currency] ?? "🌍"}</span>;
}

function StatusIcon({ status, opened }: { status: string; opened?: boolean }) {
  if (status === "sent" && opened) return <Eye className="w-3.5 h-3.5 text-blue-500" />;
  if (status === "sent") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-red-500" />;
  return <Clock className="w-3.5 h-3.5 text-amber-500" />;
}

type SseStatus = "idle" | "running" | "done" | "error";

interface GeneratingState {
  leadId: number;
  status: SseStatus;
  message: string;
}

export default function Outreach() {
  const qc = useQueryClient();
  const { data: emails = [], isLoading, refetch } = useListOutreachEmails({
    query: { queryKey: getListOutreachEmailsQueryKey() },
  });

  const updateEmail = useUpdateOutreachEmail({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListOutreachEmailsQueryKey() }) },
  });
  const sendEmail = useSendOutreachEmail({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListOutreachEmailsQueryKey() }) },
  });
  const deleteEmail = useDeleteOutreachEmail({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListOutreachEmailsQueryKey() }) },
  });

  const [activeTab, setActiveTab] = useState<Tab>("draft");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [generating, setGenerating] = useState<GeneratingState | null>(null);
  const [bulkStatus, setBulkStatus] = useState<SseStatus>("idle");
  const [bulkMessage, setBulkMessage] = useState("");
  const sseRef = useRef<EventSource | null>(null);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "draft", label: "Drafts", icon: <Edit3 className="w-3.5 h-3.5" /> },
    { key: "sent", label: "Sent", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
    { key: "failed", label: "Failed", icon: <XCircle className="w-3.5 h-3.5" /> },
  ];

  const byTab = (tab: Tab) => (emails as OutreachEmailEntry[]).filter((e) => e.status === tab);
  const tabEmails = byTab(activeTab);

  const selected = selectedId ? (emails as OutreachEmailEntry[]).find((e) => e.id === selectedId) ?? null : null;

  useEffect(() => {
    if (selected && !isEditing) {
      setEditSubject(selected.subject);
      setEditBody(selected.body);
    }
  }, [selected?.id]);

  const closeSse = () => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
  };

  const generateSingle = useCallback((leadId: number) => {
    closeSse();
    setGenerating({ leadId, status: "running", message: "Auditing website…" });
    const API_BASE = "/api";
    const es = new EventSource(`${API_BASE}/outreach-ai/generate/${leadId}`);
    sseRef.current = es;
    es.addEventListener("progress", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        setGenerating((prev) => prev ? { ...prev, message: d.message ?? "" } : null);
      } catch {}
    });
    es.addEventListener("done", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        setGenerating({ leadId, status: "done", message: "Email generated!" });
        if (d.email) {
          qc.invalidateQueries({ queryKey: getListOutreachEmailsQueryKey() });
          setTimeout(() => {
            setSelectedId(d.email.id);
            setActiveTab("draft");
            setGenerating(null);
          }, 1200);
        }
      } catch {}
      closeSse();
    });
    es.addEventListener("error", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        setGenerating({ leadId, status: "error", message: d.message ?? "Generation failed" });
      } catch {
        setGenerating((prev) => prev ? { ...prev, status: "error", message: "Connection error" } : null);
      }
      closeSse();
    });
  }, [qc]);

  const generateAll = useCallback(() => {
    closeSse();
    setBulkStatus("running");
    setBulkMessage("Starting bulk generation…");
    const API_BASE = "/api";
    const es = new EventSource(`${API_BASE}/outreach-ai/generate-all`);
    sseRef.current = es;
    es.addEventListener("progress", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        setBulkMessage(d.message ?? "");
      } catch {}
    });
    es.addEventListener("done", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        setBulkMessage(d.message ?? "All emails generated!");
        setBulkStatus("done");
        qc.invalidateQueries({ queryKey: getListOutreachEmailsQueryKey() });
      } catch {}
      closeSse();
      setTimeout(() => { setBulkStatus("idle"); setBulkMessage(""); }, 3000);
    });
    es.addEventListener("error", () => {
      setBulkStatus("error");
      setBulkMessage("Bulk generation encountered an error");
      closeSse();
    });
  }, [qc]);

  const handleSave = () => {
    if (!selected) return;
    updateEmail.mutate({ id: selected.id, data: { subject: editSubject, body: editBody } });
    setIsEditing(false);
  };

  const handleSend = () => {
    if (!selected) return;
    sendEmail.mutate({ id: selected.id });
  };

  const handleDelete = () => {
    if (!selected) return;
    deleteEmail.mutate({ id: selected.id });
    setSelectedId(null);
  };

  const draftCount = byTab("draft").length;
  const sentCount = byTab("sent").length;
  const failedCount = byTab("failed").length;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#F8F9FA" }}>

      {/* Header */}
      <div className="px-3 md:px-6 py-3 md:py-4 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-base font-bold text-gray-900">AI Outreach Engine</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {draftCount} drafts · {sentCount} sent · {failedCount} failed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setComposeOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: "#5C1A8C" }}
          >
            <Pencil className="w-3.5 h-3.5" />
            Create New
          </button>
          <button
            onClick={generateAll}
            disabled={bulkStatus === "running"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60 transition-all"
            style={{ background: bulkStatus === "running" ? "#4A7C5E" : "#1A3D2B" }}
          >
            <Zap className="w-3.5 h-3.5" />
            {bulkStatus === "running" ? "Generating…" : "Generate All"}
          </button>
        </div>
      </div>

      {/* Bulk progress bar */}
      {bulkStatus !== "idle" && (
        <div className={cn(
          "px-6 py-2 text-xs font-medium flex items-center gap-2 flex-shrink-0",
          bulkStatus === "running" && "bg-amber-50 text-amber-700 border-b border-amber-100",
          bulkStatus === "done" && "bg-emerald-50 text-emerald-700 border-b border-emerald-100",
          bulkStatus === "error" && "bg-red-50 text-red-700 border-b border-red-100",
        )}>
          {bulkStatus === "running" && <Zap className="w-3.5 h-3.5 animate-pulse" />}
          {bulkStatus === "done" && <CheckCircle2 className="w-3.5 h-3.5" />}
          {bulkStatus === "error" && <XCircle className="w-3.5 h-3.5" />}
          {bulkMessage}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel: list — full width on mobile when no selection, 320px on desktop */}
        <div className={cn("flex-col border-r border-gray-200 bg-white flex-shrink-0 md:flex md:w-80", selectedId ? "hidden md:flex" : "flex w-full")}>

          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            {tabs.map((t) => {
              const count = byTab(t.key).length;
              return (
                <button
                  key={t.key}
                  onClick={() => { setActiveTab(t.key); setSelectedId(null); }}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
                    activeTab === t.key
                      ? "border-b-2 text-gray-900"
                      : "text-gray-400 hover:text-gray-700",
                  )}
                  style={activeTab === t.key ? { borderBottomColor: "#1A3D2B", color: "#1A3D2B" } : {}}
                >
                  {t.icon}
                  {t.label}
                  {count > 0 && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                      style={activeTab === t.key
                        ? { background: "#1A3D2B", color: "#fff" }
                        : { background: "#E5E7EB", color: "#6B7280" }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Email list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-3 border-b border-gray-100 animate-pulse">
                  <div className="flex gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-200 rounded w-3/4" />
                      <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                      <div className="h-2.5 bg-gray-100 rounded w-full" />
                    </div>
                  </div>
                </div>
              ))
            ) : tabEmails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <Mail className="w-8 h-8 text-gray-300 mb-3" />
                <p className="text-xs text-gray-400">
                  {activeTab === "draft" && "No draft emails yet. Click Generate All to create."}
                  {activeTab === "sent" && "No sent emails yet."}
                  {activeTab === "failed" && "No failed emails."}
                </p>
              </div>
            ) : (
              tabEmails.map((email) => {
                const isSelected = selectedId === email.id;
                const isGen = generating?.leadId === email.leadId && generating.status === "running";
                return (
                  <button
                    key={email.id}
                    onClick={() => {
                      setSelectedId(email.id);
                      setIsEditing(false);
                      setEditSubject(email.subject);
                      setEditBody(email.body);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-3 border-b border-gray-100 transition-colors flex gap-2.5",
                      isSelected ? "bg-emerald-50" : "hover:bg-gray-50",
                    )}
                  >
                    {/* Avatar */}
                    <div className="flex-shrink-0 relative">
                      {email.leadPhoto ? (
                        <img src={email.leadPhoto} className="w-8 h-8 rounded-full object-cover" />
                      ) : email.leadCompanyLogo ? (
                        <img src={email.leadCompanyLogo} className="w-8 h-8 rounded-full object-contain border border-gray-200 bg-white p-0.5" />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                          style={{ background: "#1A3D2B" }}
                        >
                          {initials(email.leadFirstName, email.leadLastName)}
                        </div>
                      )}
                      {isGen && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 animate-pulse border border-white" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-900 truncate">
                          {email.leadFirstName} {email.leadLastName}
                        </span>
                        <div className="flex items-center gap-1 ml-1">
                          {(email as { openedAt?: string }).openedAt && (
                            <span className="text-[9px] font-semibold px-1 py-0.5 rounded" style={{ background: "#EFF6FF", color: "#3B82F6" }}>OPENED</span>
                          )}
                          <CurrencyFlag currency={email.currency} />
                          <StatusIcon status={email.status} opened={!!(email as { openedAt?: string }).openedAt} />
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">{email.company}</div>
                      <div className="text-[11px] text-gray-400 truncate mt-0.5 italic">{email.subject}</div>
                      {isGen && (
                        <div className="text-[10px] text-amber-600 mt-0.5 font-medium animate-pulse">
                          {generating?.message}
                        </div>
                      )}
                    </div>
                    {isSelected && <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 self-center" />}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel: email preview — hidden on mobile when nothing selected */}
        <div className={cn("flex-1 flex flex-col overflow-hidden", !selected && "hidden md:flex")}>
          {/* Mobile back button */}
          {selected && (
            <button
              className="md:hidden flex items-center gap-1 px-3 py-2 text-xs text-gray-500 border-b border-gray-200 bg-white"
              onClick={() => setSelectedId(null)}
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back to list
            </button>
          )}
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "#1A3D2B15" }}
              >
                <Mail className="w-8 h-8" style={{ color: "#1A3D2B" }} />
              </div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Select an email to preview</p>
              <p className="text-xs text-gray-400 max-w-xs">
                Generate hyper-personalised outreach emails using AI that audits each lead's website and identifies real problems.
              </p>
              {activeTab === "draft" && (
                <button
                  onClick={generateAll}
                  disabled={bulkStatus === "running"}
                  className="mt-6 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "#1A3D2B" }}
                >
                  <Zap className="w-4 h-4" />
                  Generate All Emails
                </button>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* Email header */}
              <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-start justify-between flex-shrink-0">
                <div className="flex gap-3">
                  {selected.leadPhoto ? (
                    <img src={selected.leadPhoto} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                      style={{ background: "#1A3D2B" }}
                    >
                      {initials(selected.leadFirstName, selected.leadLastName)}
                    </div>
                  )}
                  <div>
                    <div className="font-semibold text-sm text-gray-900">
                      {selected.leadFirstName} {selected.leadLastName}
                    </div>
                    <div className="text-xs text-gray-500">
                      {selected.leadDesignation} · {selected.company}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="flex items-center gap-1 text-[11px] text-gray-400">
                        <Mail className="w-3 h-3" /> {selected.toEmail}
                      </span>
                      {selected.leadWebsite && (
                        <a
                          href={selected.leadWebsite}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] text-blue-500 hover:underline"
                        >
                          <Globe className="w-3 h-3" /> Website
                        </a>
                      )}
                      <span className="flex items-center gap-1 text-[11px] text-gray-400">
                        <CurrencyFlag currency={selected.currency} /> {selected.currency} · {selected.country}
                      </span>
                      {(selected as unknown as { openedAt?: string }).openedAt && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#EFF6FF", color: "#3B82F6" }}>
                          <Eye className="w-3 h-3" />
                          Opened {formatDistanceToNow(new Date((selected as unknown as { openedAt: string }).openedAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  {selected.status === "draft" && (
                    <>
                      {!isEditing ? (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => { setIsEditing(false); setEditSubject(selected.subject); setEditBody(selected.body); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100"
                          >
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                          <button
                            onClick={handleSave}
                            disabled={updateEmail.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
                            style={{ background: "#1A3D2B" }}
                          >
                            <Save className="w-3.5 h-3.5" />
                            {updateEmail.isPending ? "Saving…" : "Save"}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => generateSingle(selected.leadId)}
                        disabled={generating?.status === "running"}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 disabled:opacity-60"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        {generating?.leadId === selected.leadId && generating?.status === "running"
                          ? "Generating…"
                          : "Regenerate"}
                      </button>
                      <button
                        onClick={handleSend}
                        disabled={sendEmail.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
                        style={{ background: "#1A3D2B" }}
                      >
                        <Send className="w-3.5 h-3.5" />
                        {sendEmail.isPending ? "Sending…" : "Send Email"}
                      </button>
                      <button
                        onClick={handleDelete}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {selected.status === "failed" && (
                    <>
                      <button
                        onClick={() => generateSingle(selected.leadId)}
                        disabled={generating?.status === "running"}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 disabled:opacity-60"
                      >
                        <Zap className="w-3.5 h-3.5" /> Regenerate
                      </button>
                      <button
                        onClick={() => sendEmail.mutate({ id: selected.id })}
                        disabled={sendEmail.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-60"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", sendEmail.isPending && "animate-spin")} />
                        {sendEmail.isPending ? "Sending…" : "Resend"}
                      </button>
                      <button
                        onClick={handleDelete}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {selected.status === "sent" && (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Sent {selected.sentAt ? formatDistanceToNow(new Date(selected.sentAt), { addSuffix: true }) : ""}
                      </div>
                      <button
                        onClick={() => sendEmail.mutate({ id: selected.id })}
                        disabled={sendEmail.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-60"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", sendEmail.isPending && "animate-spin")} />
                        {sendEmail.isPending ? "Sending…" : "Resend"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Generation progress */}
              {generating?.leadId === selected.leadId && generating.status === "running" && (
                <div className="px-6 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-700 font-medium flex-shrink-0">
                  <Zap className="w-3.5 h-3.5 animate-pulse" />
                  {generating.message}
                </div>
              )}
              {generating?.leadId === selected.leadId && generating.status === "done" && (
                <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2 text-xs text-emerald-700 font-medium flex-shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Email generated successfully!
                </div>
              )}
              {generating?.leadId === selected.leadId && generating.status === "error" && (
                <div className="px-6 py-2 bg-red-50 border-b border-red-100 flex items-center gap-2 text-xs text-red-700 font-medium flex-shrink-0">
                  <XCircle className="w-3.5 h-3.5" /> {generating.message}
                </div>
              )}

              {/* Error msg for failed */}
              {selected.status === "failed" && selected.errorMsg && (
                <div className="px-6 py-2 bg-red-50 border-b border-red-100 flex items-center gap-2 text-xs text-red-700 flex-shrink-0">
                  <XCircle className="w-3.5 h-3.5" /> <strong>Send Error:</strong> {selected.errorMsg}
                </div>
              )}

              {/* Email body */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-2xl mx-auto">

                  {/* Created time */}
                  <div className="text-[11px] text-gray-400 mb-4">
                    Created {formatDistanceToNow(new Date(selected.createdAt), { addSuffix: true })}
                    {selected.auditRunId && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">
                        AI Audited
                      </span>
                    )}
                  </div>

                  {/* Subject */}
                  <div className="mb-4">
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Subject</label>
                    {isEditing ? (
                      <input
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-800/20"
                      />
                    ) : (
                      <div className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-900">
                        {selected.subject}
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email Body</label>
                    {isEditing ? (
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={20}
                        className="w-full px-4 py-3 rounded-lg border border-gray-200 text-sm text-gray-800 font-mono focus:outline-none focus:ring-2 focus:ring-green-800/20 resize-none"
                      />
                    ) : (
                      <div className="px-4 py-4 rounded-lg bg-white border border-gray-200 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed font-sans">
                        {selected.body}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* Per-lead generate if no emails in draft */}
          {selected === null && activeTab === "draft" && tabEmails.length === 0 && !isLoading && (
            <div />
          )}
        </div>
      </div>

      {/* Generate per lead button for leads that don't have an email yet */}
      {activeTab === "draft" && tabEmails.length > 0 && !selected && (
        <div className="px-6 py-3 border-t border-gray-200 bg-white flex-shrink-0 flex items-center justify-between">
          <span className="text-xs text-gray-500">Select a draft to preview, edit, and send</span>
        </div>
      )}

      {/* Compose Modal */}
      {composeOpen && (
        <ComposeModal
          onClose={() => {
            setComposeOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}
