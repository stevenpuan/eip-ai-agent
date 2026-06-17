import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bot, MessageSquare, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

const navGroups = [
  {
    label: "AI Agent",
    items: [
      { to: "/dashboard/agents", label: "代理人管理", icon: Users },
      { to: "/dashboard/agents/chat", label: "對話", icon: MessageSquare },
    ],
  },
];

function AuthenticatedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen flex bg-muted/20">
      <aside className="w-60 border-r bg-card flex flex-col">
        <div className="h-14 flex items-center px-4 border-b">
          <Bot className="h-5 w-5 text-primary mr-2" />
          <span className="font-semibold">EIP agent</span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-6 overflow-y-auto">
          {navGroups.map((g) => (
            <div key={g.label}>
              <div className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {g.label}
              </div>
              <div className="space-y-1">
                {g.items.map((item) => {
                  const active = pathname === item.to;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t p-3 space-y-2">
          <div className="text-xs text-muted-foreground truncate px-1">
            {email}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={logout}
          >
            <LogOut className="h-4 w-4 mr-2" />
            登出
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
