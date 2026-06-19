import { useState, useRef, useEffect } from "react";
import { useListLeads } from "@workspace/api-client-react";
import { getListLeadsQueryKey } from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";
import { MessageSquare, Send, Sparkles, User, Bot, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  leadId?: number;
}

const TEMPLATES = [
  { label: "Cold Email — First Touch", prompt: "Write a compelling cold email for the selected lead, introducing Dreamsdesign's branding services. Keep it under 150 words, personal, and end with a clear CTA to book a 15-min call." },
  { label: "LinkedIn Message", prompt: "Write a LinkedIn connection message for the selected lead. Max 300 characters, professional yet friendly, referencing their industry." },
  { label: "Pain-Based Follow-Up", prompt: "Write a follow-up email for a lead we haven't heard from in 5 days. Focus on brand pain points common in their industry and position Dreamsdesign as the solution." },
  { label: "Proposal Cover Email", prompt: "Write a proposal cover email for the selected lead. Professional, confident, mention the key service and investment, and invite them to a proposal review call." },
  { label: "Objection Handler", prompt: "The lead said they 'already have an in-house designer'. Write a response that acknowledges this and repositions Dreamsdesign as a strategic partner, not a replacement." },
  { label: "Meeting Reminder", prompt: "Write a brief meeting reminder email for 24 hours before our scheduled call. Include preparation tips and express enthusiasm." },
];

export default function AiComposer() {
  const { data: leadsPage } = useListLeads({}, { query: { queryKey: getListLeadsQueryKey() } });
  const leads: Lead[] = leadsPage?.leads ?? [];

  const [conversations, setConversations] = useState<Conversation[]>([
    { id: "1", title: "New Conversation", messages: [] }
  ]);
  const [activeId, setActiveId] = useState("1");
  const [input, setInput] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeConversation = conversations.find((c) => c.id === activeId)!;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId);

  const buildSystemPrompt = () => {
    let sys = `You are the Dreamsdesign AI sales assistant. Dreamsdesign is a premium B2B branding and design studio based in Dubai.
Brand voice: Professional, confident, creative, results-focused. Always position design as business ROI.
Services: Brand Identity, Logo Design, Website Design & Development, Social Media Branding, Marketing Collateral, UI/UX Design.
Typical project value: $5,000–$50,000 USD.`;
    if (selectedLead) {
      sys += `\n\nContext about the current lead:
Name: ${selectedLead.firstName} ${selectedLead.lastName}
Company: ${selectedLead.company}
Job Title: ${selectedLead.designation}
Industry: ${selectedLead.industry}
Country: ${selectedLead.country}
BANT Score: ${selectedLead.bantScore ?? "unscored"}
Status: ${selectedLead.status}`;
    }
    return sys;
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || streaming) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content };
    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

    const updatedMessages = [...activeConversation.messages, userMsg, assistantMsg];
    setConversations((prev) => prev.map((c) => c.id === activeId ? { ...c, messages: updatedMessages, title: c.messages.length === 0 ? content.slice(0, 40) + "..." : c.title } : c));
    setInput("");
    setStreaming(true);

    abortRef.current = new AbortController();

    try {
      const apiMessages = [...activeConversation.messages, userMsg].map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch(`/api/anthropic/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          system: buildSystemPrompt(),
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error("Stream request failed");

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulated += parsed.text;
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === activeId
                      ? { ...c, messages: c.messages.map((m) => m.id === assistantId ? { ...m, content: accumulated } : m) }
                      : c
                  )
                );
              }
            } catch {}
          }
        }
      }

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, messages: c.messages.map((m) => m.id === assistantId ? { ...m, streaming: false } : m) }
            : c
        )
      );
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId
              ? { ...c, messages: c.messages.map((m) => m.id === assistantId ? { ...m, content: "Error: Failed to get AI response. Please try again.", streaming: false } : m) }
              : c
          )
        );
      }
    } finally {
      setStreaming(false);
    }
  };

  const newConversation = () => {
    const id = Date.now().toString();
    setConversations((prev) => [...prev, { id, title: "New Conversation", messages: [] }]);
    setActiveId(id);
  };

  return (
    <div className="flex h-[calc(100vh-1px)] overflow-hidden">
      {/* Conversation List */}
      <div className="w-48 flex-shrink-0 border-r border-gray-200 flex flex-col">
        <div className="p-3 border-b border-gray-200 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Chats</span>
          <button onClick={newConversation} className="p-1 hover:text-gray-900 text-muted-foreground">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={cn("w-full text-left px-3 py-2 text-[11px] transition-colors truncate flex items-center justify-between group", activeId === c.id ? "text-teal-700 bg-teal-50" : "text-muted-foreground hover:text-gray-900 hover:bg-gray-50")}
            >
              <span className="truncate">{c.title}</span>
              {conversations.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConversations((prev) => prev.filter((x) => x.id !== c.id));
                    if (activeId === c.id) setActiveId(conversations[0].id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-600 ml-1 flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Panel */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-xs text-muted-foreground">Claude Sonnet</span>
          </div>
          <div className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            <select
              value={selectedLeadId ?? ""}
              onChange={(e) => setSelectedLeadId(e.target.value ? Number(e.target.value) : null)}
              className="text-xs rounded border border-gray-200 bg-white text-gray-900 px-2 py-0.5 focus:outline-none"
            >
              <option value="">No lead context</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.firstName} {l.lastName} — {l.company}</option>)}
            </select>
          </div>
          {streaming && (
            <button onClick={() => abortRef.current?.abort()} className="text-xs text-red-600 hover:text-red-600 border border-red-500/30 px-2 py-0.5 rounded">
              Stop
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeConversation.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <MessageSquare className="w-10 h-10 text-muted-foreground mb-4 opacity-40" />
              <div className="text-sm text-muted-foreground mb-6">Ask anything or use a quick template</div>
              <div className="grid grid-cols-2 gap-2 max-w-xl w-full">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => sendMessage(t.prompt)}
                    className="text-left p-3 rounded border border-gray-200 hover:border-teal-500/40 hover:bg-teal-50 transition-colors"
                  >
                    <div className="text-xs font-medium text-foreground">{t.label}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            activeConversation.messages.map((msg) => (
              <div key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "")}>
                <div className={cn("w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5", msg.role === "user" ? "bg-amber-100" : "bg-teal-100")}>
                  {msg.role === "user" ? <User className="w-3.5 h-3.5 text-amber-600" /> : <Bot className="w-3.5 h-3.5 text-teal-600" />}
                </div>
                <div className={cn("max-w-[75%] rounded-lg px-3 py-2.5 text-xs leading-relaxed", msg.role === "user" ? "text-foreground border border-gray-200" : "text-gray-800")} style={msg.role === "user" ? { background: "#F9FAFB" } : { background: "#F0FDF4", border: "1px solid #D1FAE5" }}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.streaming && <span className="inline-block w-1.5 h-4 bg-teal-400 rounded ml-0.5 animate-pulse" />}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              rows={2}
              placeholder="Write a cold email for this lead... (Enter to send, Shift+Enter for newline)"
              className="flex-1 text-xs rounded border border-gray-200 bg-white text-gray-900 placeholder-gray-400/50 px-3 py-2 focus:outline-none resize-none"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={streaming || !input.trim()}
              className="px-4 rounded text-white font-medium disabled:opacity-30 transition-all flex-shrink-0"
              style={{ background: "#1A7A45" }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="text-[10px] text-gray-400 mt-1.5">AI may make mistakes. Always review before sending.</div>
        </div>
      </div>
    </div>
  );
}
