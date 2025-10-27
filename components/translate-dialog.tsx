'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Languages, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type TranslationDialogProps = {
  documentId: string;
  documentTitle: string;
};

const LANGUAGES = {
  en: 'English',
  pt: 'Português',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский'
};

const PROVIDERS = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  grok: 'xAI Grok'
};

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  grok: ['grok-2-1212', 'grok-2-vision-1212']
};

export function TranslateDialog({ documentId, documentTitle }: TranslationDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState<string>('');
  const [provider, setProvider] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [isTranslating, setIsTranslating] = useState(false);

  const handleStartTranslation = async () => {
    if (!targetLanguage || !provider || !model) {
      toast.error('Por favor, preencha todos os campos');
      return;
    }

    try {
      setIsTranslating(true);

      const res = await fetch(`/api/translate/${documentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetLanguage,
          provider,
          model
        })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Falha ao iniciar tradução');
      }

      const data = await res.json();
      toast.success('Tradução iniciada! Redirecionando...');

      // Redireciona para página de visualização
      setTimeout(() => {
        router.push(`/translations/${data.jobId}`);
      }, 1000);

    } catch (error: any) {
      console.error('Translation error:', error);
      toast.error(error.message);
      setIsTranslating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Languages className="w-4 h-4 mr-2" />
          Traduzir Documento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Traduzir Documento</DialogTitle>
          <DialogDescription>
            Traduz o documento completo preservando toda a formatação original
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="target-language">Idioma de Destino</Label>
            <Select value={targetLanguage} onValueChange={setTargetLanguage} disabled={isTranslating}>
              <SelectTrigger id="target-language">
                <SelectValue placeholder="Selecione o idioma" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LANGUAGES).map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider">Provedor de IA</Label>
            <Select
              value={provider}
              onValueChange={(val) => {
                setProvider(val);
                setModel('');
              }}
              disabled={isTranslating}
            >
              <SelectTrigger id="provider">
                <SelectValue placeholder="Selecione o provedor" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDERS).map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {provider && (
            <div className="space-y-2">
              <Label htmlFor="model">Modelo</Label>
              <Select value={model} onValueChange={setModel} disabled={isTranslating}>
                <SelectTrigger id="model">
                  <SelectValue placeholder="Selecione o modelo" />
                </SelectTrigger>
                <SelectContent>
                  {MODELS_BY_PROVIDER[provider]?.map((modelName) => (
                    <SelectItem key={modelName} value={modelName}>
                      {modelName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="pt-2">
            <Button
              onClick={handleStartTranslation}
              className="w-full"
              disabled={!targetLanguage || !provider || !model || isTranslating}
            >
              {isTranslating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Iniciando...
                </>
              ) : (
                <>
                  <Languages className="w-4 h-4 mr-2" />
                  Iniciar Tradução
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
