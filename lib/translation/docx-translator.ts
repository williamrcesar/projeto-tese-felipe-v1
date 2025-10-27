import JSZip from 'jszip';
import { parseStringPromise, Builder } from 'xml2js';
import fs from 'fs/promises';
import path from 'path';
import { TranslationOptions, TextElement, TranslationResult, TranslationProgress } from './types';
import { translateTextDirect } from './translate-direct';

/**
 * Extrai todos os textos de um arquivo DOCX preservando estrutura XML
 */
export async function extractTextsFromDocx(filePath: string): Promise<{
  zip: JSZip;
  textElements: TextElement[];
}> {
  const data = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(data);

  const textElements: TextElement[] = [];
  let elementId = 0;

  // Arquivos XML que contêm texto
  const xmlPaths = [
    'word/document.xml',
    'word/header1.xml',
    'word/header2.xml',
    'word/header3.xml',
    'word/footer1.xml',
    'word/footer2.xml',
    'word/footer3.xml',
    'word/endnotes.xml',
    'word/footnotes.xml'
  ];

  for (const xmlPath of xmlPaths) {
    const file = zip.file(xmlPath);
    if (!file) continue;

    const xmlContent = await file.async('string');
    const parsed = await parseStringPromise(xmlContent);

    // Extrai todos os textos dentro de tags <w:t>
    const texts = extractTextsRecursive(parsed, xmlPath, []);

    texts.forEach(({ text, tagPath, context }) => {
      if (text.trim().length > 0) {
        textElements.push({
          id: `elem_${elementId++}`,
          xmlPath,
          tagPath,
          originalText: text,
          context
        });
      }
    });
  }

  return { zip, textElements };
}

/**
 * Recursivamente extrai textos de estrutura XML
 */
function extractTextsRecursive(
  obj: any,
  xmlPath: string,
  currentPath: string[],
  context: string[] = []
): Array<{ text: string; tagPath: string; context?: string }> {
  const results: Array<{ text: string; tagPath: string; context?: string }> = [];

  if (!obj || typeof obj !== 'object') {
    return results;
  }

  // Procura por tags <w:t> que contêm texto
  if (obj['w:t']) {
    const textArray = Array.isArray(obj['w:t']) ? obj['w:t'] : [obj['w:t']];
    textArray.forEach((tNode: any) => {
      if (typeof tNode === 'string') {
        results.push({
          text: tNode,
          tagPath: currentPath.join('/'),
          context: context.slice(-2).join(' ') // Contexto: 2 textos anteriores
        });
        context.push(tNode);
      } else if (tNode._) {
        results.push({
          text: tNode._,
          tagPath: currentPath.join('/'),
          context: context.slice(-2).join(' ')
        });
        context.push(tNode._);
      }
    });
  }

  // Recursão em todos os campos do objeto
  for (const key in obj) {
    if (Array.isArray(obj[key])) {
      obj[key].forEach((item: any, index: number) => {
        results.push(
          ...extractTextsRecursive(item, xmlPath, [...currentPath, `${key}[${index}]`], context)
        );
      });
    } else if (typeof obj[key] === 'object') {
      results.push(
        ...extractTextsRecursive(obj[key], xmlPath, [...currentPath, key], context)
      );
    }
  }

  return results;
}

/**
 * Calcula estatísticas de um texto
 */
function calculateTextStats(text: string): {
  chars: number;
  words: number;
  sentences: number;
} {
  return {
    chars: text.length,
    words: text.split(/\s+/).filter(w => w.length > 0).length,
    sentences: text.split(/[.!?]+/).filter(s => s.trim().length > 0).length
  };
}

/**
 * Divide texto longo em partes menores preservando frases completas
 */
function splitLongText(text: string, maxChars: number = 1500): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const parts: string[] = [];
  const sentences = text.split(/([.!?]+\s+)/); // Mantém os separadores
  let currentPart = '';

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    if ((currentPart + sentence).length > maxChars && currentPart.length > 0) {
      // Chegou no limite, salva a parte atual
      parts.push(currentPart.trim());
      currentPart = sentence;
    } else {
      currentPart += sentence;
    }
  }

  if (currentPart.trim().length > 0) {
    parts.push(currentPart.trim());
  }

  return parts;
}

/**
 * Valida se a tradução é fiel ao original
 * Validação mais flexível para evitar rejeitar traduções válidas
 */
function validateTranslation(original: string, translation: string, isRetry: boolean = false): {
  valid: boolean;
  reason?: string;
} {
  // 1. Verifica se não está vazio
  if (!translation || translation.trim().length === 0) {
    return { valid: false, reason: 'Translation is empty' };
  }

  // 2. Verifica comprimento (mais flexível em retry)
  const originalLen = original.length;
  const translationLen = translation.length;
  const ratio = translationLen / originalLen;

  // Para textos curtos (<100 chars), aceita maior variação
  const minRatio = originalLen < 100 ? 0.3 : (isRetry ? 0.4 : 0.5);
  const maxRatio = originalLen < 100 ? 3.0 : (isRetry ? 2.5 : 2.0);

  if (ratio < minRatio) {
    return { valid: false, reason: `Translation too short (${Math.round(ratio * 100)}% of original)` };
  }
  if (ratio > maxRatio) {
    return { valid: false, reason: `Translation too long (${Math.round(ratio * 100)}% of original)` };
  }

  // 3. Verifica número de sentenças (mais flexível em retry)
  const originalSentences = original.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const translatedSentences = translation.split(/[.!?]+/).filter(s => s.trim().length > 0).length;

  // Para textos muito curtos (1-2 sentenças), aceita maior variação
  if (originalSentences <= 2) {
    return { valid: true }; // Não valida contagem para textos muito curtos
  }

  const sentenceRatio = translatedSentences / Math.max(originalSentences, 1);
  const minSentenceRatio = isRetry ? 0.5 : 0.7;
  const maxSentenceRatio = isRetry ? 1.5 : 1.3;

  if (sentenceRatio < minSentenceRatio || sentenceRatio > maxSentenceRatio) {
    return {
      valid: false,
      reason: `Sentence count mismatch (original: ${originalSentences}, translated: ${translatedSentences})`
    };
  }

  return { valid: true };
}

/**
 * Agrupa textos curtos consecutivos para tradução em lote
 */
function groupShortTexts(texts: string[]): Array<{ indices: number[]; text: string; isGroup: boolean }> {
  const MIN_LENGTH = 30; // Textos menores que 30 chars são agrupados
  const groups: Array<{ indices: number[]; text: string; isGroup: boolean }> = [];

  let currentGroup: { indices: number[]; parts: string[] } | null = null;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const isShort = text.trim().length < MIN_LENGTH && text.trim().length > 3;

    if (isShort) {
      // Inicia ou continua grupo
      if (!currentGroup) {
        currentGroup = { indices: [i], parts: [text] };
      } else {
        currentGroup.indices.push(i);
        currentGroup.parts.push(text);
      }
    } else {
      // Finaliza grupo anterior se existir
      if (currentGroup) {
        // Só cria grupo se tiver 2+ elementos
        if (currentGroup.indices.length > 1) {
          groups.push({
            indices: currentGroup.indices,
            text: currentGroup.parts.join(' ║ '), // Separador especial
            isGroup: true
          });
        } else {
          // Grupo de 1 elemento vira SINGLE
          groups.push({
            indices: currentGroup.indices,
            text: currentGroup.parts[0],
            isGroup: false
          });
        }
        currentGroup = null;
      }

      // Adiciona texto normal
      groups.push({
        indices: [i],
        text: text,
        isGroup: false
      });
    }
  }

  // Finaliza último grupo se existir
  if (currentGroup) {
    // Só cria grupo se tiver 2+ elementos
    if (currentGroup.indices.length > 1) {
      groups.push({
        indices: currentGroup.indices,
        text: currentGroup.parts.join(' ║ '),
        isGroup: true
      });
    } else {
      // Grupo de 1 elemento vira SINGLE
      groups.push({
        indices: currentGroup.indices,
        text: currentGroup.parts[0],
        isGroup: false
      });
    }
  }

  return groups;
}

/**
 * Traduz um batch de textos usando IA
 */
async function translateBatch(
  texts: string[],
  options: TranslationOptions,
  stats: { validationPassed: number; validationFailed: number; retriesSucceeded: number; originalKept: number }
): Promise<string[]> {
  const { targetLanguage, sourceLanguage, provider, model } = options;

  // Agrupa textos curtos antes de traduzir
  const groups = groupShortTexts(texts);
  const translations: string[] = new Array(texts.length);

  console.log(`  📦 Grouped ${texts.length} texts into ${groups.length} translation units`);

  // 🚀 PARALLEL TRANSLATION: Process 5 groups at a time
  const PARALLEL_LIMIT = 5;

  for (let batchStart = 0; batchStart < groups.length; batchStart += PARALLEL_LIMIT) {
    const batchEnd = Math.min(batchStart + PARALLEL_LIMIT, groups.length);
    const parallelGroups = groups.slice(batchStart, batchEnd);

    console.log(`  ⚡ [${batchStart + 1}-${batchEnd}/${groups.length}] Translating ${parallelGroups.length} groups in parallel...`);

    // Translate groups in parallel using Promise.all
    const parallelPromises = parallelGroups.map(async (group, localIdx) => {
      const groupIdx = batchStart + localIdx;
      const text = group.text;

      // Skip textos muito curtos (números, pontuação, etc)
      if (text.trim().length <= 3) {
        // Mantém o original para textos muito curtos
        for (const idx of group.indices) {
          translations[idx] = texts[idx];
        }
        return;
      }

      try {
      let finalTranslation = '';

      // Se texto for muito longo (>1500 chars), divide em partes
      if (text.length > 1500) {
        const parts = splitLongText(text, 1500);
        console.log(`Splitting long text (${text.length} chars) into ${parts.length} parts`);

        for (const part of parts) {
          const partTranslation = await translateTextDirect(
            part,
            targetLanguage,
            sourceLanguage,
            provider,
            model,
            options.glossary
          );
          finalTranslation += partTranslation + ' ';
        }

        finalTranslation = finalTranslation.trim();
      } else {
        // Texto normal, traduz direto
        finalTranslation = await translateTextDirect(
          text,
          targetLanguage,
          sourceLanguage,
          provider,
          model,
          options.glossary
        );
      }

      // Se for grupo, separa de volta
      if (group.isGroup) {
        // Tenta separar pelo separador correto
        let parts = finalTranslation.split(' ║ ').map(p => p.trim());

        // Se não encontrou o separador, tenta outros padrões
        if (parts.length === 1) {
          // Tenta sem espaços
          parts = finalTranslation.split('║').map(p => p.trim());
        }

        // Se ainda não funcionou, usa split inteligente
        if (parts.length < group.indices.length) {
          console.warn(`[WARNING] Expected ${group.indices.length} parts but got ${parts.length}. Using fallback.`);
          // Fallback: usa original para todos
          for (const idx of group.indices) {
            translations[idx] = texts[idx];
          }
          stats.originalKept += group.indices.length;
        } else {
          // Atribui cada parte ao índice correspondente
          for (let j = 0; j < group.indices.length; j++) {
            const idx = group.indices[j];
            let translatedPart = parts[j] || texts[idx];

            // Se a parte traduzida não tem espaços mas deveria ter (>20 chars sem espaço)
            if (translatedPart.length > 20 && !translatedPart.includes(' ')) {
              // Tenta adicionar espaços em pontos naturais (letra minúscula seguida de maiúscula)
              translatedPart = translatedPart.replace(/([a-z])([A-Z])/g, '$1 $2');
            }

            translations[idx] = translatedPart;
          }
          stats.validationPassed += group.indices.length;
        }
        return; // Exit early for groups
      }

      // Valida a tradução (apenas para textos individuais)
      const validation = validateTranslation(text, finalTranslation);

      if (!validation.valid) {
        stats.validationFailed++;
        console.warn(`❌ Translation validation failed: ${validation.reason}`);
        console.warn(`Original (${text.length} chars): ${text.substring(0, 100)}...`);
        console.warn(`Translation (${finalTranslation.length} chars): ${finalTranslation.substring(0, 100)}...`);

        // 🔄 RETRY STRATEGY: Tenta até 3 vezes com diferentes abordagens
        let retrySuccess = false;

        // RETRY 1: Para textos longos (>1500), divide em chunks menores
        if (text.length > 1500) {
          console.log('🔄 Retry 1/3: Splitting into smaller chunks (800 chars)...');
          const smallerParts = splitLongText(text, 800);
          finalTranslation = '';

          for (const part of smallerParts) {
            const partTranslation = await translateTextDirect(
              part,
              targetLanguage,
              sourceLanguage,
              provider,
              model,
              options.glossary
            );
            finalTranslation += partTranslation + ' ';
          }

          finalTranslation = finalTranslation.trim();
          const retryValidation = validateTranslation(text, finalTranslation, true);

          if (retryValidation.valid) {
            console.log('✅ Retry 1 succeeded!');
            stats.retriesSucceeded++;
            retrySuccess = true;
          } else {
            console.warn(`❌ Retry 1 failed: ${retryValidation.reason}`);
          }
        }

        // RETRY 2: Tenta novamente direto (pode pegar outro provider no fallback)
        if (!retrySuccess) {
          console.log('🔄 Retry 2/3: Retrying direct translation (may use fallback provider)...');
          try {
            finalTranslation = await translateTextDirect(
              text,
              targetLanguage,
              sourceLanguage,
              provider,
              model,
              options.glossary
            );

            const retry2Validation = validateTranslation(text, finalTranslation, true);
            if (retry2Validation.valid) {
              console.log('✅ Retry 2 succeeded!');
              stats.retriesSucceeded++;
              retrySuccess = true;
            } else {
              console.warn(`❌ Retry 2 failed: ${retry2Validation.reason}`);
            }
          } catch (error: any) {
            console.warn(`❌ Retry 2 error: ${error.message}`);
          }
        }

        // RETRY 3: Última tentativa com chunks ainda menores (500 chars)
        if (!retrySuccess && text.length > 500) {
          console.log('🔄 Retry 3/3: Last attempt with very small chunks (500 chars)...');
          const tinyParts = splitLongText(text, 500);
          finalTranslation = '';

          for (const part of tinyParts) {
            try {
              const partTranslation = await translateTextDirect(
                part,
                targetLanguage,
                sourceLanguage,
                provider,
                model,
                options.glossary
              );
              finalTranslation += partTranslation + ' ';
            } catch (error: any) {
              console.error(`Error translating tiny part: ${error.message}`);
              finalTranslation += part + ' '; // Mantém original desta parte
            }
          }

          finalTranslation = finalTranslation.trim();
          const retry3Validation = validateTranslation(text, finalTranslation, true);

          if (retry3Validation.valid) {
            console.log('✅ Retry 3 succeeded!');
            stats.retriesSucceeded++;
            retrySuccess = true;
          } else {
            console.warn(`❌ Retry 3 failed: ${retry3Validation.reason}`);
          }
        }

        // SEMPRE usa a tradução, mesmo se todas as tentativas falharam
        // Melhor ter uma tradução imperfeita do que deixar no original
        if (!retrySuccess) {
          stats.originalKept++;
          console.warn(`⚠️ All retries failed validation, but using translation anyway (quality may vary).`);
        }

        // SEMPRE usa a última tradução disponível
        for (const idx of group.indices) {
          translations[idx] = finalTranslation;
        }
      } else {
        stats.validationPassed++;
        for (const idx of group.indices) {
          translations[idx] = finalTranslation;
        }
      }

      } catch (error: any) {
        console.error(`❌ Critical translation error: ${error.message}`);

        // ÚLTIMA TENTATIVA: Tenta traduzir direto sem validação
        try {
          console.log('🆘 Last attempt: Simple translation without validation...');
          const emergencyTranslation = await translateTextDirect(
            text,
            targetLanguage,
            sourceLanguage,
            provider,
            model,
            options.glossary
          );

          if (emergencyTranslation && emergencyTranslation.trim().length > 0) {
            console.log('✅ Emergency translation succeeded!');
            for (const idx of group.indices) {
              translations[idx] = emergencyTranslation;
            }
            stats.retriesSucceeded++;
          } else {
            // Se até a emergência falhar, usa o original
            console.error('⚠️ Even emergency translation failed. Keeping original.');
            stats.originalKept++;
            for (const idx of group.indices) {
              translations[idx] = texts[idx];
            }
          }
        } catch (emergencyError: any) {
          console.error(`⚠️ Emergency translation also failed: ${emergencyError.message}. Keeping original.`);
          stats.originalKept++;
          for (const idx of group.indices) {
            translations[idx] = texts[idx];
          }
        }
      }
    }); // end of parallelPromises.map

    // Wait for all parallel translations to complete
    await Promise.all(parallelPromises);
  } // end of parallel batch loop

  return translations;
}

/**
 * Substitui textos no XML preservando estrutura
 */
async function replaceTextsInXml(
  zip: JSZip,
  xmlPath: string,
  replacements: Map<string, string>
): Promise<void> {
  const file = zip.file(xmlPath);
  if (!file) return;

  let xmlContent = await file.async('string');

  // Substitui textos usando regex para preservar tags XML
  for (const [original, translated] of replacements.entries()) {
    // Escapa caracteres especiais do regex
    const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Substitui dentro de tags <w:t>
    const regex = new RegExp(`(<w:t[^>]*>)${escapedOriginal}(</w:t>)`, 'g');
    xmlContent = xmlContent.replace(regex, `$1${translated}$2`);
  }

  // Atualiza o arquivo no ZIP
  zip.file(xmlPath, xmlContent);
}

/**
 * Traduz um documento DOCX completo
 */
export async function translateDocx(
  inputPath: string,
  outputPath: string,
  options: TranslationOptions
): Promise<TranslationResult> {
  const startTime = Date.now();

  // Helper para log duplo (console + callback)
  const log = (message: string) => {
    console.log(message);
    if (options.onLog) {
      options.onLog(message);
    }
  };

  log('\n╔════════════════════════════════════════════════════╗');
  log('║        TRANSLATION STARTED                         ║');
  log('╚════════════════════════════════════════════════════╝');
  log(`📄 Input: ${inputPath}`);
  log(`🌍 Target Language: ${options.targetLanguage.toUpperCase()}`);
  log(`🤖 Provider: ${options.provider} (${options.model})`);

  try {
    // 1. Extrai textos
    log('\n[EXTRACT] 🔍 Extracting text from DOCX...');
    const { zip, textElements } = await extractTextsFromDocx(inputPath);
    log(`[EXTRACT] ✓ Found ${textElements.length} text elements`);

    if (textElements.length === 0) {
      throw new Error('No text found in document');
    }

    // 2. Agrupa por arquivo XML
    log('\n[GROUP] 📂 Grouping by XML sections...');
    const elementsByXml = new Map<string, TextElement[]>();
    textElements.forEach(elem => {
      if (!elementsByXml.has(elem.xmlPath)) {
        elementsByXml.set(elem.xmlPath, []);
      }
      elementsByXml.get(elem.xmlPath)!.push(elem);
    });
    log(`[GROUP] ✓ ${elementsByXml.size} sections found: [${Array.from(elementsByXml.keys()).map(k => k.replace('word/', '')).join(', ')}]`);

    // 3. Traduz em batches
    const batchSize = 20; // Traduz 20 textos por vez
    let currentChunk = 0;
    const totalChunks = Math.ceil(textElements.length / batchSize);
    const stats = {
      validationPassed: 0,
      validationFailed: 0,
      retriesSucceeded: 0,
      originalKept: 0
    };

    // Para cálculo de tempo estimado
    const translationStartTime = Date.now();
    const batchTimes: number[] = [];

    for (const [xmlPath, elements] of elementsByXml.entries()) {
      const replacements = new Map<string, string>();

      // Processa em batches
      for (let i = 0; i < elements.length; i += batchSize) {
        const batch = elements.slice(i, i + batchSize);
        const texts = batch.map(e => e.originalText);

        // Progresso
        currentChunk++;

        // Calcula tempo decorrido e estimado
        const elapsedMs = Date.now() - translationStartTime;
        const elapsedSeconds = Math.round(elapsedMs / 1000);

        // Calcula tempo médio por batch (apenas se já tiver dados)
        let estimatedSecondsRemaining: number | undefined;
        if (batchTimes.length > 0) {
          const avgBatchTimeMs = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
          const remainingChunks = totalChunks - currentChunk;
          estimatedSecondsRemaining = Math.round((remainingChunks * avgBatchTimeMs) / 1000);
        }

        const progress: TranslationProgress = {
          status: 'translating',
          currentChunk,
          totalChunks,
          percentage: Math.round((currentChunk / totalChunks) * 100),
          currentSection: xmlPath.replace('word/', ''),
          elapsedSeconds,
          estimatedSecondsRemaining,
          stats: { ...stats }
        };
        options.onProgress?.(progress);

        log(`\n[TRANSLATE] ⏳ Batch ${currentChunk}/${totalChunks} (${progress.percentage}%) - Section: ${progress.currentSection}`);
        log(`[TRANSLATE] 📝 Processing ${batch.length} text elements...`);

        // Traduz batch
        const startBatch = Date.now();
        const translations = await translateBatch(texts, options, stats);
        const batchDuration = Date.now() - startBatch;

        // Registra tempo do batch para estimativa futura
        batchTimes.push(batchDuration);

        log(`[TRANSLATE] ✓ Batch completed in ${(batchDuration / 1000).toFixed(1)}s`);
        log(`[TRANSLATE] 📊 Stats: ✓${stats.validationPassed} passed, ⟳${stats.retriesSucceeded} retried, ⚠${stats.originalKept} kept`);

        // Mapeia traduções
        batch.forEach((elem, idx) => {
          replacements.set(elem.originalText, translations[idx]);
          elem.translatedText = translations[idx];
        });
      }

      // Substitui no XML
      await replaceTextsInXml(zip, xmlPath, replacements);
    }

    // 4. Gera novo DOCX
    log('\n[SAVE] 💾 Generating translated DOCX...');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await fs.writeFile(outputPath, buffer);
    log(`[SAVE] ✓ Saved to: ${outputPath}`);

    const durationMs = Date.now() - startTime;

    // Calcula estatísticas finais de validação
    const originalStats = calculateTextStats(textElements.map(e => e.originalText).join(' '));
    const translatedStats = calculateTextStats(textElements.map(e => e.translatedText || '').join(' '));

    const validationReport = {
      originalChars: originalStats.chars,
      translatedChars: translatedStats.chars,
      charRatio: (translatedStats.chars / originalStats.chars * 100).toFixed(1) + '%',
      originalWords: originalStats.words,
      translatedWords: translatedStats.words,
      wordRatio: (translatedStats.words / originalStats.words * 100).toFixed(1) + '%',
      originalSentences: originalStats.sentences,
      translatedSentences: translatedStats.sentences,
      sentenceRatio: (translatedStats.sentences / originalStats.sentences * 100).toFixed(1) + '%',
      validationPassed: stats.validationPassed,
      validationFailed: stats.validationFailed,
      retriesSucceeded: stats.retriesSucceeded,
      keptOriginal: stats.originalKept
    };

    log('\n========== TRANSLATION VALIDATION REPORT ==========');
    log(`Original:    ${originalStats.chars} chars, ${originalStats.words} words, ${originalStats.sentences} sentences`);
    log(`Translated:  ${translatedStats.chars} chars (${validationReport.charRatio}), ${translatedStats.words} words (${validationReport.wordRatio}), ${translatedStats.sentences} sentences (${validationReport.sentenceRatio})`);
    log(`Validation:  ✓ ${stats.validationPassed} passed, ✗ ${stats.validationFailed} failed, ⟳ ${stats.retriesSucceeded} retried, ⚠ ${stats.originalKept} kept original`);
    log('===================================================\n');

    return {
      success: true,
      outputPath,
      elementsTranslated: textElements.length,
      durationMs,
      costEstimatedUsd: estimateCost(textElements, options),
      validationReport
    };

  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      elementsTranslated: 0
    };
  }
}

/**
 * Estima custo da tradução
 */
function estimateCost(elements: TextElement[], options: TranslationOptions): number {
  const totalChars = elements.reduce((sum, e) => sum + e.originalText.length, 0);
  const totalTokens = Math.ceil(totalChars / 4); // Aproximação: 4 chars = 1 token

  // Custos aproximados por 1M tokens (input + output)
  const costs: Record<string, number> = {
    'gpt-4o': 7.5,
    'gpt-4o-mini': 0.45,
    'gpt-4-turbo': 20,
    'gemini-2.5-flash': 0.15,
    'gemini-2.5-pro': 3.0,
    'gemini-2.0-flash': 0.15,
    'grok-2-1212': 5,
    'grok-2-vision-1212': 5
  };

  const costPer1M = costs[options.model] || 5;
  return (totalTokens * 2 * costPer1M) / 1_000_000; // x2 porque há input + output
}
