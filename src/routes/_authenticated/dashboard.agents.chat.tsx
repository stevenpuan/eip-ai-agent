import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Send, MessageSquare, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/agents/chat")({
  head: () => ({ meta: [{ title: "AI 對話 - EIP agent" }] }),
  component: ChatPage,
});

type Agent = { id: string; name: string; is_active: boolean };
type Conversation = {
  id: string;
  title: string;
  agent_id: string;
  created_at: string;
};
type Message = { id: string; role: "user" | "assistant"; content: string };

function ChatPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConvo = conversations.find((c) => c.id === activeId) ?? null;

  // initial load
  useEffect(() => {
    (async () => {
      const [{ data: ag }, { data: cv }] = await Promise.all([
        supabase
          .from("agent")
          .select("id, name, is_active")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("conversation")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);
      setAgents((ag ?? []) as Agent[]);
      setConversations((cv ?? []) as Conversation[]);
      if (ag && ag.length > 0) setSelectedAgentId(ag[0].id);
    })();
  }, []);

  // load messages when active changes
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    supabase
      .from("message")
      .select("id, role, content")
      .eq("conversation_id", activeId)
      .order("created_at", { ascending: true })
      .then(({ data }) => setMessages((data ?? []) as Message[]));
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    const agentId = activeConvo?.agent_id ?? selectedAgentId;
    if (!agentId) {
      toast.error("請先選擇代理人");
      return;
    }
    setSending(true);
    setInput("");
    // Optimistic user bubble
    const optimistic: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((m) => [...m, optimistic]);

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          agent_id: agentId,
          conversation_id: activeId,
          user_message: text,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "對話失敗");

      const newConvoId: string = json.conversation_id;
      const reply: string = json.reply;

      // If this was a new conversation, refresh list & switch
      if (!activeId) {
        const { data: cv } = await supabase
          .from("conversation")
          .select("*")
          .order("created_at", { ascending: false });
        setConversations((cv ?? []) as Conversation[]);
        setActiveId(newConvoId);
      }

      // Reload messages (canonical from DB)
      const { data: msgs } = await supabase
        .from("message")
        .select("id, role, content")
        .eq("conversation_id", newConvoId)
        .order("created_at", { ascending: true });
      setMessages((msgs ?? []) as Message[]);

      void reply;
    } catch (err) {
      toast.error((err as Error).message);
      // remove optimistic on failure
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="h-screen flex">
      {/* Conversation list */}
      <div className="w-72 border-r bg-card flex flex-col">
        <div className="p-3 border-b">
          <div className="mb-2">
            <Select
              value={selectedAgentId}
              onValueChange={setSelectedAgentId}
              disabled={!!activeId}
            >
              <SelectTrigger>
                <SelectValue placeholder="選擇代理人" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="w-full" onClick={newChat}>
            <Plus className="h-4 w-4 mr-2" />新對話
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-6">
              尚無對話
            </div>
          ) : (
            conversations.map((c) => {
              const agent = agents.find((a) => a.id === c.agent_id);
              const active = c.id === activeId;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{c.title}</span>
                  </div>
                  <div
                    className={`text-xs mt-0.5 truncate ${
                      active ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {agent?.name ?? "未知代理人"}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Chat window */}
      <div className="flex-1 flex flex-col">
        <div className="h-14 border-b flex items-center px-4 bg-card">
          <div className="text-sm font-medium">
            {activeConvo
              ? agents.find((a) => a.id === activeConvo.agent_id)?.name ??
                "對話"
              : selectedAgentId
                ? `新對話 · ${agents.find((a) => a.id === selectedAgentId)?.name}`
                : "請選擇或建立對話"}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && !sending ? (
            <div className="text-center text-muted-foreground text-sm mt-20">
              開始輸入訊息與 AI 代理人對話
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-4 py-2 whitespace-pre-wrap text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2 text-sm flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                思考中…
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4 bg-card">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="輸入訊息… (Enter 送出,Shift+Enter 換行)"
              rows={2}
              className="resize-none"
              disabled={sending}
            />
            <Button onClick={send} disabled={sending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
