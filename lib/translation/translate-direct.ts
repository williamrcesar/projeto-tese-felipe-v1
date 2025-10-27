import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { AIProvider } from '../ai/types';
import { state } from '../state';
import { protectElements, restoreElements, validatePlaceholders } from './validation-enhancer';
import { protectGlossaryTerms, restoreGlossaryTerms, DEFAULT_GLOSSARY, type GlossaryEntry } from './glossary';

/**
 * Retorna o máximo de tokens de output para cada provider
 * Usa sempre o máximo disponível - só quebra textos muito longos em outro lugar
 */
function getMaxTokens(provider: AIProvider): number {
  const MAX_TOKENS = {
    gemini: 8192,      // Usa máximo do Gemini
    openai: 16384,     // Usa máximo do OpenAI
    grok: 16384        // Usa máximo do Grok
  };

  return MAX_TOKENS[provider] || 8192;
}

/**
 * Verifica quais providers têm API keys configuradas
 */
function getAvailableProviders(): AIProvider[] {
  const available: AIProvider[] = [];

  if (state.settings.googleKey) available.push('gemini');
  if (state.settings.openaiKey) available.push('openai');
  if (state.settings.xaiKey) available.push('grok');

  return available;
}

/**
 * Traduz texto com fallback automático entre providers
 */
export async function translateTextDirect(
  text: string,
  targetLanguage: string,
  sourceLanguage: string | undefined,
  provider: AIProvider,
  model: string,
  glossary?: GlossaryEntry[]
): Promise<string> {
  let workingText = text;

  // 🛡️ STEP 1A: Protect glossary terms (if provided)
  let glossaryReplacements: Map<string, string> | undefined;
  if (glossary && glossary.length > 0) {
    const glossaryProtection = protectGlossaryTerms(workingText, glossary);
    workingText = glossaryProtection.protectedText;
    glossaryReplacements = glossaryProtection.replacements;
    console.log(`[GLOSSARY] Protected ${glossaryReplacements.size} glossary terms`);
  }

  // 🛡️ STEP 1B: Protect numbers, dates, and proper nouns
  const { protectedText, elements } = protectElements(workingText);
  const hasProtectedElements = elements.numbers.size > 0 || elements.dates.size > 0;

  if (hasProtectedElements) {
    console.log(`[PROTECT] Protected ${elements.numbers.size} numbers, ${elements.dates.size} dates`);
  }

  const prompt = `You are a PROFESSIONAL TRANSLATOR. Your ONLY job is to translate text WORD-BY-WORD with ABSOLUTE FIDELITY.

TARGET LANGUAGE: ${targetLanguage.toUpperCase()}
${sourceLanguage ? `SOURCE LANGUAGE: ${sourceLanguage.toUpperCase()}` : 'Auto-detect source language'}

CRITICAL RULES - VIOLATING ANY WILL RESULT IN FAILURE:
❌ DO NOT summarize, shorten, or condense the text
❌ DO NOT paraphrase or change sentence structure
❌ DO NOT add explanations, notes, or extra content
❌ DO NOT skip any sentences, paragraphs, or words
❌ DO NOT change the meaning or interpretation
❌ DO NOT merge words together - ALWAYS preserve spaces between words

✅ TRANSLATE EVERY SINGLE WORD faithfully
✅ PRESERVE exact same number of sentences
✅ PRESERVE exact same paragraph structure
✅ PRESERVE all line breaks and spacing
✅ PRESERVE all spaces between words - NEVER merge words
✅ IF you see " ║ " separator, you MUST preserve it EXACTLY as " ║ " in translation
✅ KEEP technical terms accurate (translate if appropriate, keep if universally used)
✅ MAINTAIN the same academic/formal tone
✅ Ensure proper spacing: each word must be separated by at least one space
${hasProtectedElements ? '✅ PRESERVE ALL PLACEHOLDERS like __NUM_0__, __DATE_1__ EXACTLY as they appear - DO NOT translate them!' : ''}
✅ Return ONLY the direct translation, nothing else

ORIGINAL TEXT (${protectedText.length} characters, ${protectedText.split(/[.!?]+/).length} sentences):
---
${protectedText}
---

TRANSLATION (must have similar length and same number of sentences, with proper spacing between ALL words${hasProtectedElements ? ', and KEEP all __NUM_X__ and __DATE_X__ placeholders' : ''}):`;

  // Define ordem de fallback: provider primário → openai → grok → gemini
  const availableProviders = getAvailableProviders();
  const fallbackOrder: AIProvider[] = [provider];

  // Adiciona outros providers disponíveis como fallback
  if (provider !== 'openai' && availableProviders.includes('openai')) {
    fallbackOrder.push('openai');
  }
  if (provider !== 'grok' && availableProviders.includes('grok')) {
    fallbackOrder.push('grok');
  }
  if (provider !== 'gemini' && availableProviders.includes('gemini')) {
    fallbackOrder.push('gemini');
  }

  let lastError: any;

  for (let i = 0; i < fallbackOrder.length; i++) {
    const currentProvider = fallbackOrder[i];
    const maxTokens = getMaxTokens(currentProvider);

    if (i === 0) {
      console.log(`[TRANSLATE] Text: ${text.length} chars → Using max tokens: ${maxTokens} (${currentProvider})`);
    } else {
      console.log(`[FALLBACK] Trying ${currentProvider} after ${fallbackOrder[i-1]} failed...`);
    }

    try {
      let result: string;

      if (currentProvider === 'gemini') {
        result = await translateWithGemini(prompt, model, maxTokens);
      } else if (currentProvider === 'openai') {
        // Usa modelo padrão do OpenAI se não especificado
        const openaiModel = currentProvider === provider ? model : 'gpt-4o-mini';
        result = await translateWithOpenAI(prompt, openaiModel, maxTokens);
      } else if (currentProvider === 'grok') {
        const grokModel = currentProvider === provider ? model : 'grok-beta';
        result = await translateWithGrok(prompt, grokModel, maxTokens);
      } else {
        throw new Error(`Unsupported provider: ${currentProvider}`);
      }

      // Sucesso!
      if (i > 0) {
        console.log(`[FALLBACK] ✓ Success with ${currentProvider}!`);
      }

      // 🛡️ STEP 2: Restore protected elements
      let finalResult = result;

      // Restore numbers and dates first
      if (hasProtectedElements) {
        const validation = validatePlaceholders(protectedText, finalResult, elements);
        if (!validation.valid) {
          console.warn(`[PROTECT] Validation warning: ${validation.missing.length} missing, ${validation.extra.length} extra placeholders`);
        }
        finalResult = restoreElements(finalResult, elements);
        console.log(`[PROTECT] Restored ${elements.numbers.size + elements.dates.size} protected elements`);
      }

      // Restore glossary terms last
      if (glossaryReplacements && glossaryReplacements.size > 0) {
        finalResult = restoreGlossaryTerms(finalResult, glossaryReplacements);
        console.log(`[GLOSSARY] Restored ${glossaryReplacements.size} glossary terms`);
      }

      return finalResult;

    } catch (error: any) {
      lastError = error;
      console.warn(`[FALLBACK] ✗ ${currentProvider} failed: ${error.message}`);

      // Se é o último provider, relança o erro
      if (i === fallbackOrder.length - 1) {
        throw lastError;
      }
      // Senão, tenta próximo provider
    }
  }

  throw lastError || new Error('All providers failed');
}

/**
 * Delay helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Traduz usando Gemini com retry e backoff exponencial
 */
async function translateWithGemini(prompt: string, model: string, maxTokens: number): Promise<string> {
  const apiKey = state.settings.googleKey;
  if (!apiKey) throw new Error('Google API key not configured');

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });

  const maxRetries = 2; // Reduzido de 5 para 2 - cai rápido pro fallback
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Delay progressivo apenas em retry
      if (attempt > 0) {
        const delayMs = 1000; // 1s fixo no retry
        console.log(`[GEMINI] ⏳ Retry ${attempt}/${maxRetries} after ${delayMs}ms delay...`);
        await sleep(delayMs);
      }

      const result = await geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: maxTokens
        }
      });

      const response = result.response;
      const text = response.text().trim();

      if (!text || text.length === 0) {
        // Resposta vazia não faz retry - cai direto pro fallback
        throw new Error('Gemini returned empty response (no retry)');
      }

      // Sucesso! Delay reduzido (0.8s suficiente)
      await sleep(800);

      return text;

    } catch (error: any) {
      lastError = error;

      // Se for resposta vazia, não tenta de novo - já vai pro fallback
      if (error.message?.includes('empty response')) {
        throw error;
      }
      const is503 = error.message?.includes('503') || error.message?.includes('overloaded');
      const is429 = error.message?.includes('429') || error.message?.includes('quota');

      if (is503 || is429) {
        console.warn(`[GEMINI] ⚠ Rate limit/Overload (attempt ${attempt + 1}/${maxRetries})`);
        // Continua para próxima tentativa
        continue;
      } else {
        // Erro diferente, não tenta novamente
        console.error('[GEMINI] ❌ Error:', error.message);
        throw error;
      }
    }
  }

  // Todas as tentativas falharam
  console.error('[GEMINI] ❌ Failed after', maxRetries, 'attempts');
  throw lastError;
}

/**
 * Traduz usando OpenAI
 */
async function translateWithOpenAI(prompt: string, model: string, maxTokens: number): Promise<string> {
  const apiKey = state.settings.openaiKey;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const openai = new OpenAI({ apiKey });

  const completion = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: maxTokens
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}

/**
 * Traduz usando Grok (xAI)
 */
async function translateWithGrok(prompt: string, model: string, maxTokens: number): Promise<string> {
  const apiKey = state.settings.xaiKey;
  if (!apiKey) throw new Error('xAI API key not configured');

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Grok API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content?.trim() || '';
}
