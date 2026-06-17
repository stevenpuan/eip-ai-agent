// supabase/functions/agent-chat/index.ts
// AI Agent chat endpoint: validates the user via the Supabase JWT,
// loads the agent's system prompt + conversation history, calls
// Anthropic Claude, persists user + assistant messages, returns reply.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      return jsonResponse(
        { error: "尚未設定 ANTHROPIC_API_KEY,請聯絡系統管理員。" },
        500,
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "未登入" }, 401);
    }

    // Supabase client scoped to the caller (RLS applies)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "驗證失敗" }, 401);
    }
    const userId = userData.user.id;

    const payload = (await req.json()) as ChatPayload;
    const { agent_id, user_message } = payload;
    let conversation_id = payload.conversation_id;

    if (!agent_id || !user_message?.trim()) {
      return jsonResponse({ error: "缺少 agent_id 或 user_message" }, 400);
    }

    // Load agent
    const { data: agent, error: agentErr } = await supabase
      .from("agent")
      .select("id, system_prompt, model, is_active, name")
      .eq("id", agent_id)
      .maybeSingle();

    if (agentErr || !agent) {
      return jsonResponse({ error: "找不到代理人" }, 404);
    }
    if (!agent.is_active) {
      return jsonResponse({ error: "此代理人已停用" }, 400);
    }

    // Create conversation if not provided
    if (!conversation_id) {
      const title =
        user_message.trim().slice(0, 30) +
        (user_message.length > 30 ? "…" : "");
      const { data: convo, error: convoErr } = await supabase
        .from("conversation")
        .insert({ agent_id, user_id: userId, title })
        .select("id")
        .single();
      if (convoErr || !convo) {
        return jsonResponse(
          { error: "建立對話失敗:" + (convoErr?.message ?? "") },
          500,
        );
      }
      conversation_id = convo.id;
    }

    // Load history (excluding the new user message which we'll add now)
    const { data: history, error: histErr } = await supabase
      .from("message")
      .select("role, content")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true });

    if (histErr) {
      return jsonResponse({ error: "讀取歷史訊息失敗" }, 500);
    }

    const messages = [
      ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: user_message },
    ];

    // Call Anthropic
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
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
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error:", anthropicRes.status, errText);
      return jsonResponse(
        { error: `Anthropic API 錯誤 (${anthropicRes.status}): ${errText}` },
        502,
      );
    }

    const anthropicData = await anthropicRes.json();
    const assistantText: string =
      anthropicData?.content
        ?.filter((b: { type: string }) => b.type === "text")
        ?.map((b: { text: string }) => b.text)
        ?.join("\n") ?? "(沒有回覆)";

    // Persist both messages
    const { error: insErr } = await supabase.from("message").insert([
      { conversation_id, role: "user", content: user_message },
      { conversation_id, role: "assistant", content: assistantText },
    ]);
    if (insErr) {
      console.error("Insert message error:", insErr);
    }

    return jsonResponse({
      conversation_id,
      reply: assistantText,
    });
  } catch (err) {
    console.error("agent-chat error:", err);
    return jsonResponse(
      { error: (err as Error).message ?? "Unknown error" },
      500,
    );
  }
});
