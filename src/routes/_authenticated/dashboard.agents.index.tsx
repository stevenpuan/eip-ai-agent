import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/agents/")({
  head: () => ({ meta: [{ title: "代理人管理 - EIP agent" }] }),
  component: AgentsPage,
});

type Agent = {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
};

const emptyForm = {
  name: "",
  description: "",
  system_prompt: "",
  model: "claude-sonnet-4-5",
  is_active: true,
};

function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("agent")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setAgents((data ?? []) as Agent[]);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (a: Agent) => {
    setEditing(a);
    setForm({
      name: a.name,
      description: a.description ?? "",
      system_prompt: a.system_prompt,
      model: a.model,
      is_active: a.is_active,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("請輸入代理人名稱");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("agent")
          .update({
            name: form.name,
            description: form.description,
            system_prompt: form.system_prompt,
            model: form.model,
            is_active: form.is_active,
          })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("已更新");
      } else {
        if (!userId) throw new Error("未登入");
        const { error } = await supabase.from("agent").insert({
          name: form.name,
          description: form.description,
          system_prompt: form.system_prompt,
          model: form.model,
          is_active: form.is_active,
          created_by: userId,
        });
        if (error) throw error;
        toast.success("已建立");
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: Agent) => {
    if (!confirm(`確定刪除「${a.name}」?其所有對話也會一併刪除。`)) return;
    const { error } = await supabase.from("agent").delete().eq("id", a.id);
    if (error) toast.error(error.message);
    else {
      toast.success("已刪除");
      load();
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">代理人管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            建立並管理 AI 代理人。每個代理人有自己的角色設定。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />新增代理人
        </Button>
      </div>

      <div className="bg-card border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名稱</TableHead>
              <TableHead>描述</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  載入中…
                </TableCell>
              </TableRow>
            ) : agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  尚無代理人
                </TableCell>
              </TableRow>
            ) : (
              agents.map((a) => {
                const owned = a.created_by === userId;
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {a.description || "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{a.model}</TableCell>
                    <TableCell>
                      {a.is_active ? (
                        <Badge variant="secondary">啟用</Badge>
                      ) : (
                        <Badge variant="outline">停用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(a)}
                        disabled={!owned}
                        title={owned ? "編輯" : "僅建立者可編輯"}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(a)}
                        disabled={!owned}
                        title={owned ? "刪除" : "僅建立者可刪除"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "編輯代理人" : "新增代理人"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>名稱 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>描述</Label>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div>
              <Label>角色設定 (System Prompt)</Label>
              <Textarea
                rows={8}
                value={form.system_prompt}
                onChange={(e) =>
                  setForm({ ...form, system_prompt: e.target.value })
                }
                placeholder="例如:你是企業內部管理平台(EIP)的 AI 助理…"
              />
            </div>
            <div>
              <Label>模型</Label>
              <Input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                例如 claude-sonnet-4-5、claude-opus-4-5、claude-haiku-4-5
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              <Label>啟用</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "儲存中…" : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
