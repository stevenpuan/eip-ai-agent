// supabase/functions/agent-chat/index.ts
// AI Agent chat endpoint with Anthropic tool use.
// Tools query a second Supabase project (EIP) read-only via service role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ChatPayload {
  conversation_id?: string;
  agent_id: string;
  user_message: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- Tool definitions for Anthropic ----------
const tools = [
  {
    name: "list_tasks",
    description:
      "查詢 EIP 內部管理平台的任務清單,可依狀態名稱、負責人 email、或僅顯示逾期任務過濾。回傳每筆任務的標題、狀態、負責人、所屬專案、進度、期限、優先級。當使用者詢問任務、待辦、逾期、誰負責什麼,使用此工具。",
    input_schema: {
      type: "object",
      properties: {
        status_name: { type: "string", description: "狀態名稱,例如「待辦」、「進行中」、「完成」" },
        owner_email: { type: "string", description: "負責人 email" },
        overdue_only: { type: "boolean", description: "僅顯示逾期(due_date < 今日 且狀態非完成)" },
        limit: { type: "number", description: "最多回傳筆數,預設 50" },
      },
    },
  },
  {
    name: "list_announcements",
    description:
      "查詢 EIP 已發布的公告(published_at 不為 null),置頂優先、再依發布時間新到舊。回傳標題、內文摘要、是否置頂、發布時間。",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "最多回傳筆數,預設 10" },
      },
    },
  },
  {
    name: "list_projects",
    description:
      "查詢 EIP 所有專案的名稱、狀態、目標、起訖日,並附上各專案的任務總數與已完成任務數。",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "eip_summary",
    description:
      "回傳 EIP 整體統計:任務總數、各狀態任務數、逾期任務數、已發布公告數、專案數。當使用者問「目前狀況」「整體概況」時使用。",
    input_schema: { type: "object", properties: {} },
  },
];

// ---------- Tool implementations (read-only against EIP) ----------
async function runTool(
  eip: ReturnType<typeof createClient>,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);

  if (name === "list_tasks") {
    const limit = Math.min(Number(input.limit) || 50, 100);
    let q = eip
      .from("task")
      .select(
        "id, title, progress, due_date, priority, task_status(name, is_done_state), app_user!task_owner_id_fkey(name, email), project(name)",
      )
      .limit(limit);

    if (input.status_name) {
      // filter via embedded table
      q = q.eq("task_status.name", input.status_name as string);
    }
    if (input.owner_email) {
      q = q.eq("app_user.email", input.owner_email as string);
    }
    if (input.overdue_only) {
      q = q.lt("due_date", today);
    }
    const { data, error } = await q;
    if (error) throw error;
    let rows = (data ?? []) as any[];
    if (input.overdue_only) {
      rows = rows.filter((r) => r.task_status && r.task_status.is_done_state === false);
    }
    if (input.status_name) rows = rows.filter((r) => r.task_status?.name === input.status_name);
    if (input.owner_email) rows = rows.filter((r) => r.app_user?.email === input.owner_email);
    return rows.map((r) => ({
      title: r.title,
      status: r.task_status?.name ?? null,
      owner_name: r.app_user?.name ?? null,
      owner_email: r.app_user?.email ?? null,
      project: r.project?.name ?? null,
      progress: r.progress,
      due_date: r.due_date,
      priority: r.priority,
    }));
  }

  if (name === "list_announcements") {
    const limit = Math.min(Number(input.limit) || 10, 50);
    const { data, error } = await eip
      .from("announcement")
      .select("title, content, is_pinned, published_at")
      .not("published_at", "is", null)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((a: any) => ({
      title: a.title,
      excerpt: (a.content ?? "").slice(0, 200),
      is_pinned: a.is_pinned,
      published_at: a.published_at,
    }));
  }

  if (name === "list_projects") {
    const { data: projects, error } = await eip
      .from("project")
      .select("id, name, status, goal, start_date, end_date");
    if (error) throw error;
    const { data: tasks, error: tErr } = await eip
      .from("task")
      .select("project_id, task_status(is_done_state)");
    if (tErr) throw tErr;
    const stats = new Map<string, { total: number; done: number }>();
    for (const t of (tasks ?? []) as any[]) {
      const s = stats.get(t.project_id) ?? { total: 0, done: 0 };
      s.total += 1;
      if (t.task_status?.is_done_state) s.done += 1;
      stats.set(t.project_id, s);
    }
    return (projects ?? []).map((p: any) => ({
      name: p.name,
      status: p.status,
      goal: p.goal,
      start_date: p.start_date,
      end_date: p.end_date,
      task_total: stats.get(p.id)?.total ?? 0,
      task_done: stats.get(p.id)?.done ?? 0,
    }));
  }

  if (name === "eip_summary") {
    const [{ data: tasks, error: e1 }, { count: annCount, error: e2 }, { count: projCount, error: e3 }] =
      await Promise.all([
        eip.from("task").select("due_date, task_status(name, is_done_state)"),
        eip.from("announcement").select("id", { count: "exact", head: true }).not("published_at", "is", null),
        eip.from("project").select("id", { count: "exact", head: true }),
      ]);
    if (e1) throw e1;
    if (e2) throw e2;
    if (e3) throw e3;
    const byStatus: Record<string, number> = {};
    let overdue = 0;
    for (const t of (tasks ?? []) as any[]) {
      const name = t.task_status?.name ?? "未分類";
      byStatus[name] = (byStatus[name] ?? 0) + 1;
      if (t.due_date && t.due_date < today && t.task_status?.is_done_state === false) overdue += 1;
    }
    return {
      task_total: (tasks ?? []).length,
      tasks_by_status: byStatus,
      overdue_tasks: overdue,
      published_announcements: annCount ?? 0,
      projects: projCount ?? 0,
    };
  }

  throw new Error(`未知的工具:${name}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const EIP_URL = Deno.env.get("EIP_SUPABASE_URL");
    const EIP_KEY = Deno.env.get("EIP_SUPABASE_SERVICE_ROLE_KEY");

    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "尚未設定 ANTHROPIC_API_KEY" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "未登入" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return jsonResponse({ error: "驗證失敗" }, 401);
    const userId = userData.user.id;

    const payload = (await req.json()) as ChatPayload;
    const { agent_id, user_message } = payload;
    let conversation_id = payload.conversation_id;
    if (!agent_id || !user_message?.trim()) {
      return jsonResponse({ error: "缺少 agent_id 或 user_message" }, 400);
    }

    const { data: agent, error: agentErr } = await supabase
      .from("agent")
      .select("id, system_prompt, model, is_active, name")
      .eq("id", agent_id)
      .maybeSingle();
    if (agentErr || !agent) return jsonResponse({ error: "找不到代理人" }, 404);
    if (!agent.is_active) return jsonResponse({ error: "此代理人已停用" }, 400);

    if (!conversation_id) {
      const title =
        user_message.trim().slice(0, 30) + (user_message.length > 30 ? "…" : "");
      const { data: convo, error: convoErr } = await supabase
        .from("conversation")
        .insert({ agent_id, user_id: userId, title })
        .select("id")
        .single();
      if (convoErr || !convo) {
        return jsonResponse({ error: "建立對話失敗:" + (convoErr?.message ?? "") }, 500);
      }
      conversation_id = convo.id;
    }

    const { data: history, error: histErr } = await supabase
      .from("message")
      .select("role, content")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true });
    if (histErr) return jsonResponse({ error: "讀取歷史訊息失敗" }, 500);

    // Anthropic conversation messages (content can be string or block array)
    const messages: any[] = (history ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    messages.push({ role: "user", content: user_message });

    // EIP client (only used inside tool calls)
    const eip = EIP_URL && EIP_KEY
      ? createClient(EIP_URL, EIP_KEY, { auth: { persistSession: false } })
      : null;

    // Tool-use loop
    let assistantText = "";
    const MAX_TURNS = 6;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: agent.model || "claude-sonnet-4-5",
          max_tokens: 2048,
          system: agent.system_prompt || "",
          tools,
          messages,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("Anthropic error:", res.status, errText);
        return jsonResponse(
          { error: `Anthropic API 錯誤 (${res.status}): ${errText}` },
          502,
        );
      }

      const data = await res.json();
      const blocks: any[] = data.content ?? [];

      // Append the assistant turn (full block array) to messages
      messages.push({ role: "assistant", content: blocks });

      if (data.stop_reason === "tool_use") {
        const toolUses = blocks.filter((b) => b.type === "tool_use");
        const toolResults: any[] = [];
        for (const tu of toolUses) {
          try {
            if (!eip) throw new Error("EIP 連線未設定");
            const result = await runTool(eip, tu.name, tu.input ?? {});
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
            });
          } catch (e) {
            console.error("Tool error:", tu.name, e);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              is_error: true,
              content: `工具執行失敗:${(e as Error).message}`,
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue; // ask the model again with tool results
      }

      // Final answer
      assistantText = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n") || "(沒有回覆)";
      break;
    }

    if (!assistantText) assistantText = "(達到工具呼叫上限,未取得最終回覆)";

    // Persist only the user message and final assistant text
    const { error: insErr } = await supabase.from("message").insert([
      { conversation_id, role: "user", content: user_message },
      { conversation_id, role: "assistant", content: assistantText },
    ]);
    if (insErr) console.error("Insert message error:", insErr);

    return jsonResponse({ conversation_id, reply: assistantText });
  } catch (err) {
    console.error("agent-chat error:", err);
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
