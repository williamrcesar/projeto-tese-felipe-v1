'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface UpdateNormsButtonProps {
  documentId: string;
  documentTitle: string;
}

export function UpdateNormsButton({ documentId, documentTitle }: UpdateNormsButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleUpdateNorms = async () => {
    setLoading(true);
    toast.loading('Iniciando análise de normas...');

    try {
      const res = await fetch('/api/norms-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          provider: 'gemini',
          model: 'gemini-flash-latest'
        })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Falha ao iniciar análise');
      }

      const data = await res.json();
      toast.dismiss();
      toast.success('Análise iniciada!');

      // Redireciona para página de análise
      router.push(`/norms-update/${data.jobId}`);

    } catch (error: any) {
      toast.dismiss();
      toast.error(error.message || 'Erro ao iniciar análise');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleUpdateNorms}
      disabled={loading}
      variant="outline"
      className="gap-2"
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Analisando...
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4" />
          Atualizar Normas
        </>
      )}
    </Button>
  );
}
