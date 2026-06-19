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
  Users, Circle, Phone, Mail, Calendar, FileText, Trophy, XCircle, ArrowRight, Briefcase
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn, scoreToBandKey, bandHexFromKey } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STAGES = [
  { id: "new_enquiry",        label: "New Enquiry",              color: "#3B82F6", bg: "#EFF6FF", icon: Circle },
  { id: "enquiry_qualified",  label: "Enquiry Qualified",        color: "#8B5CF6", bg: "#F5F3FF", icon: Users },
  { id: "discovery_call",     label: "Discovery Call",           color: "#0D9488", bg: "#F0FDFA", icon: Phone },
  { id: "quote_sent",         label: "Quote / Estimation Sent",  color: "#F59E0B", bg: "#FFFBEB", icon: FileText },
  { id: "follow_up",          label: "Follow Up / Negotiation",  color: "#F97316", bg: "#FFF7ED", icon: Mail },
  { id: "project_won",        label: "Project Won",              color: "#16A34A", bg: "#F0FDF4", icon: Trophy },
  { id: "project_lost",       label: "Project Lost",             color: "#EF4444", bg: "#FEF2F2", icon: XCircle },
] as const;

type StageId = typeof STAGES[number]["id"];

interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  designation: string;
  status: string;
  bantScore?: number | null;
  lastContactedAt?: string | null;
  createdAt: string;
}

async function fetchLeads(): Promise<Lead[]> {
  const res = await fetch(`/api/leads?limit=500`);
  const j = await res.json();
  return j.leads ?? [];
}

async function patchLeadStatus(id: number, status: string) {
  const res = await fetch(`/api/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return res.json();
}

function LeadCard({ lead, isDragging }: { lead: Lead; isDragging?: boolean }) {
  const [, navigate] = useLocation();
  const initials = `${lead.firstName?.[0] ?? ""}${lead.lastName?.[0] ?? ""}`.toUpperCase();
  const score = lead.bantScore ?? 0;
  const band = scoreToBandKey(score);
  const scoreColor = band == null ? "#6B7280" : bandHexFromKey(band);

  return (
    <div
      className={cn(
        "bg-white rounded-xl border p-3 cursor-grab select-none transition-shadow",
        isDragging ? "shadow-2xl opacity-80 rotate-1" : "shadow-sm hover:shadow-md"
      )}
      style={{ borderColor: "hsl(220 13% 91%)" }}
      onClick={() => navigate(`/leads/${lead.id}`)}
    >
      <div className="flex items-start gap-2.5 mb-2">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
          style={{ background: "#1A3D2B" }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold leading-tight truncate" style={{ color: "#111827" }}>
            {lead.firstName} {lead.lastName}
          </div>
          <div className="text-[11px] truncate" style={{ color: "#6B7280" }}>{lead.designation}</div>
        </div>
        {lead.bantScore != null && (
          <div className="text-[11px] font-bold flex-shrink-0" style={{ color: scoreColor }}>
            {lead.bantScore}%
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Briefcase className="w-3 h-3 flex-shrink-0" style={{ color: "#9CA3AF" }} />
        <span className="text-[11px] truncate" style={{ color: "#6B7280" }}>{lead.company}</span>
      </div>
      {lead.lastContactedAt && (
        <div className="text-[10px] mt-1" style={{ color: "#9CA3AF" }}>
          Last contact {formatDistanceToNow(new Date(lead.lastContactedAt), { addSuffix: true })}
        </div>
      )}
    </div>
  );
}

function SortableCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { lead },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <LeadCard lead={lead} isDragging={isDragging} />
    </div>
  );
}

function Column({
  stage,
  leads,
}: {
  stage: typeof STAGES[number];
  leads: Lead[];
}) {
  const Icon = stage.icon;
  return (
    <div className="flex flex-col w-64 flex-shrink-0 h-full">
      <div
        className="flex items-center gap-2 px-3 py-2.5 rounded-t-xl"
        style={{ background: stage.bg, borderBottom: `2px solid ${stage.color}` }}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: stage.color }} />
        <span className="text-[12px] font-semibold flex-1 truncate" style={{ color: stage.color }}>
          {stage.label}
        </span>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: stage.color + "22", color: stage.color }}
        >
          {leads.length}
        </span>
      </div>
      <div
        className="flex-1 overflow-y-auto p-2 rounded-b-xl flex flex-col gap-2"
        style={{ background: stage.bg + "88", minHeight: 400 }}
      >
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map(lead => (
            <SortableCard key={lead.id} lead={lead} />
          ))}
        </SortableContext>
        {leads.length === 0 && (
          <div
            className="text-center py-8 text-[12px] border-2 border-dashed rounded-xl"
            style={{ color: "#D1D5DB", borderColor: "#E5E7EB" }}
          >
            Drop leads here
          </div>
        )}
      </div>
    </div>
  );
}

export default function Pipeline() {
  const qc = useQueryClient();
  const { data: allLeads = [], isLoading } = useQuery({ queryKey: ["leads-pipeline"], queryFn: fetchLeads });
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  const mutate = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => patchLeadStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads-pipeline"] }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const grouped = useCallback(() => {
    const map = new Map<string, Lead[]>();
    for (const s of STAGES) map.set(s.id, []);
    for (const lead of allLeads) {
      const key = (lead.status ?? "new_enquiry") as StageId;
      if (!map.has(key)) map.set("new_enquiry", []);
      (map.get(key) ?? map.get("new_enquiry")!).push(lead);
    }
    return map;
  }, [allLeads]);

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

    const overId = over.id;
    const targetStage = STAGES.find(s => s.id === overId)
      ?? STAGES.find(s => allLeads.find(l => l.id === overId && l.status === s.id));

    const targetStatus = targetStage?.id ?? allLeads.find(l => l.id === overId)?.status;
    if (!targetStatus || targetStatus === lead.status) return;
    mutate.mutate({ id: lead.id, status: targetStatus });
  }

  const g = grouped();
  const totalValue = allLeads.filter(l => l.status === "project_won").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[#1A3D2B] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats bar */}
      <div className="flex items-center gap-3 md:gap-6 px-3 md:px-6 py-2.5 border-b flex-shrink-0 overflow-x-auto" style={{ borderColor: "hsl(220 13% 91%)", background: "#fff" }}>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Users className="w-3.5 h-3.5" style={{ color: "#6B7280" }} />
          <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: "#374151" }}>
            {allLeads.length} leads · {STAGES.length} stages
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Trophy className="w-3.5 h-3.5" style={{ color: "#16a34a" }} />
          <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: "#374151" }}>
            {totalValue} closed won
          </span>
        </div>
        <div className="hidden md:flex items-center gap-1 text-[12px]" style={{ color: "#9CA3AF" }}>
          <ArrowRight className="w-3 h-3" />
          Drag cards between columns to update status
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 h-full items-start">
            {STAGES.map(stage => (
              <Column key={stage.id} stage={stage} leads={g.get(stage.id) ?? []} />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? <LeadCard lead={activeLead} isDragging /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
