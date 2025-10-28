import { NormReference, NormType } from './types';
import { randomUUID } from 'crypto';

/**
 * Detecta referências a normas, leis, decretos no documento usando IA
 */
export async function detectNormsInDocument(
  paragraphs: Array<{ text: string; index: number; chapterTitle?: string }>,
  provider: 'openai' | 'gemini',
  model: string,
  apiKey: string
): Promise<NormReference[]> {

  // Processa em batches de 20 parágrafos
  const batchSize = 20;
  const allReferences: NormReference[] = [];

  for (let i = 0; i < paragraphs.length; i += batchSize) {
    const batch = paragraphs.slice(i, i + batchSize);
    const batchText = batch.map((p, idx) => `[${i + idx}] ${p.text}`).join('\n\n');

    const prompt = `Você é um especialista em análise de documentos jurídicos e técnicos. Analise o texto abaixo e identifique TODAS as referências a normas, leis, decretos, portarias, resoluções e normas técnicas.

TIPOS DE NORMAS A IDENTIFICAR (com número/identificação específica):
1. LEIS: Lei nº 8.078/1990, Lei Federal 12.345/2020, Ley 123/2020, etc
2. DECRETOS: Decreto nº 10.024/2019, Real Decreto 456/2019, etc
3. PORTARIAS: Portaria nº 123/2021, etc
4. RESOLUÇÕES: Resolución nº 456/2022, etc
5. NORMAS ABNT: ABNT NBR 14724:2011, NBR ISO 9001:2015, etc
6. NORMAS ISO: ISO 9001:2015, ISO/IEC 27001:2013, etc
7. REGULAMENTOS COM NÚMERO: Regulamento (UE) 2016/679, Directiva 2011/16/UE, etc
8. TRATADOS/CONVENIOS ESPECÍFICOS: Convenio de Mutua Asistencia Administrativa en Materia Fiscal de la OCDE, etc

NÃO IDENTIFIQUE (falsos positivos):
❌ Menções genéricas a organizações: "OCDE", "UE", "ONU"
❌ Referências genéricas: "esta ley", "la legislación", "normas de la organización"
❌ Informes/relatórios: "informe de 1998", "informe de la OCDE"
❌ Artigos sem contexto: "artículo 6º" (a menos que seja parte de uma norma específica citada antes)
❌ Siglas sem número: "FATCA" (a menos que seja uma lei específica com número)

TEXTO PARA ANÁLISE:
---
${batchText}
---

Para cada referência encontrada, retorne JSON no formato:
{
  "references": [
    {
      "type": "lei|decreto|portaria|resolucao|abnt|iso|regulamento|outro",
      "number": "número da norma (ex: 8.078/1990, NBR 14724:2011)",
      "fullText": "texto completo como aparece (ex: Lei nº 8.078/1990)",
      "paragraphIndex": 0,
      "context": "trecho do texto ao redor (30-50 chars antes e depois)"
    }
  ]
}

REGRAS IMPORTANTES:
- Extraia APENAS referências explícitas a normas
- NÃO invente números ou referências que não existem
- Capture o texto EXATO como aparece no documento
- Se não houver referências, retorne: {"references": []}
- paragraphIndex deve corresponder ao número entre colchetes [X]

Retorne APENAS o JSON, sem texto adicional.`;

    try {
      let response: string;

      if (provider === 'openai') {
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey });

        const completion = await openai.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1, // Bem baixo para ser preciso
          max_tokens: 3000,
          response_format: { type: 'json_object' }
        });

        response = completion.choices[0]?.message?.content?.trim() || '{"references":[]}';
      } else {
        // Gemini
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const geminiModel = genAI.getGenerativeModel({
          model,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 3000,
          }
        });

        const result = await geminiModel.generateContent(prompt);
        response = result.response.text().trim();
      }

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[NORMS] AI returned non-JSON response:', response.substring(0, 200));
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const references = parsed.references || [];

      // Processa e valida referências
      for (const ref of references) {
        if (!ref.type || !ref.number || !ref.fullText) {
          console.warn('[NORMS] Skipping invalid reference:', ref);
          continue;
        }

        // A IA retorna o índice absoluto (número entre colchetes [X])
        const absoluteIndex = ref.paragraphIndex || 0;

        if (absoluteIndex >= paragraphs.length) {
          console.warn('[NORMS] Invalid paragraph index:', absoluteIndex);
          continue;
        }

        const paragraph = paragraphs[absoluteIndex];

        // Verifica se o texto realmente existe no parágrafo
        if (!paragraph.text.includes(ref.fullText)) {
          console.warn('[NORMS] Reference text not found in paragraph:', ref.fullText);
          continue;
        }

        allReferences.push({
          id: randomUUID(),
          type: ref.type as NormType,
          number: ref.number.trim(),
          fullText: ref.fullText.trim(),
          context: ref.context?.trim() || '',
          paragraphIndex: absoluteIndex,
          chapterTitle: paragraph.chapterTitle
        });
      }

    } catch (error: any) {
      console.error('[NORMS] Error detecting norms in batch:', error.message);
      // Continua com próximo batch mesmo em caso de erro
    }
  }

  console.log(`[NORMS] Detected ${allReferences.length} norm references`);
  return allReferences;
}

/**
 * Classifica o tipo de norma baseado em padrões comuns
 */
export function classifyNormType(text: string): NormType {
  const lower = text.toLowerCase();

  if (lower.includes('lei') && /\d+/.test(text)) return 'lei';
  if (lower.includes('decreto') && /\d+/.test(text)) return 'decreto';
  if (lower.includes('portaria') && /\d+/.test(text)) return 'portaria';
  if (lower.includes('resolução') || lower.includes('resolucao')) return 'resolucao';
  if (lower.includes('abnt') || lower.includes('nbr')) return 'abnt';
  if (lower.includes('iso')) return 'iso';
  if (lower.includes('regulamento')) return 'regulamento';

  return 'outro';
}
