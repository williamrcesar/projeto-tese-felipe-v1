-- Tabela para jobs de atualização de normas
CREATE TABLE IF NOT EXISTS norm_update_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'analyzing', 'completed', 'error')),

  -- Referências encontradas (JSON array de NormReference)
  norm_references JSONB DEFAULT '[]'::jsonb,

  -- Estatísticas
  total_references INTEGER DEFAULT 0,
  vigentes INTEGER DEFAULT 0,
  alteradas INTEGER DEFAULT 0,
  revogadas INTEGER DEFAULT 0,
  substituidas INTEGER DEFAULT 0,
  manual_review INTEGER DEFAULT 0,

  -- Progresso
  current_reference INTEGER DEFAULT 0,
  progress_percentage INTEGER DEFAULT 0,

  -- Error handling
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_norm_update_jobs_document_id ON norm_update_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_norm_update_jobs_status ON norm_update_jobs(status);
CREATE INDEX IF NOT EXISTS idx_norm_update_jobs_created_at ON norm_update_jobs(created_at DESC);

-- RLS (Row Level Security)
ALTER TABLE norm_update_jobs ENABLE ROW LEVEL SECURITY;

-- Política: Todos podem ler seus próprios jobs
CREATE POLICY "Users can view their own norm update jobs"
  ON norm_update_jobs
  FOR SELECT
  USING (true); -- Por enquanto permite todos, depois ajustar com auth

-- Política: Todos podem criar jobs
CREATE POLICY "Users can create norm update jobs"
  ON norm_update_jobs
  FOR INSERT
  WITH CHECK (true);

-- Política: Jobs podem ser atualizados
CREATE POLICY "Jobs can be updated"
  ON norm_update_jobs
  FOR UPDATE
  USING (true);
