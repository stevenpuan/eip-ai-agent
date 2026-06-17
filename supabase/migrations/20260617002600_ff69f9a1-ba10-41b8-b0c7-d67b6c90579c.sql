
-- update_updated_at_column helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- agent
CREATE TABLE public.agent (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  system_prompt text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT 'claude-sonnet-4-6',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent TO authenticated;
GRANT ALL ON public.agent TO service_role;
ALTER TABLE public.agent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_select_authenticated" ON public.agent
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "agent_insert_own" ON public.agent
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "agent_update_own" ON public.agent
  FOR UPDATE TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
CREATE POLICY "agent_delete_own" ON public.agent
  FOR DELETE TO authenticated USING (auth.uid() = created_by);
CREATE TRIGGER trg_agent_updated_at BEFORE UPDATE ON public.agent
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- conversation
CREATE TABLE public.conversation (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agent(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT '新對話',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation TO authenticated;
GRANT ALL ON public.conversation TO service_role;
ALTER TABLE public.conversation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversation_owner_all" ON public.conversation
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX conversation_user_id_idx ON public.conversation(user_id);
CREATE INDEX conversation_agent_id_idx ON public.conversation(agent_id);

-- message
CREATE TABLE public.message (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.conversation(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message TO authenticated;
GRANT ALL ON public.message TO service_role;
ALTER TABLE public.message ENABLE ROW LEVEL SECURITY;
CREATE POLICY "message_select_owner" ON public.message
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = conversation_id AND c.user_id = auth.uid())
  );
CREATE POLICY "message_insert_owner" ON public.message
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = conversation_id AND c.user_id = auth.uid())
  );
CREATE POLICY "message_update_owner" ON public.message
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = conversation_id AND c.user_id = auth.uid())
  );
CREATE POLICY "message_delete_owner" ON public.message
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.conversation c WHERE c.id = conversation_id AND c.user_id = auth.uid())
  );
CREATE INDEX message_conversation_id_idx ON public.message(conversation_id);

-- seed agent (created_by = NULL placeholder won't work; use a system uuid)
-- We use the all-zeros uuid as a "system" owner; everyone can SELECT (policy allows true),
-- and no one but service_role can update/delete it (created_by != auth.uid()).
INSERT INTO public.agent (name, description, system_prompt, model, is_active, created_by)
VALUES (
  'EIP 助理',
  '企業內部管理平台 AI 助理',
  '你是企業內部管理平台(EIP)的 AI 助理,協助同仁查詢與整理工作、會議、專案與公告相關事務。回答精簡、務實、用繁體中文。',
  'claude-sonnet-4-6',
  true,
  '00000000-0000-0000-0000-000000000000'
);
