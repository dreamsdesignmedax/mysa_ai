import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  closestCorners,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Search, ChevronDown, Phone, Mail, Calendar,
  Pencil, GripVertical, ChevronLeft, Trophy, MoreHorizontal,
  Download, SlidersHorizontal, ArrowUpDown, X, Loader2, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = [
  { id: "new_enquiry",       label: "New Enquiry",              weight: 10  },
  { id: "enquiry_qualified", label: "Enquiry Qualified",        weight: 20  },
  { id: "discovery_call",    label: "Discovery Call",           weight: 40  },
  { id: "quote_sent",        label: "Quote / Estimation Sent",  weight: 60  },
  { id: "follow_up",         label: "Follow Up / Negotiation",  weight: 80  },
  { id: "project_won",       label: "Project Won",              weight: 100 },
  { id: "project_lost",      label: "Project Lost",             weight: 0   },
] as const;

type StageId = typeof STAGES[number]["id"];

const AVATAR_COLORS = [
  "#7C3AED","#DB2777","#D97706","#0891B2",
  "#16A34A","#DC2626","#0D9488","#9333EA",
];

interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  company: string;
  designation?: string | null;
  status: string;
  bantScore?: number | null;
  lastContactedAt?: string | null;
  createdAt: string;
}

type LeadAny = Lead & Record<string, unknown>;

function fmtAmount(n: number): string {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

async function fetchLeads(): Promise<Lead[]> {
  const res = await fetch("/api/leads?limit=500", { credentials: "include" });
  if (!res.ok) return [];
  const j = await res.json();
  return j.leads ?? [];
}

async function patchLeadStatus(id: number, status: string) {
  const res = await fetch(`/api/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  return res.json();
}

function DealCard({ lead, isDragging }: { lead: Lead; isDragging?: boolean }) {
  const [, navigate] = useLocation();
  const l = lead as LeadAny;
  const initials = `${lead.firstName?.[0] ?? ""}${lead.lastName?.[0] ?? ""}`.toUpperCase();
  const avatarBg = AVATAR_COLORS[lead.id % AVATAR_COLORS.length];
  const dealAmount = (l.dealValue as number | null) ?? (l.annualRevenue as number | null);
  const closeDate = (l.closeDate as string | null) ?? lead.lastContactedAt;
  const ownerName = (l.assignedToName as string | null) ?? "Dreamsdesign Sales";
  const waNum = ((l.whatsapp as string | null) ?? lead.phone ?? "").replace(/[^0-9]/g, "");

  return (
    <div
      className={cn(
        "bg-white rounded border border-gray-200 p-3 select-none transition-all group",
        isDragging
          ? "shadow-2xl opacity-80 rotate-1 border-violet-300"
          : "shadow-none hover:shadow-md hover:border-violet-200 cursor-pointer"
      )}
      onClick={() => navigate(`/leads/${lead.id}`)}
    >
      {/* Title row */}
      <div className="flex items-start gap-2 mb-2">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5"
          style={{ background: avatarBg }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-violet-700 leading-snug line-clamp-2">
            {lead.firstName} {lead.lastName}
            {lead.company && (
              <span className="text-gray-500 font-normal"> — {lead.company}</span>
            )}
          </div>
        </div>
        <GripVertical className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
      </div>

      {/* Amount */}
      {dealAmount != null && (
        <div className="text-[11px] text-gray-500 mb-1">
          Amount: <span className="font-semibold text-gray-700">{fmtAmount(Number(dealAmount))}</span>
        </div>
      )}

      {/* Dates + owner */}
      {closeDate && (
        <div className="text-[11px] text-gray-500">
          Close date: <span className="text-gray-600">{fmtDate(closeDate)}</span>
        </div>
      )}
      <div className="text-[11px] text-gray-500">
        Deal owner: <span className="text-gray-600">{ownerName}</span>
      </div>
      <div className="text-[11px] text-gray-500">
        Create date: <span className="text-gray-600">{fmtDate(lead.createdAt)}</span>
      </div>

      {/* Assignee + company link */}
      <div className="mt-2 flex items-center gap-1">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
          style={{ background: avatarBg }}
          title={ownerName}
        >
          {ownerName.slice(0, 2).toUpperCase()}
        </div>
        <span className="text-[10px] text-gray-400 truncate ml-0.5">
          {lead.firstName} {lead.lastName}
          {lead.company && ` → ${lead.company}`}
        </span>
      </div>

      {/* Action icons row — shown on hover */}
      <div
        className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <a
          href={`tel:${lead.phone}`}
          className="p-1.5 rounded hover:bg-violet-50 hover:text-violet-600 text-gray-400 transition-colors"
          title="Call"
          onClick={(e) => e.stopPropagation()}
        >
          <Phone className="w-3 h-3" />
        </a>
        <button className="p-1.5 rounded hover:bg-violet-50 hover:text-violet-600 text-gray-400 transition-colors" title="Add">
          <Plus className="w-3 h-3" />
        </button>
        <a
          href={`mailto:${lead.email}`}
          className="p-1.5 rounded hover:bg-violet-50 hover:text-violet-600 text-gray-400 transition-colors"
          title="Email"
          onClick={(e) => e.stopPropagation()}
        >
          <Mail className="w-3 h-3" />
        </a>
        {waNum && (
          <a
            href={`https://wa.me/${waNum}`}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded hover:bg-green-50 hover:text-green-600 text-gray-400 transition-colors"
            title="WhatsApp"
            onClick={(e) => e.stopPropagation()}
          >
            <Calendar className="w-3 h-3" />
          </a>
        )}
        <button
          className="p-1.5 rounded hover:bg-violet-50 hover:text-violet-600 text-gray-400 transition-colors ml-auto"
          title="Edit"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function SortableCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { lead },
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}>
      <DealCard lead={lead} isDragging={isDragging} />
    </div>
  );
}

function Column({
  stage,
  leads,
  collapsed,
  onToggleCollapse,
}: {
  stage: typeof STAGES[number];
  leads: Lead[];
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const totalAmount = leads.reduce((sum, l) => {
    const la = l as LeadAny;
    return sum + (Number(la.dealValue ?? la.annualRevenue ?? 0));
  }, 0);
  const weighted = Math.round(totalAmount * stage.weight / 100);

  if (collapsed) {
    return (
      <div
        className="flex-shrink-0 w-10 bg-gray-50 border border-gray-200 rounded flex flex-col items-center py-3 cursor-pointer hover:bg-violet-50 transition-colors"
        onClick={onToggleCollapse}
        title={stage.label}
      >
        <span className="text-[10px] font-bold text-gray-400 uppercase" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", letterSpacing: "0.08em" }}>
          {stage.label}
        </span>
        <span className="mt-2 text-[10px] font-semibold text-gray-500 bg-gray-200 rounded-full w-5 h-5 flex items-center justify-center">
          {leads.length}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[270px] flex-shrink-0 bg-gray-50 border border-gray-200 rounded">
      {/* Column header */}
      <div className="flex items-center px-3 py-2.5 border-b border-gray-200 gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 flex-1 truncate">
          {stage.label}
        </span>
        <span className="text-[11px] font-semibold text-gray-500 flex-shrink-0">{leads.length}</span>
        <button
          onClick={onToggleCollapse}
          className="p-0.5 hover:bg-gray-200 rounded flex-shrink-0 transition-colors"
          title="Collapse"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-gray-400" />
        </button>
        <button className="p-0.5 hover:bg-gray-200 rounded flex-shrink-0 transition-colors cursor-grab">
          <GripVertical className="w-3.5 h-3.5 text-gray-400" />
        </button>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2" style={{ maxHeight: "calc(100vh - 290px)", minHeight: "120px" }}>
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map(lead => (
            <SortableCard key={lead.id} lead={lead} />
          ))}
        </SortableContext>
        {leads.length === 0 && (
          <div className="text-center py-6 text-[11px] text-gray-300 border border-dashed border-gray-200 rounded">
            No deals
          </div>
        )}
        <button className="w-full py-1.5 text-[11px] text-gray-400 hover:text-violet-600 flex items-center justify-center gap-1 hover:bg-white rounded border border-dashed border-gray-200 hover:border-violet-200 transition-all mt-0.5">
          <Plus className="w-3 h-3" /> Add deal
        </button>
      </div>

      {/* Column footer */}
      <div className="px-3 py-2.5 border-t border-gray-200 text-[11px] text-gray-500 space-y-0.5 bg-white rounded-b">
        <div className="flex items-center gap-1">
          <span className="font-semibold text-gray-700">{totalAmount > 0 ? fmtAmount(totalAmount) : "—"}</span>
          <span className="text-gray-400">| Total amount</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-semibold text-gray-700">{weighted > 0 ? fmtAmount(weighted) : "—"}</span>
          <span className="text-gray-400">({stage.weight}%) | Weighted amount</span>
        </div>
      </div>
    </div>
  );
}

export default function Pipeline() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: allLeads = [], isLoading } = useQuery({ queryKey: ["leads-pipeline"], queryFn: fetchLeads });
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const mutate = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => patchLeadStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads-pipeline"] }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const filteredLeads = search.trim()
    ? allLeads.filter(l =>
        `${l.firstName} ${l.lastName} ${l.company} ${l.email}`.toLowerCase().includes(search.toLowerCase())
      )
    : allLeads;

  const grouped = useCallback(() => {
    const map = new Map<string, Lead[]>();
    for (const s of STAGES) map.set(s.id, []);
    for (const lead of filteredLeads) {
      const key = (lead.status ?? "new_enquiry") as StageId;
      if (map.has(key)) map.get(key)!.push(lead);
      else map.get("new_enquiry")!.push(lead);
    }
    return map;
  }, [filteredLeads]);

  function handleDragStart(ev: DragStartEvent) {
    const lead = allLeads.find(l => l.id === ev.active.id);
    if (lead) setActiveLead(lead);
  }

  function handleDragEnd(ev: DragEndEvent) {
    setActiveLead(null);
    const { active, over } = ev;
    if (!over) return;
    const lead = allLeads.find(l => l.id === active.id);
    if (!lead) return;
    const targetStage =
      STAGES.find(s => s.id === over.id) ??
      STAGES.find(s => allLeads.find(l => l.id === over.id && l.status === s.id));
    const targetStatus = targetStage?.id ?? allLeads.find(l => l.id === over.id)?.status;
    if (!targetStatus || targetStatus === lead.status) return;
    mutate.mutate({ id: lead.id, status: targetStatus });
  }

  const g = grouped();
  const wonCount = allLeads.filter(l => l.status === "project_won").length;

  const toggleCollapse = (stageId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  };

  return (
    <div className="flex flex-col bg-white" style={{ height: "calc(100vh - 56px)" }}>

      {/* ── Top bar ───────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-white">
        {/* Title + actions */}
        <div className="px-5 pt-3 pb-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-800 hover:text-violet-700 transition-colors">
              <Trophy className="w-4 h-4 text-violet-500" />
              Deals
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-md text-white bg-orange-500 hover:bg-orange-600 transition-colors shadow-sm"
              onClick={() => navigate("/leads")}
            >
              <Plus className="w-3.5 h-3.5" /> Add deal
            </button>
          </div>
        </div>

        {/* Underline tab */}
        <div className="px-5 pt-2 flex items-center gap-1">
          <button className="flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-[12px] font-medium border-b-2 border-violet-600 text-violet-700 whitespace-nowrap">
            <Layers className="w-3.5 h-3.5" />
            All deals
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700">
              {allLeads.length.toLocaleString()}
            </span>
          </button>
          {wonCount > 0 && (
            <button className="flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-[12px] font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap transition-colors">
              <Trophy className="w-3.5 h-3.5" />
              Won
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500">{wonCount}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Search + view controls ─────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-white">
        <div className="px-5 py-2.5 flex items-center gap-2">
          {/* Search */}
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search deals…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-7 py-1.5 text-[12px] rounded-md border border-gray-300 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition-all"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Right controls */}
          <div className="ml-auto flex items-center gap-1.5">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">
              Board view <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap">
              DD Sales Pipeline <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-5 bg-gray-200" />
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
              <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
              <ArrowUpDown className="w-3.5 h-3.5" /> Sort
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>
        </div>

        {/* Filter attribute row */}
        <div className="px-5 py-2 flex items-center gap-2 border-t border-gray-100">
          {["Deal owner", "Create date", "Last activity date", "Close date"].map(label => (
            <button key={label} className="flex items-center gap-1 text-[12px] text-gray-600 hover:text-violet-700 border border-gray-200 hover:border-violet-300 rounded px-2.5 py-1 bg-white transition-colors whitespace-nowrap">
              {label} <ChevronDown className="w-3 h-3" />
            </button>
          ))}
          <button className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded border border-gray-200 transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded border border-gray-200 transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-violet-700 border border-gray-200 hover:border-violet-300 rounded px-2.5 py-1 bg-white transition-colors ml-1">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Advanced filters
          </button>
        </div>
      </div>

      {/* ── Board ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-3 px-5 py-4 h-full items-start min-w-max">
              {STAGES.map(stage => (
                <Column
                  key={stage.id}
                  stage={stage}
                  leads={g.get(stage.id) ?? []}
                  collapsed={collapsed.has(stage.id)}
                  onToggleCollapse={() => toggleCollapse(stage.id)}
                />
              ))}
            </div>
            <DragOverlay>
              {activeLead ? <DealCard lead={activeLead} isDragging /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </div>
  );
}
