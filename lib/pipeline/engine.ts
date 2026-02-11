/**
 * Pipeline Execution Engine
 * Orchestrates sequential execution of document processing operations
 */

import { supabase } from '@/lib/supabase';
import {
  PipelineJob,
  PipelineOperation,
  PipelineExecutionContext,
  OperationResult,
  OperationConfigs,
  PipelineStatus
} from './types';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ============================================
// Custom Errors
// ============================================

export class PipelineCancelledException extends Error {
  constructor() {
    super('Pipeline execution was cancelled');
    this.name = 'PipelineCancelledException';
  }
}

export class PipelinePausedException extends Error {
  constructor() {
    super('Pipeline execution is paused');
    this.name = 'PipelinePausedException';
  }
}

// ============================================
// Pipeline Engine Class
// ============================================

export class PipelineEngine {
  private pipelineJobId: string;

  constructor(pipelineJobId: string) {
    this.pipelineJobId = pipelineJobId;
  }

  /**
   * Main execution method - runs the entire pipeline
   */
  async execute(): Promise<void> {
    console.log(`[PIPELINE ${this.pipelineJobId}] Starting execution...`);

    try {
      // Load job from database
      const job = await this.loadJob();

      // Update status to running
      await this.updateStatus('running');
      await this.updateTimestamp('started_at');

      // Get original document path from Storage
      let currentDocumentPath = await this.getOriginalDocumentPath(job.document_id);

      // Execute each operation sequentially
      for (let i = job.current_operation_index; i < job.selected_operations.length; i++) {
        // Check for execution control (pause/cancel)
        await this.checkExecutionControl();

        const operation = job.selected_operations[i];
        const config = job.operation_configs[operation];

        if (!config) {
          throw new Error(`Configuration not found for operation: ${operation}`);
        }

        console.log(`[PIPELINE ${this.pipelineJobId}] Executing operation ${i + 1}/${job.selected_operations.length}: ${operation}`);

        // Update current operation index
        await this.updateCurrentOperation(i);

        // Execute the operation
        const context: PipelineExecutionContext = {
          pipelineJobId: this.pipelineJobId,
          documentId: job.document_id,
          currentOperation: operation,
          currentOperationIndex: i,
          sourceDocumentPath: currentDocumentPath,
          config
        };

        const result = await this.executeOperation(context);

        // Save operation result
        await this.saveOperationResult(result);

        // Update cost
        if (result.metadata.cost_usd) {
          await this.incrementCost(result.metadata.cost_usd);
        }

        // Check if requires approval
        if (result.requiresApproval && result.status === 'awaiting_approval') {
          console.log(`[PIPELINE ${this.pipelineJobId}] ⏸️ Operation ${operation} awaiting approval`);

          // Update pipeline status to awaiting_approval
          await this.updateStatus('awaiting_approval');

          // Stop execution here - wait for user approval
          return;
        }

        // Save intermediate document (only if approved/completed)
        await this.saveIntermediateDocument(
          operation,
          i,
          result.outputDocumentPath,
          result
        );

        // Next operation will use this output as input
        currentDocumentPath = result.outputDocumentPath;

        console.log(`[PIPELINE ${this.pipelineJobId}] ✓ Operation ${operation} completed`);
      }

      // All operations completed - mark as completed
      await this.completePipeline(currentDocumentPath);

      console.log(`[PIPELINE ${this.pipelineJobId}] ✅ Pipeline completed successfully!`);

    } catch (error: any) {
      console.error(`[PIPELINE ${this.pipelineJobId}] ❌ Error:`, error);

      if (error instanceof PipelineCancelledException) {
        // Already marked as cancelled, just exit
        return;
      }

      await this.handleError(error);
      throw error;
    }
  }

  /**
   * Execute a single operation
   */
  private async executeOperation(context: PipelineExecutionContext): Promise<OperationResult> {
    const { currentOperation, config, sourceDocumentPath } = context;

    const startTime = Date.now();

    try {
      let result: OperationResult;

      switch (currentOperation) {
        case 'adjust':
          result = await this.executeAdjust(context);
          break;
        case 'update':
          result = await this.executeUpdate(context);
          break;
        case 'improve':
          result = await this.executeImprove(context);
          break;
        case 'adapt':
          result = await this.executeAdapt(context);
          break;
        case 'translate':
          result = await this.executeTranslate(context);
          break;
        default:
          throw new Error(`Unknown operation: ${currentOperation}`);
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      result.metadata.duration_seconds = duration;

      return result;

    } catch (error: any) {
      const duration = Math.round((Date.now() - startTime) / 1000);

      return {
        operation: currentOperation,
        operationIndex: context.currentOperationIndex,
        status: 'failed',
        outputDocumentPath: sourceDocumentPath, // Keep original on failure
        metadata: {
          duration_seconds: duration,
          error_message: error.message
        },
        completedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Execute ADJUST operation
   */
  private async executeAdjust(context: PipelineExecutionContext): Promise<OperationResult> {
    // Call adjust API internally
    const { config, sourceDocumentPath } = context;

    // TODO: Implement adjust operation logic
    // For now, return dummy result
    return {
      operation: 'adjust',
      operationIndex: context.currentOperationIndex,
      status: 'completed',
      outputDocumentPath: sourceDocumentPath, // Placeholder
      metadata: {
        items_processed: 0
      },
      completedAt: new Date().toISOString()
    };
  }

  /**
   * Execute UPDATE (norms) operation
   */
  private async executeUpdate(context: PipelineExecutionContext): Promise<OperationResult> {
    const { config, sourceDocumentPath, documentId } = context;

    // Call norms-update API to detect references
    const updateConfig = config as any;
    const apiUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
    const url = `${apiUrl}/api/norms-update/${documentId}`;

    console.log(`[PIPELINE] Calling norms-update API: ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: updateConfig.provider,
        model: updateConfig.model,
        sourceDocumentPath
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[PIPELINE] Norms-update API error (${res.status}):`, errorText);
      throw new Error(`Failed to start norms-update operation: ${res.status} ${errorText.substring(0, 200)}`);
    }

    const data = await res.json();
    const updateJobId = data.jobId;
    console.log(`[PIPELINE] Norms-update job created: ${updateJobId}`);

    // Wait for norms-update job to complete (poll)
    await this.waitForJobCompletion('update', updateJobId);

    // Get results
    const updateJob = await this.getNormsUpdateJob(updateJobId);

    return {
      operation: 'update',
      operationIndex: context.currentOperationIndex,
      status: 'awaiting_approval',
      outputDocumentPath: sourceDocumentPath, // Keep original until approved
      operationJobId: updateJobId,
      requiresApproval: true,
      approvalStatus: 'pending',
      metadata: {
        items_generated: updateJob.references?.length || 0
      },
      completedAt: new Date().toISOString()
    };
  }

  /**
   * Execute IMPROVE operation
   */
  private async executeImprove(context: PipelineExecutionContext): Promise<OperationResult> {
    const { config, sourceDocumentPath, documentId } = context;

    // Call improve API to generate suggestions
    const improveConfig = config as any;
    const apiUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
    const url = `${apiUrl}/api/improve/${documentId}`;

    console.log(`[PIPELINE] Calling improve API: ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: improveConfig.provider,
        model: improveConfig.model,
        sourceDocumentPath
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[PIPELINE] Improve API error (${res.status}):`, errorText);
      throw new Error(`Failed to start improve operation: ${res.status} ${errorText.substring(0, 200)}`);
    }

    const data = await res.json();
    const improveJobId = data.jobId;
    console.log(`[PIPELINE] Improve job created: ${improveJobId}`);

    // Wait for improve job to complete (poll)
    await this.waitForJobCompletion('improve', improveJobId);

    // Get results
    const improveJob = await this.getImproveJob(improveJobId);

    return {
      operation: 'improve',
      operationIndex: context.currentOperationIndex,
      status: 'awaiting_approval',
      outputDocumentPath: sourceDocumentPath, // Keep original until approved
      operationJobId: improveJobId,
      requiresApproval: true,
      approvalStatus: 'pending',
      metadata: {
        items_generated: improveJob.suggestions?.length || 0
      },
      completedAt: new Date().toISOString()
    };
  }

  /**
   * Execute ADAPT operation
   */
  private async executeAdapt(context: PipelineExecutionContext): Promise<OperationResult> {
    // Call adapt API internally
    const { config, sourceDocumentPath } = context;

    // TODO: Implement adapt operation logic
    return {
      operation: 'adapt',
      operationIndex: context.currentOperationIndex,
      status: 'completed',
      outputDocumentPath: sourceDocumentPath, // Placeholder
      metadata: {
        items_processed: 0
      },
      completedAt: new Date().toISOString()
    };
  }

  /**
   * Execute TRANSLATE operation
   */
  private async executeTranslate(context: PipelineExecutionContext): Promise<OperationResult> {
    // Call translate API internally
    const { config, sourceDocumentPath, documentId } = context;

    const translateConfig = config as any;
    const apiUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
    const url = `${apiUrl}/api/translate/${documentId}`;

    console.log(`[PIPELINE] Calling translate API: ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetLanguage: translateConfig.targetLanguage,
        sourceLanguage: translateConfig.sourceLanguage,
        provider: translateConfig.provider,
        model: translateConfig.model,
        maxPages: translateConfig.maxPages,
        sourceDocumentPath
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[PIPELINE] Translate API error (${res.status}):`, errorText);
      throw new Error(`Failed to start translate operation: ${res.status} ${errorText.substring(0, 200)}`);
    }

    const data = await res.json();
    const translateJobId = data.jobId;
    console.log(`[PIPELINE] Translate job created: ${translateJobId}`);

    // Wait for translate job to complete (poll)
    await this.waitForJobCompletion('translate', translateJobId);

    // Get translation job details
    const translationJob = await this.getTranslationJob(translateJobId);

    if (!translationJob.output_path) {
      throw new Error('Translation job completed without output_path');
    }

    // Download translated document from Storage to a temp path
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('translations')
      .download(translationJob.output_path);

    if (downloadError || !fileBlob) {
      console.error('[PIPELINE] Failed to download translated document:', downloadError);
      throw new Error(`Failed to download translated document: ${downloadError?.message || 'Unknown error'}`);
    }

    const tempDir = os.tmpdir();
    const tempPath = path.join(tempDir, `pipeline_${this.pipelineJobId}_translate_${Date.now()}.docx`);
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    await fs.writeFile(tempPath, buffer);

    return {
      operation: 'translate',
      operationIndex: context.currentOperationIndex,
      status: 'completed',
      outputDocumentPath: tempPath,
      operationJobId: translateJobId,
      metadata: {
        items_processed: translationJob.total_chunks || 0,
        progress_percentage: translationJob.progress_percentage || 0,
        output_path: translationJob.output_path
      },
      completedAt: new Date().toISOString()
    };
  }

  /**
   * Check if pipeline should pause or cancel
   */
  private async checkExecutionControl(): Promise<void> {
    const job = await this.loadJob();

    if (job.status === 'cancelled') {
      throw new PipelineCancelledException();
    }

    // Wait while paused
    while (job.status === 'paused') {
      console.log(`[PIPELINE ${this.pipelineJobId}] ⏸️ Paused, waiting...`);
      await this.sleep(2000);
      const updatedJob = await this.loadJob();
      if (updatedJob.status !== 'paused') {
        break;
      }
    }
  }

  /**
   * Get original document path from Storage
   */
  private async getOriginalDocumentPath(documentId: string): Promise<string> {
    const { data: doc, error } = await supabase
      .from('documents')
      .select('file_path')
      .eq('id', documentId)
      .single();

    if (error || !doc) {
      throw new Error(`Document not found: ${documentId}`);
    }

    // Download from Storage to temp path
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(doc.file_path);

    if (downloadError || !fileBlob) {
      throw new Error(`Failed to download document: ${downloadError?.message}`);
    }

    const tempDir = os.tmpdir();
    const tempPath = path.join(tempDir, `pipeline_${this.pipelineJobId}_original.docx`);
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    await fs.writeFile(tempPath, buffer);

    return tempPath;
  }

  /**
   * Save intermediate document to Storage and database
   */
  private async saveIntermediateDocument(
    operation: PipelineOperation,
    operationIndex: number,
    documentPath: string,
    result: OperationResult
  ): Promise<void> {
    try {
      // Read document
      const fileBuffer = await fs.readFile(documentPath);
      const fileSize = fileBuffer.length;

      // Upload to Storage
      const storagePath = `${this.pipelineJobId}/${operationIndex}_${operation}_${Date.now()}.docx`;

      const { error: uploadError } = await supabase.storage
        .from('pipeline-outputs')
        .upload(storagePath, fileBuffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: true
        });

      if (uploadError) {
        console.error(`[PIPELINE] Failed to upload intermediate document:`, uploadError);
        return;
      }

      // Save to database
      await supabase
        .from('pipeline_intermediate_documents')
        .insert({
          pipeline_job_id: this.pipelineJobId,
          operation_name: operation,
          operation_index: operationIndex,
          storage_path: storagePath,
          file_size_bytes: fileSize,
          operation_job_id: result.operationJobId,
          metadata: result.metadata
        });

      console.log(`[PIPELINE ${this.pipelineJobId}] Saved intermediate document: ${storagePath}`);

    } catch (error: any) {
      console.error(`[PIPELINE] Error saving intermediate document:`, error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Save operation result to job
   */
  private async saveOperationResult(result: OperationResult): Promise<void> {
    const job = await this.loadJob();
    const updatedResults = [...job.operation_results, result];

    await supabase
      .from('pipeline_jobs')
      .update({ operation_results: updatedResults })
      .eq('id', this.pipelineJobId);
  }

  /**
   * Mark pipeline as completed
   */
  private async completePipeline(finalDocumentPath: string): Promise<void> {
    const job = await this.loadJob();

    // Calculate total duration
    const startTime = new Date(job.started_at || job.created_at).getTime();
    const endTime = Date.now();
    const totalDuration = Math.round((endTime - startTime) / 1000);

    await supabase
      .from('pipeline_jobs')
      .update({
        status: 'completed',
        final_document_path: finalDocumentPath,
        total_duration_seconds: totalDuration,
        completed_at: new Date().toISOString()
      })
      .eq('id', this.pipelineJobId);
  }

  /**
   * Handle pipeline error
   */
  private async handleError(error: Error): Promise<void> {
    await supabase
      .from('pipeline_jobs')
      .update({
        status: 'failed',
        error_message: error.message,
        completed_at: new Date().toISOString()
      })
      .eq('id', this.pipelineJobId);
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async loadJob(): Promise<PipelineJob> {
    const { data, error } = await supabase
      .from('pipeline_jobs')
      .select('*')
      .eq('id', this.pipelineJobId)
      .single();

    if (error || !data) {
      throw new Error(`Pipeline job not found: ${this.pipelineJobId}`);
    }

    return data as PipelineJob;
  }

  private async updateStatus(status: PipelineStatus): Promise<void> {
    await supabase
      .from('pipeline_jobs')
      .update({ status })
      .eq('id', this.pipelineJobId);
  }

  private async updateCurrentOperation(index: number): Promise<void> {
    await supabase
      .from('pipeline_jobs')
      .update({ current_operation_index: index })
      .eq('id', this.pipelineJobId);
  }

  private async updateTimestamp(field: 'started_at' | 'completed_at'): Promise<void> {
    await supabase
      .from('pipeline_jobs')
      .update({ [field]: new Date().toISOString() })
      .eq('id', this.pipelineJobId);
  }

  private async incrementCost(cost: number): Promise<void> {
    const job = await this.loadJob();
    const newCost = (job.total_cost_usd || 0) + cost;

    await supabase
      .from('pipeline_jobs')
      .update({ total_cost_usd: newCost })
      .eq('id', this.pipelineJobId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for a sub-job to complete (poll until done)
   */
  private async waitForJobCompletion(operation: string, jobId: string): Promise<void> {
    const maxWaitTime = 30 * 60 * 1000; // 30 minutes max
    const pollInterval = 3000; // 3 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const job = await this.getJobStatus(operation, jobId);

      if (job.status === 'completed') {
        return;
      }

      if (job.status === 'error' || job.status === 'failed') {
        throw new Error(`${operation} job failed: ${job.error_message || 'Unknown error'}`);
      }

      await this.sleep(pollInterval);
    }

    throw new Error(`${operation} job timed out after 30 minutes`);
  }

  /**
   * Get status of a sub-job
   */
  private async getJobStatus(operation: string, jobId: string): Promise<any> {
    let endpoint = '';

    switch (operation) {
      case 'improve':
        endpoint = `/api/improve/${jobId}`;
        break;
      case 'update':
        endpoint = `/api/norms-update/${jobId}`;
        break;
      case 'translate':
        endpoint = `/api/translate/${jobId}`;
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    const apiUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
    const url = `${apiUrl}${endpoint}`;

    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Failed to get ${operation} job status`);
    }

    return await res.json();
  }

  /**
   * Get improve job details
   */
  private async getImproveJob(jobId: string): Promise<any> {
    const { data, error } = await supabase
      .from('improvement_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !data) {
      throw new Error('Failed to get improve job');
    }

    return data;
  }

  /**
   * Get norms-update job details
   */
  private async getNormsUpdateJob(jobId: string): Promise<any> {
    const { data, error } = await supabase
      .from('norms_update_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !data) {
      throw new Error('Failed to get norms-update job');
    }

    return data;
  }

  /**
   * Get translation job details
   */
  private async getTranslationJob(jobId: string): Promise<any> {
    const { data, error } = await supabase
      .from('translation_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !data) {
      throw new Error('Failed to get translation job');
    }

    return data;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Start pipeline execution in background
 */
export async function startPipelineExecution(pipelineJobId: string): Promise<void> {
  const engine = new PipelineEngine(pipelineJobId);

  // Execute in background (don't await)
  engine.execute().catch(error => {
    console.error(`[PIPELINE ${pipelineJobId}] Background execution error:`, error);
  });
}
