import { NextRequest, NextResponse } from 'next/server';
import { searchIndex } from '@/lib/state';
import { executeMultipleAI } from '@/lib/ai/executor';
import { AIProvider } from '@/lib/ai/types';
import { ensureDocumentInMemory } from '@/lib/document-loader';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      documentId,
      question,
      providers,
      models,
      action
    } = body as {
      documentId: string;
      question: string;
      providers: AIProvider[];
      models: Partial<Record<AIProvider, string>>;
      action?: 'translate' | 'suggest' | 'adapt' | 'update' | null;
    };

    if (!documentId || !question || !providers || !models) {
      console.error('[CHAT] 400 Error - Missing fields:', {
        documentId: documentId || 'MISSING',
        question: question || 'MISSING',
        providers: providers || 'MISSING',
        models: models || 'MISSING'
      });
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Lazy loading: garante que documento está em memória
    // Se não estiver, baixa do Supabase Storage e processa
    const doc = await ensureDocumentInMemory(documentId);

    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Search relevant chunks usando BM25
    const topChunks = searchIndex(doc.index, doc.chunks, question, 8);

    if (topChunks.length === 0) {
      return NextResponse.json(
        { error: 'No relevant context found' },
        { status: 400 }
      );
    }

    // Execute AI requests
    const answers = await executeMultipleAI(providers, models, {
      question,
      context: topChunks,
      action: action ?? null
    });

    return NextResponse.json({ answers });
  } catch (error: any) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: `Chat failed: ${error.message}` },
      { status: 500 }
    );
  }
}
