import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EIP agent" },
      { name: "description", content: "EIP agent — 企業內部 AI 代理人平台" },
    ],
  }),
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard/agents" });
    throw redirect({ to: "/auth" });
  },
  component: () => null,
});
