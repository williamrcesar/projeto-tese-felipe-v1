'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileText, CheckCircle2, XCircle, Loader2, ArrowLeft, Eye, Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import '../document-viewer.css';

type TranslationJob = {
  jobId: string;
  documentId: string;
  progress: {
    status: string;
    currentChunk: number;
    totalChunks: number;
    percentage: number;
    currentSection?: string;
    error?: string;
    estimatedSecondsRemaining?: number;
    elapsedSeconds?: number;
    stats?: any;
  };
  outputPath?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

type Document = {
  id: string;
  title: string;
  pages: number;
  filePath: string;
  projectId?: string;
};

type DocumentText = {
  html?: string;
  text?: string;
  paragraphs?: string[];
  stats: {
    totalChars: number;
    totalWords: number;
    totalParagraphs?: number;
  };
};

// Helper para formatar tempo
function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}min ${secs}s` : `${mins}min`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  }
}

export default function TranslationViewPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<TranslationJob | null>(null);
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Texto dos documentos
  const [originalText, setOriginalText] = useState<DocumentText | null>(null);
  const [translatedText, setTranslatedText] = useState<DocumentText | null>(null);
  const [loadingTexts, setLoadingTexts] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number>(0);
  const [currentResult, setCurrentResult] = useState<number>(0);

  // Refs para scroll sincronizado
  const originalScrollRef = useRef<HTMLDivElement>(null);
  const translatedScrollRef = useRef<HTMLDivElement>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Polling para atualizar progresso
  useEffect(() => {
    const fetchJob = async () => {
      try {
        const res = await fetch(`/api/translate/${jobId}`);
        if (!res.ok) throw new Error('Failed to fetch job');

        const data = await res.json();
        setJob(data);

        // Busca documento se ainda não tiver
        if (!document && data.documentId) {
          const docRes = await fetch(`/api/documents/${data.documentId}`);
          if (docRes.ok) {
            const docData = await docRes.json();
            setDocument(docData);
          }
        }

        setLoading(false);
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchJob();

    // Poll a cada 2 segundos se ainda não completou
    const interval = setInterval(() => {
      if (job?.progress.status === 'translating' || job?.progress.status === 'pending') {
        fetchJob();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [jobId, job?.progress.status, document]);

  // Carrega textos quando tradução completa
  const loadDocumentTexts = async () => {
    if (!document || !job?.outputPath) return;

    setLoadingTexts(true);
    try {
      // Carrega original como HTML
      const originalRes = await fetch(
        `/api/extract-text?bucket=documents&path=${encodeURIComponent(document.filePath)}&format=html`
      );
      if (originalRes.ok) {
        const originalData = await originalRes.json();
        setOriginalText(originalData);
      }

      // Carrega traduzido como HTML
      const translatedRes = await fetch(
        `/api/extract-text?bucket=translations&path=${encodeURIComponent(job.outputPath)}&format=html`
      );
      if (translatedRes.ok) {
        const translatedData = await translatedRes.json();
        setTranslatedText(translatedData);
      }
    } catch (err) {
      console.error('Failed to load document texts:', err);
    } finally {
      setLoadingTexts(false);
    }
  };

  // Search & highlight
  const highlightText = (html: string, query: string): string => {
    if (!query || query.length < 2) return html;

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');

    return html.replace(regex, '<mark class="bg-yellow-300 text-black">$1</mark>');
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentResult(0);

    if (!query || query.length < 2) {
      setSearchResults(0);
      return;
    }

    // Count occurrences in both documents
    const combinedText = `${originalText?.text || ''} ${translatedText?.text || ''}`;
    const matches = combinedText.match(new RegExp(query, 'gi'));
    setSearchResults(matches?.length || 0);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(0);
    setCurrentResult(0);
  };

  // Scroll sincronizado
  const handleScroll = (source: 'original' | 'translated') => {
    if (isSyncing) return;
    setIsSyncing(true);

    const sourceRef = source === 'original' ? originalScrollRef : translatedScrollRef;
    const targetRef = source === 'original' ? translatedScrollRef : originalScrollRef;

    if (sourceRef.current && targetRef.current) {
      const scrollPercentage =
        sourceRef.current.scrollTop /
        (sourceRef.current.scrollHeight - sourceRef.current.clientHeight);

      targetRef.current.scrollTop =
        scrollPercentage * (targetRef.current.scrollHeight - targetRef.current.clientHeight);
    }

    setTimeout(() => setIsSyncing(false), 50);
  };

  const handleDownload = (bucket: string, path: string, fileName: string) => {
    const url = `/api/download?bucket=${bucket}&path=${encodeURIComponent(path)}`;
    const a = window.document.createElement('a');
    a.href = url;
    a.download = fileName;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
  };

  if (loading) {
    return (
      <div className="container max-w-6xl mx-auto p-6 flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="container max-w-6xl mx-auto p-6">
        <Card className="p-6">
          <p className="text-red-500">Error: {error || 'Translation job not found'}</p>
          <Button onClick={() => router.push('/')} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Card>
      </div>
    );
  }

  const isCompleted = job.progress.status === 'completed';
  const isError = job.progress.status === 'error';
  const isProcessing = job.progress.status === 'translating' || job.progress.status === 'pending';

  return (
    <div className="container max-w-7xl mx-auto p-6">
      <div className="mb-6">
        <Button onClick={() => router.push('/')} variant="ghost">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Translation Status</h1>
        {document && <p className="text-gray-600">Document: {document.title}</p>}
      </div>

      <Tabs defaultValue="status" className="space-y-4">
        <TabsList>
          <TabsTrigger value="status">Status & Downloads</TabsTrigger>
          <TabsTrigger value="compare" disabled={!isCompleted}>
            <Eye className="w-4 h-4 mr-2" />
            Compare Documents
          </TabsTrigger>
        </TabsList>

        {/* Tab: Status */}
        <TabsContent value="status" className="space-y-4">
          {/* Status Card */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Progress</h2>
              {isCompleted && (
                <Badge className="bg-green-500">
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  Completed
                </Badge>
              )}
              {isError && (
                <Badge variant="destructive">
                  <XCircle className="w-4 h-4 mr-1" />
                  Error
                </Badge>
              )}
              {isProcessing && (
                <Badge className="bg-blue-500">
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Translating
                </Badge>
              )}
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex justify-between text-sm mb-2">
                <span>Progress</span>
                <span>{job.progress.percentage}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${
                    isCompleted ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${job.progress.percentage}%` }}
                />
              </div>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Chunks Processed</p>
                <p className="font-semibold">
                  {job.progress.currentChunk} / {job.progress.totalChunks}
                </p>
              </div>
              {job.progress.currentSection && (
                <div>
                  <p className="text-gray-500">Current Section</p>
                  <p className="font-semibold">{job.progress.currentSection}</p>
                </div>
              )}
            </div>

            {/* Time Info */}
            {isProcessing && (
              <div className="grid grid-cols-2 gap-4 text-sm mt-4 pt-4 border-t">
                {job.progress.elapsedSeconds !== undefined && (
                  <div>
                    <p className="text-gray-500">Tempo Decorrido</p>
                    <p className="font-semibold text-blue-600">
                      {formatTime(job.progress.elapsedSeconds)}
                    </p>
                  </div>
                )}
                {job.progress.estimatedSecondsRemaining !== undefined && (
                  <div>
                    <p className="text-gray-500">Tempo Estimado Restante</p>
                    <p className="font-semibold text-green-600">
                      ~{formatTime(job.progress.estimatedSecondsRemaining)}
                    </p>
                  </div>
                )}
              </div>
            )}

            {job.progress.error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded text-red-700">
                <p className="font-semibold">Error:</p>
                <p>{job.progress.error}</p>
              </div>
            )}
          </Card>

          {/* Download Section */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Original Document */}
            <Card className="p-6">
              <div className="flex items-center mb-4">
                <FileText className="w-5 h-5 mr-2 text-gray-500" />
                <h3 className="text-lg font-semibold">Original Document</h3>
              </div>
              {document && (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    {document.title} ({document.pages} pages)
                  </p>
                  <Button
                    onClick={() =>
                      handleDownload('documents', document.filePath, document.title)
                    }
                    className="w-full"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Original
                  </Button>
                </>
              )}
            </Card>

            {/* Translated Document */}
            <Card className="p-6">
              <div className="flex items-center mb-4">
                <FileText className="w-5 h-5 mr-2 text-green-500" />
                <h3 className="text-lg font-semibold">Translated Document</h3>
              </div>
              {isCompleted && job.outputPath ? (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    Translation completed successfully
                  </p>
                  <Button
                    onClick={() =>
                      handleDownload(
                        'translations',
                        job.outputPath!,
                        job.outputPath!.split('/').pop() || 'translated.docx'
                      )
                    }
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Translation
                  </Button>
                </>
              ) : (
                <p className="text-sm text-gray-500 mb-4">
                  Translation in progress... The download button will appear when completed.
                </p>
              )}
            </Card>
          </div>

          {/* Validation Stats */}
          {isCompleted && job.progress.stats && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Validation Report</h3>
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Original Content</p>
                  <p className="font-semibold">
                    {job.progress.stats.originalWords} words
                  </p>
                  <p className="text-xs text-gray-400">
                    {job.progress.stats.originalChars} chars
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Translated Content</p>
                  <p className="font-semibold">
                    {job.progress.stats.translatedWords} words
                  </p>
                  <p className="text-xs text-gray-400">
                    {job.progress.stats.translatedChars} chars ({job.progress.stats.wordRatio})
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Quality</p>
                  <p className="font-semibold text-green-600">
                    ✓ {job.progress.stats.validationPassed} passed
                  </p>
                  {job.progress.stats.validationFailed > 0 && (
                    <p className="text-xs text-yellow-600">
                      ⚠ {job.progress.stats.keptOriginal} kept original
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Tab: Compare */}
        <TabsContent value="compare" className="space-y-4">
          {isCompleted && (
            <div>
              {/* Search Bar */}
              {originalText && translatedText && (
                <Card className="p-4 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2">
                      <Search className="w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search in documents... (min 2 chars)"
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                        className="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {searchQuery && (
                        <Button
                          onClick={clearSearch}
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    {searchResults > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">
                          {searchResults} result{searchResults !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {!originalText && !translatedText ? (
                <Card className="p-6">
                  <Button onClick={loadDocumentTexts} disabled={loadingTexts} className="w-full">
                    {loadingTexts ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Loading documents...
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 mr-2" />
                        Load Documents for Comparison
                      </>
                    )}
                  </Button>
                </Card>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Original */}
                  <Card className="p-4 bg-gray-50">
                    <h3 className="text-lg font-semibold mb-4 sticky top-0 bg-gray-50 pb-2 border-b border-red-500 text-red-600 z-10">
                      Original
                    </h3>
                    <div
                      ref={originalScrollRef}
                      onScroll={() => handleScroll('original')}
                      className="max-h-[800px] overflow-y-auto pr-2"
                    >
                      <div
                        className="document-viewer"
                        dangerouslySetInnerHTML={{
                          __html: highlightText(originalText?.html || '', searchQuery)
                        }}
                      />
                    </div>
                  </Card>

                  {/* Translated */}
                  <Card className="p-4 bg-gray-50">
                    <h3 className="text-lg font-semibold mb-4 sticky top-0 bg-gray-50 pb-2 border-b border-red-500 text-red-600 z-10">
                      Traduzido
                    </h3>
                    <div
                      ref={translatedScrollRef}
                      onScroll={() => handleScroll('translated')}
                      className="max-h-[800px] overflow-y-auto pr-2"
                    >
                      <div
                        className="document-viewer"
                        dangerouslySetInnerHTML={{
                          __html: highlightText(translatedText?.html || '', searchQuery)
                        }}
                      />
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
