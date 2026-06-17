import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "登入 - EIP agent" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard/agents" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        toast.success("登入成功");
        navigate({ to: "/dashboard/agents" });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard/agents` },
        });
        if (error) throw error;
        toast.success("註冊成功,請查收驗證信(若已關閉驗證可直接登入)");
        setMode("signin");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md bg-card border rounded-lg p-8 shadow-sm">
        <h1 className="text-2xl font-semibold mb-1">EIP agent</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {mode === "signin" ? "登入您的帳號" : "建立新帳號"}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="email">電子郵件</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="password">密碼</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "處理中…" : mode === "signin" ? "登入" : "註冊"}
          </Button>
        </form>
        <div className="mt-4 text-center text-sm">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "沒有帳號?註冊" : "已有帳號?登入"}
          </button>
        </div>
        <div className="mt-2 text-center text-xs text-muted-foreground">
          <Link to="/">回首頁</Link>
        </div>
      </div>
    </div>
  );
}
