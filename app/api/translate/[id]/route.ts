import { NextRequest, NextResponse } from 'next/server';
import { translateDocx } from '@/lib/translation/docx-translator';
import { TranslationOptions, SupportedLanguage } from '@/lib/translation/types';
import { AIProvider } from '@/lib/ai/types';
import { supabase } from '@/lib/supabase';
import { ensureDocumentInMemory } from '@/lib/document-loader';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// POST /api/translate/[id] - Inicia tradução
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: documentId } = await params;

    // Busca documento no Supabase
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    const body = await req.json();
    const {
      targetLanguage,
      sourceLanguage,
      provider,
      model,
      maxPages,
      sourceDocumentPath // Optional: for pipeline usage
    }: {
      targetLanguage: SupportedLanguage;
      sourceLanguage?: SupportedLanguage;
      provider: AIProvider;
      model: string;
      maxPages?: number;
      sourceDocumentPath?: string;
    } = body;

    if (!targetLanguage || !provider || !model) {
      return NextResponse.json(
        { error: 'Missing required fields: targetLanguage, provider, model' },
        { status: 400 }
      );
    }

    // Cria job de tradução no Supabase
    const jobId = randomUUID();
    const { error: jobError } = await supabase.from('translation_jobs').insert({
      id: jobId,
      document_id: documentId,
      target_language: targetLanguage,
      source_language: sourceLanguage || null,
      provider,
      model,
      status: 'pending',
      total_chunks: 0,
      started_at: new Date().toISOString()
    });

    if (jobError) {
      console.error('[TRANSLATE] Failed to create job:', jobError);
      return NextResponse.json(
        { error: 'Failed to create translation job' },
        { status: 500 }
      );
    }

    // Executa tradução em background
    executeTranslation(jobId, documentId, doc, targetLanguage, sourceLanguage, provider, model, maxPages, sourceDocumentPath);

    return NextResponse.json({
      jobId,
      message: 'Translation started',
      documentId
    });

  } catch (error: any) {
    console.error('Translation error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// Função auxiliar para executar tradução em background
async function executeTranslation(
  jobId: string,
  documentId: string,
  doc: any,
  targetLanguage: SupportedLanguage,
  sourceLanguage: SupportedLanguage | undefined,
  provider: AIProvider,
  model: string,
  maxPages?: number,
  sourceDocumentPath?: string
) {
  const tempDir = os.tmpdir();
  const tempInputPath = sourceDocumentPath || path.join(tempDir, `${documentId}_input.docx`);
  const tempOutputPath = path.join(tempDir, `${documentId}_output_${targetLanguage}.docx`);

  try {
    if (!sourceDocumentPath) {
      // Standalone mode - download from Storage
      console.log('[TRANSLATE] Downloading original from Storage:', doc.file_path);
      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from('documents')
        .download(doc.file_path);

      if (downloadError || !fileBlob) {
        throw new Error(`Failed to download: ${downloadError?.message}`);
      }

      // Salva temporariamente para processar
      const buffer = Buffer.from(await fileBlob.arrayBuffer());
      await fs.writeFile(tempInputPath, buffer);
    } else {
      // Pipeline mode - use provided path
      console.log('[TRANSLATE] Using source document from pipeline:', sourceDocumentPath);
    }

    // 2. Traduz documento
    const options: TranslationOptions = {
      targetLanguage,
      sourceLanguage,
      provider,
      model,
      maxPages, // Limit pages if specified
      onProgress: async (progress) => {
        await supabase.from('translation_jobs').update({
          status: progress.status,
          progress_percentage: progress.percentage,
          current_chunk: progress.currentChunk,
          total_chunks: progress.totalChunks,
          current_section: progress.currentSection || null,
          estimated_seconds_remaining: progress.estimatedSecondsRemaining || null,
          elapsed_seconds: progress.elapsedSeconds || null,
          stats: progress.stats || null
        }).eq('id', jobId);
      },
      onLog: (message) => {
        console.log(`[TRANSLATE ${jobId}] ${message}`);
      }
    };

    const result = await translateDocx(tempInputPath, tempOutputPath, options);

    if (!result.success) {
      throw new Error(result.error || 'Translation failed');
    }

    // 3. Upload arquivo traduzido para Storage
    const outputFileName = `${path.parse(doc.file_path).name}_${targetLanguage}.docx`;
    const storagePath = `translations/${outputFileName}`;
    const translatedBuffer = await fs.readFile(tempOutputPath);

    console.log('[TRANSLATE] Uploading translated file to Storage:', storagePath);
    const { error: uploadError } = await supabase.storage
      .from('translations')
      .upload(storagePath, translatedBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Failed to upload: ${uploadError.message}`);
    }

    // 4. Atualiza job como concluído
    await supabase.from('translation_jobs').update({
      status: 'completed',
      progress_percentage: 100,
      output_path: storagePath,
      stats: result.validationReport || null,
      completed_at: new Date().toISOString()
    }).eq('id', jobId);

    console.log('[TRANSLATE] Translation completed successfully:', jobId);

  } catch (error: any) {
    console.error('[TRANSLATE] Translation failed:', error);
    await supabase.from('translation_jobs').update({
      status: 'error',
      error_message: error.message
    }).eq('id', jobId);
  } finally {
    // Limpa arquivos temporários
    try {
      await fs.unlink(tempInputPath);
      await fs.unlink(tempOutputPath);
    } catch {}
  }
}

// GET /api/translate/[id] - Consulta status da tradução (id aqui é o jobId)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;

    // Busca job no Supabase
    const { data: job, error } = await supabase
      .from('translation_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !job) {
      return NextResponse.json(
        { error: 'Translation job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      jobId: job.id,
      documentId: job.document_id,
      status: job.status,
      error_message: job.error_message,
      progress: {
        status: job.status,
        currentChunk: job.current_chunk,
        totalChunks: job.total_chunks,
        percentage: job.progress_percentage,
        currentSection: job.current_section,
        error: job.error_message,
        estimatedSecondsRemaining: job.estimated_seconds_remaining,
        elapsedSeconds: job.elapsed_seconds,
        stats: job.stats
      },
      outputPath: job.output_path,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at
    });

  } catch (error: any) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
