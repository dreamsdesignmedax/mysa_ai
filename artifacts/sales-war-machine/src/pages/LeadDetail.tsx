import { useState, useMemo, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useGetLead, useUpdateLead, useListMeetings, useListLeads, getListMeetingsQueryKey } from "@workspace/api-client-react";
import { getGetLeadQueryKey, getListLeadsQueryKey } from "@workspace/api-client-react";
import type { MeetingWithLead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge, Tag } from "@/components/Badge";
import { bandColorFromKey, bandLabelFromKey, scoreToBandKey, formatDate, formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ArrowLeft, ChevronLeft, ChevronRight, Globe, Linkedin, Phone, Mail, Building2, MapPin, MessageCircle, Pencil, X, Check, Loader2, Sparkles, CalendarPlus, CalendarDays, Download } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { NewMeetingModal, downloadICS } from "@/components/NewMeetingModal";

type EditDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  website: string;
  linkedInUrl: string;
  company: string;
  designation: string;
  industry: string;
  country: string;
  companySize: string;
  source: string;
  notes: string;
  tags: string;
};

const INPUT_CLS = "w-full text-xs rounded border border-gray-300 bg-white text-gray-900 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500";
const LABEL_CLS = "text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5";

export default function LeadDetail() {
  const [, params] = useRoute("/leads/:id");
  const id = Number(params?.id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const navList = useMemo<number[]>(() => {
    try {
      const raw = sessionStorage.getItem("leadsNavList");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, []);

  const currentIndex = navList.indexOf(id);
  const prevId = currentIndex > 0 ? navList[currentIndex - 1] : null;
  const nextId = currentIndex !== -1 && currentIndex < navList.length - 1 ? navList[currentIndex + 1] : null;

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreError, setRescoreError] = useState<string | null>(null);
  const ALREADY_SCORED_MSG = "This lead has already been scored. Refresh or use Re-score to update.";
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const { toast } = useToast();

  const { data: allMeetings = [] } = useListMeetings();
  const { data: leadsResp } = useListLeads();
  const leadMeetings = (allMeetings as MeetingWithLead[]).filter(m => m.lead?.id === id);

  useEffect(() => {
    setRescoreError(null);
  }, [id]);

  const { data: lead, isLoading } = useGetLead(id, {
    query: { enabled: !!id, queryKey: getGetLeadQueryKey(id) },
  });

  const updateLead = useUpdateLead({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
        setIsEditing(false);
        setDraft(null);
        setSaveError(null);
      },
      onError: () => setSaveError("Failed to save changes. Please try again."),
    },
  });

  const startEditing = () => {
    if (!lead) return;
    setDraft({
      firstName: lead.firstName ?? "",
      lastName: lead.lastName ?? "",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      website: lead.website ?? "",
      linkedInUrl: lead.linkedInUrl ?? "",
      company: lead.company ?? "",
      designation: lead.designation ?? "",
      industry: lead.industry ?? "",
      country: lead.country ?? "",
      companySize: lead.companySize ?? "",
      source: lead.source ?? "",
      notes: lead.notes ?? "",
      tags: (lead.tags ?? []).join(", "),
    });
    setSaveError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setDraft(null);
    setSaveError(null);
  };

  const saveEditing = () => {
    if (!draft) return;
    const tagsArray = draft.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    updateLead.mutate({
      id,
      data: {
        firstName: draft.firstName || undefined,
        lastName: draft.lastName || undefined,
        email: draft.email || undefined,
        phone: draft.phone || null,
        website: draft.website || null,
        linkedInUrl: draft.linkedInUrl || null,
        company: draft.company || undefined,
        designation: draft.designation || undefined,
        industry: draft.industry || undefined,
        country: draft.country || undefined,
        companySize: draft.companySize || null,
        source: draft.source || undefined,
        notes: draft.notes || null,
        tags: tagsArray,
      },
    });
  };

  const set = (field: keyof EditDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((d) => d ? { ...d, [field]: e.target.value } : d);

  const API_BASE = "/api";

  const rescore = async () => {
    const isInitialScore = !bantBreakdown && lead?.bantScore == null;
    setRescoring(true);
    setRescoreError(null);
    try {
      const url = isInitialScore
        ? `${API_BASE}/qualify/${id}/ai`
        : `${API_BASE}/qualify/${id}/ai?force=true`;
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!res.ok) {
        if (res.status === 409) {
          const body = await res.json().catch(() => ({}));
          if (body?.error === "ALREADY_SCORED") {
            setRescoreError(ALREADY_SCORED_MSG);
            return;
          }
        }
        throw new Error("Scoring failed");
      }
      const data = await res.json();
      await qc.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
      await qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
      const newScore = data?.totalScore ?? data?.bantScore ?? null;
      const bandKey: string | undefined = data?.band;
      const bandLabel = bandKey === "hot" ? "Hot" : bandKey === "qualified" ? "Qualified" : bandKey === "nurture" ? "Nurture" : bandKey === "disqualify" ? "Disqualify" : undefined;
      const bandTextColor = bandKey === "hot" ? "text-red-600" : bandKey === "qualified" ? "text-green-700" : bandKey === "nurture" ? "text-amber-600" : bandKey === "disqualify" ? "text-slate-500" : "";
      toast({
        title: isInitialScore ? "Lead scored!" : "AI score updated",
        description: newScore !== null
          ? (
            <span>
              BANT score: {newScore} / 100
              {bandLabel && (
                <> — <span className={`font-semibold ${bandTextColor}`}>{bandLabel}</span></>
              )}
            </span>
          )
          : isInitialScore
            ? "Lead has been scored successfully."
            : "Lead has been re-scored successfully.",
      });
    } catch {
      setRescoreError(isInitialScore ? "Scoring failed. Please try again." : "Re-scoring failed. Please try again.");
    } finally {
      setRescoring(false);
    }
  };

  const refreshLead = async () => {
    setRescoreError(null);
    await qc.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
    await qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="h-4 rounded animate-pulse w-48 mb-2" />
        <div className="h-4 rounded animate-pulse w-96" />
      </div>
    );
  }

  if (!lead) {
    return <div className="p-6 text-muted-foreground text-sm">Lead not found</div>;
  }

  type BantBreakdown = {
    budget: number;
    authority: number;
    need: number;
    timeline: number;
    reasoning?: {
      budget?: string;
      authority?: string;
      need?: string;
      timeline?: string;
    };
  };
  const bantBreakdown = lead.bantBreakdown as BantBreakdown | null;

  const leadOptionsFromList = (leadsResp?.leads ?? []).map((l: { id: number; firstName: string; lastName: string; company?: string | null }) => ({
    id: l.id,
    firstName: l.firstName ?? "",
    lastName: l.lastName ?? "",
    company: l.company ?? "",
  }));

  const currentLeadOption = lead
    ? { id: lead.id, firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", company: lead.company ?? "" }
    : null;

  const leadOptions = leadOptionsFromList.length > 0
    ? leadOptionsFromList
    : currentLeadOption
      ? [currentLeadOption]
      : [];

  return (
    <div className="p-6 space-y-4">
      {showScheduleModal && leadOptions.length > 0 && (
        <NewMeetingModal
          leads={leadOptions}
          defaultLeadId={id}
          onClose={() => setShowScheduleModal(false)}
          onCreated={(meeting, shouldDownload) => {
            setShowScheduleModal(false);
            if (shouldDownload) downloadICS(meeting);
            qc.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
            qc.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
            qc.invalidateQueries({ queryKey: getListLeadsQueryKey() });
            toast({ title: "Meeting scheduled", description: `${meeting.type.replace(/_/g, " ")} meeting created successfully.` });
          }}
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/leads">
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-gray-900">
              <ArrowLeft className="w-3.5 h-3.5" /> Leads
            </button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-xs text-foreground font-medium">{lead.firstName} {lead.lastName}</span>
          {navList.length > 0 && currentIndex !== -1 && (
            <span className="text-[11px] text-muted-foreground">({currentIndex + 1} of {navList.length})</span>
          )}
        </div>
        {navList.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => prevId && navigate(`/leads/${prevId}`)}
              disabled={!prevId}
              className="flex items-center gap-1 px-2.5 py-1 rounded border border-gray-200 text-xs text-muted-foreground hover:text-gray-900 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <button
              onClick={() => nextId && navigate(`/leads/${nextId}`)}
              disabled={!nextId}
              className="flex items-center gap-1 px-2.5 py-1 rounded border border-gray-200 text-xs text-muted-foreground hover:text-gray-900 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          {/* Header */}
          <div className="rounded-xl border border-gray-200 p-5 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                {isEditing && draft ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className={LABEL_CLS}>First Name</div>
                        <input className={INPUT_CLS} value={draft.firstName} onChange={set("firstName")} />
                      </div>
                      <div className="flex-1">
                        <div className={LABEL_CLS}>Last Name</div>
                        <input className={INPUT_CLS} value={draft.lastName} onChange={set("lastName")} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className={LABEL_CLS}>Designation</div>
                        <input className={INPUT_CLS} value={draft.designation} onChange={set("designation")} />
                      </div>
                      <div className="flex-1">
                        <div className={LABEL_CLS}>Company</div>
                        <input className={INPUT_CLS} value={draft.company} onChange={set("company")} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    {/* Photo */}
                    <div className="flex-shrink-0">
                      {lead.photoUrl ? (
                        <img src={lead.photoUrl} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-gray-100" />
                      ) : (
                        <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white" style={{ background: "#1A3D2B" }}>
                          {lead.firstName?.[0] ?? ""}{lead.lastName?.[0] ?? ""}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold text-gray-900">{lead.firstName} {lead.lastName}</h1>
                        {/* Company logo */}
                        {lead.companyLogo && (
                          <img src={lead.companyLogo} alt={lead.company} className="h-6 object-contain" />
                        )}
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">{lead.designation} · {lead.company}</div>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <StatusBadge status={lead.status} />
                        {lead.bantScore != null && (() => {
                          const bandKey = lead.bantBand ?? scoreToBandKey(lead.bantScore);
                          return (
                            <span className={cn("text-xs font-bold", bandColorFromKey(bandKey))}>
                              BANT: {lead.bantScore} ({bandLabelFromKey(bandKey)})
                            </span>
                          );
                        })()}
                        {lead.keywords?.map((k) => <Tag key={k} label={k} />)}
                        {lead.tags?.map((t) => <Tag key={t} label={t} />)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {isEditing ? (
                  <>
                    <button
                      onClick={saveEditing}
                      disabled={updateLead.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
                      style={{ background: "#1A7A45" }}
                    >
                      <Check className="w-3.5 h-3.5" />
                      {updateLead.isPending ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={cancelEditing}
                      disabled={updateLead.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setShowScheduleModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white"
                      style={{ background: "#1A3D2B" }}
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      Schedule Meeting
                    </button>
                    <button
                      onClick={startEditing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <select
                      value={lead.status}
                      onChange={(e) => updateLead.mutate({ id, data: { status: e.target.value } })}
                      className="text-xs rounded border border-gray-200 bg-white text-gray-900 px-2 py-1 focus:outline-none"
                    >
                      {[["new_enquiry","New Enquiry"],["enquiry_qualified","Enquiry Qualified"],["discovery_call","Discovery Call"],["quote_sent","Quote / Estimation Sent"],["follow_up","Follow Up / Negotiation"],["project_won","Project Won"],["project_lost","Project Lost"]].map(([v,l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            </div>

            {saveError && (
              <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{saveError}</div>
            )}

            {isEditing && draft ? (
              <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className={LABEL_CLS}>Email</div>
                    <input className={INPUT_CLS} type="email" value={draft.email} onChange={set("email")} />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Phone</div>
                    <input className={INPUT_CLS} value={draft.phone} onChange={set("phone")} placeholder="—" />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Website</div>
                    <input className={INPUT_CLS} value={draft.website} onChange={set("website")} placeholder="—" />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>LinkedIn URL</div>
                    <input className={INPUT_CLS} value={draft.linkedInUrl} onChange={set("linkedInUrl")} placeholder="—" />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Industry</div>
                    <input className={INPUT_CLS} value={draft.industry} onChange={set("industry")} />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Country</div>
                    <input className={INPUT_CLS} value={draft.country} onChange={set("country")} />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Company Size</div>
                    <input className={INPUT_CLS} value={draft.companySize} onChange={set("companySize")} placeholder="—" />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Source</div>
                    <input className={INPUT_CLS} value={draft.source} onChange={set("source")} />
                  </div>
                  <div>
                    <div className={LABEL_CLS}>Tags (comma-separated)</div>
                    <input className={INPUT_CLS} value={draft.tags} onChange={set("tags")} placeholder="tag1, tag2" />
                  </div>
                </div>
                <div>
                  <div className={LABEL_CLS}>Notes</div>
                  <textarea
                    className={cn(INPUT_CLS, "resize-none h-20")}
                    value={draft.notes}
                    onChange={set("notes")}
                    placeholder="Add notes about this lead..."
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Contact details grid */}
                <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                    <a href={`mailto:${lead.email}`} className="hover:text-gray-900 truncate">{lead.email}</a>
                  </div>
                  {lead.phone && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                      <a href={`tel:${lead.phone}`} className="hover:text-gray-900">{lead.phone}</a>
                    </div>
                  )}
                  {lead.whatsapp && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#25D366" }} />
                      <a href={`https://wa.me/${lead.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="hover:text-gray-900">{lead.whatsapp}</a>
                    </div>
                  )}
                  {lead.linkedInUrl && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Linkedin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#0A66C2" }} />
                      <a href={lead.linkedInUrl} target="_blank" rel="noreferrer" className="hover:text-gray-900">LinkedIn Profile</a>
                    </div>
                  )}
                  {lead.website && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                      <a href={lead.website} target="_blank" rel="noreferrer" className="hover:text-gray-900 truncate">{lead.website}</a>
                    </div>
                  )}
                  {(lead.city || lead.country) && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{[lead.city, lead.country].filter(Boolean).join(", ")}</span>
                    </div>
                  )}
                  {lead.industry && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{lead.industry}{lead.companySize ? ` · ${lead.companySize}` : ""}</span>
                    </div>
                  )}
                </div>

                {lead.notes && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Notes</div>
                    <div className="text-xs text-gray-700">{lead.notes}</div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* BANT Breakdown */}
          {!bantBreakdown && (
            <div className="rounded-xl border border-dashed border-gray-300 p-5 bg-white shadow-sm flex flex-col items-center gap-3 text-center">
              <Sparkles className="w-6 h-6 text-teal-600" />
              <div>
                <div className="text-sm font-semibold text-foreground mb-1">No BANT score yet</div>
                <div className="text-xs text-muted-foreground">Run an AI analysis to instantly score this lead's Budget, Authority, Need, and Timeline.</div>
              </div>
              {rescoreError && (
                <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 w-full">
                  {rescoreError}
                  {rescoreError === ALREADY_SCORED_MSG && (
                    <button
                      onClick={refreshLead}
                      className="ml-1.5 underline font-medium hover:text-red-800 transition-colors"
                    >
                      Refresh
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={rescore}
                disabled={rescoring}
                className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-md border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {rescoring ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {rescoring ? "Scoring…" : "Score with AI"}
              </button>
            </div>
          )}
          {bantBreakdown && (
            <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wider">BANT Breakdown</div>
                <button
                  onClick={rescore}
                  disabled={rescoring}
                  className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {rescoring ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  {rescoring ? "Scoring…" : "Re-score with AI"}
                </button>
              </div>
              {rescoreError && (
                <div className="mb-3 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">
                  {rescoreError}
                  {rescoreError === ALREADY_SCORED_MSG && (
                    <button
                      onClick={refreshLead}
                      className="ml-1.5 underline font-medium hover:text-red-800 transition-colors"
                    >
                      Refresh
                    </button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-4 gap-3">
                {(["budget", "authority", "need", "timeline"] as const).map((dim) => {
                  const score = bantBreakdown[dim] ?? 0;
                  const reason = bantBreakdown.reasoning?.[dim];
                  return (
                    <div key={dim} className="text-center">
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{dim}</div>
                      <div className={cn("text-2xl font-bold", bandColorFromKey(scoreToBandKey(score * 4)))}>{score}</div>
                      <div className="w-full bg-gray-50 rounded-full h-1 mt-1.5">
                        <div className="h-1 rounded-full transition-all" style={{ width: `${score}%`, background: "#1A7A45" }} />
                      </div>
                      {reason && (
                        <div className="mt-2 text-[10px] text-muted-foreground leading-relaxed text-left">{reason}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {bantBreakdown.reasoning && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#1A7A45" }} />
                  <span className="text-[10px] text-muted-foreground italic">AI reasoning</span>
                </div>
              )}
            </div>
          )}

          {/* Touchpoints */}
          {lead.touchpoints?.length > 0 && (
            <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
              <div className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">Outreach History</div>
              <div className="space-y-2">
                {(lead.touchpoints ?? []).map((tp) => (
                  <div key={tp.id} className="flex items-start gap-3 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: tp.status === "sent" ? "#1A7A45" : "#94a3b8" }} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{tp.channel} · Day {tp.day}</span>
                        <StatusBadge status={tp.status} />
                      </div>
                      {tp.subject && <div className="text-muted-foreground mt-0.5">Subject: {tp.subject}</div>}
                      <div className="text-gray-400 text-[10px]">{formatRelative(tp.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CRM Meetings */}
          <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold text-foreground uppercase tracking-wider">CRM Meetings</div>
              <button
                onClick={() => setShowScheduleModal(true)}
                className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded text-white"
                style={{ background: "#1A3D2B" }}
              >
                <CalendarPlus className="w-3 h-3" /> Schedule
              </button>
            </div>
            {leadMeetings.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <CalendarDays className="w-6 h-6 text-gray-200" />
                <div className="text-xs text-gray-400">No meetings scheduled yet</div>
              </div>
            ) : (
              <div className="space-y-2">
                {leadMeetings.map((m) => {
                  const d = new Date(m.scheduledAt);
                  const dateLabel = d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <CalendarDays className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-gray-800 capitalize">{m.type.replace(/_/g, " ")}</div>
                          <div className="text-gray-400 text-[10px]">{dateLabel} · {m.duration} min</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{m.status}</span>
                        <button
                          onClick={() => downloadICS(m)}
                          title="Download .ics"
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Lead Info</div>
            <div className="space-y-2 text-xs">
              {[
                ["Source",        (lead.source ?? "").replace(/_/g, " ")],
                ["Industry",      lead.industry],
                ["City",          lead.city ?? "—"],
                ["Country",       lead.country],
                ["Company Size",  lead.companySize ?? "—"],
                ["Annual Revenue",lead.annualRevenue ?? "—"],
                ["Sequence Day",  lead.sequenceDay > 0 ? `Day ${lead.sequenceDay}` : "Not assigned"],
                ["Added",         formatDate(lead.createdAt)],
                ["Last Contact",  lead.lastContactedAt ? formatDate(lead.lastContactedAt) : "Never"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2">
                  <span className="text-gray-400 flex-shrink-0">{label}</span>
                  <span className="text-gray-800 text-right capitalize">{value}</span>
                </div>
              ))}
            </div>
            {(lead.keywords?.length > 0 || lead.tags?.length > 0) && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Keywords</div>
                <div className="flex flex-wrap gap-1">
                  {lead.keywords?.map((k) => <Tag key={k} label={k} />)}
                  {lead.tags?.map((t) => <Tag key={t} label={t} />)}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</div>
            <div className="space-y-2">
              <Link href={`/audit?leadId=${lead.id}`}>
                <button className="w-full text-xs py-1.5 px-3 rounded border border-gray-200 text-muted-foreground hover:text-gray-900 hover:bg-gray-50 text-left">Run Brand Audit</button>
              </Link>
              <Link href={`/qualify?leadId=${lead.id}`}>
                <button className="w-full text-xs py-1.5 px-3 rounded border border-gray-200 text-muted-foreground hover:text-gray-900 hover:bg-gray-50 text-left">BANT Score</button>
              </Link>
              <Link href="/outreach">
                <button className="w-full text-xs py-1.5 px-3 rounded border border-gray-200 text-muted-foreground hover:text-gray-900 hover:bg-gray-50 text-left">Generate Outreach</button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
