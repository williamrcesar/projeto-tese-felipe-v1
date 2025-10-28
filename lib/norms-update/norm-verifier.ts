import { NormReference, NormStatus, UpdateType } from './types';

/**
 * Verifica o status de uma norma usando IA (com web search para Gemini)
 * Esta função roda no SERVIDOR (API route)
 */
export async function verifyNormStatus(
  reference: NormReference,
  provider: 'openai' | 'gemini',
  model: string,
  apiKey: string,
  webSearchFn?: (query: string) => Promise<string> // Opcional - só para OpenAI
): Promise<NormReference> {

  console.log(`[NORMS] Verifying: ${reference.type} ${reference.number}`);

  try {
    let searchResults = '';

    // Se for OpenAI, precisa de web search manual
    if (provider === 'openai' && webSearchFn) {
      const searchQuery = buildSearchQuery(reference);
      console.log(`[NORMS] Searching: ${searchQuery}`);
      searchResults = await webSearchFn(searchQuery);
    } else if (provider === 'gemini') {
      console.log(`[NORMS] Using Gemini with Google Search grounding`);
      // Gemini faz busca automaticamente via grounding
    }

    // Usa IA para analisar (Gemini busca automaticamente, OpenAI usa searchResults)
    const analysis = await analyzeSearchResults(
      reference,
      searchResults,
      provider,
      model,
      apiKey
    );

    return {
      ...reference,
      ...analysis
    };

  } catch (error: any) {
    console.error(`[NORMS] Error verifying ${reference.number}:`, {
      message: error.message,
      stack: error.stack,
      fullError: error
    });
    return {
      ...reference,
      status: 'desconhecido',
      updateType: 'manual',
      updateDescription: `Erro na verificação: ${error.message}`
    };
  }
}

/**
 * Constrói query de busca otimizada por tipo de norma
 */
function buildSearchQuery(reference: NormReference): string {
  const { type, number } = reference;

  switch (type) {
    case 'lei':
      return `Lei ${number} Brasil vigente revogada alterada site:planalto.gov.br OR site:gov.br`;

    case 'decreto':
      return `Decreto ${number} Brasil vigente revogada site:planalto.gov.br OR site:gov.br`;

    case 'portaria':
      return `Portaria ${number} Brasil vigente revogada site:gov.br`;

    case 'resolucao':
      return `Resolução ${number} vigente revogada site:gov.br`;

    case 'abnt':
      return `ABNT ${number} cancelada substituída atualizada site:abnt.org.br OR site:inmetro.gov.br`;

    case 'iso':
      return `ISO ${number} withdrawn superseded updated site:iso.org`;

    case 'regulamento':
      return `Regulamento ${number} vigente revogado`;

    default:
      return `${reference.fullText} vigente revogada atualizada`;
  }
}

/**
 * Analisa status da norma usando IA com web search
 */
async function analyzeSearchResults(
  reference: NormReference,
  searchResults: string,
  provider: 'openai' | 'gemini',
  model: string,
  apiKey: string
): Promise<Partial<NormReference>> {

  const isPaid = reference.type === 'abnt' || reference.type === 'iso';

  // Para Gemini, usa grounding (Google Search) ao invés de web search manual
  const prompt = `Você é um especialista em análise de normas jurídicas e técnicas. ${provider === 'gemini' ? 'Use Google Search para verificar' : 'Analise os resultados de busca abaixo e determine'} o status da seguinte norma:

NORMA ANALISADA:
Tipo: ${reference.type}
Número: ${reference.number}
Texto: ${reference.fullText}

${provider === 'gemini' ? 'INSTRUÇÕES: Faça uma pesquisa na web para verificar o status atual desta norma. Procure em sites oficiais como planalto.gov.br, eur-lex.europa.eu, boe.es, abnt.org.br, iso.org, etc.' : `RESULTADOS DA BUSCA:\n---\n${searchResults.substring(0, 4000)}\n---`}

Determine:
1. STATUS atual da norma:
   - "vigente": Norma está em vigor sem alterações
   - "alterada": Norma está em vigor mas foi modificada/atualizada
   - "revogada": Norma foi revogada/cancelada
   - "substituida": Norma foi substituída por outra
   - "desconhecido": Não há informação suficiente

2. Se foi ALTERADA ou SUBSTITUÍDA:
   - Qual o número/identificação da nova versão?
   - Quando foi alterada/substituída?
   - Breve descrição da mudança

3. TIPO DE ATUALIZAÇÃO necessária:
   - "auto": Pode atualizar automaticamente (leis/decretos públicos)
   - "manual": Requer verificação manual (normas ABNT/ISO pagas)
   - "none": Não precisa atualização (está vigente)

4. Se possível ATUALIZAR AUTOMATICAMENTE:
   - Sugira o texto atualizado para substituir no documento
   - Ex: "Lei nº 8.078/1990 (alterada pela Lei 14.181/2021)"

IMPORTANTE:
- Normas ABNT/ISO são PAGAS → sempre "manual"
- Leis/Decretos brasileiros são PÚBLICOS → pode ser "auto"
- Se não tiver certeza, marque como "desconhecido"
- URL oficial da fonte (se disponível)

Retorne APENAS JSON válido no formato:
{
  "status": "vigente|alterada|revogada|substituida|desconhecido",
  "updatedNumber": "número da versão atualizada (se houver)",
  "updatedDate": "data da atualização (se disponível)",
  "updateDescription": "descrição breve da mudança",
  "updateType": "auto|manual|none",
  "sourceUrl": "URL oficial da fonte",
  "isPaid": ${isPaid},
  "suggestedText": "texto sugerido para substituição (se updateType = auto)",
  "confidence": 0.95
}`;

  let response: string;

  if (provider === 'openai') {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    response = completion.choices[0]?.message?.content?.trim() || '{}';
  } else {
    // Gemini com Google Search (grounding)
    console.log(`[NORMS] Initializing Gemini with model: ${model}`);

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1000,
          responseMimeType: 'application/json'
        },
        tools: [{
          googleSearchRetrieval: {
            dynamicRetrievalConfig: {
              mode: 'MODE_DYNAMIC',
              dynamicThreshold: 0.3
            }
          }
        }]
      });

      console.log(`[NORMS] Calling Gemini API for ${reference.number}...`);
      const result = await geminiModel.generateContent(prompt);

      console.log(`[NORMS] Gemini API response received for ${reference.number}`);
      console.log(`[NORMS] Raw response:`, JSON.stringify(result.response, null, 2));

      response = result.response.text().trim();
      console.log(`[NORMS] Parsed text response:`, response);

    } catch (geminiError: any) {
      console.error(`[NORMS] Gemini API Error for ${reference.number}:`, {
        message: geminiError.message,
        stack: geminiError.stack,
        fullError: geminiError
      });
      throw geminiError; // Re-throw to be caught by outer try-catch
    }
  }

  // Parse JSON
  console.log(`[NORMS] Parsing JSON response for ${reference.number}...`);
  const jsonMatch = response.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    console.warn(`[NORMS] No JSON found in response for ${reference.number}. Raw response:`, response);
    return {
      status: 'desconhecido',
      updateType: 'manual',
      updateDescription: 'Resposta da IA não contém JSON válido',
      isPaid
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  console.log(`[NORMS] Parsed JSON for ${reference.number}:`, parsed);

  const result = {
    status: parsed.status as NormStatus || 'desconhecido',
    updatedNumber: parsed.updatedNumber,
    updatedDate: parsed.updatedDate,
    updateDescription: parsed.updateDescription,
    updateType: parsed.updateType as UpdateType || 'manual',
    sourceUrl: parsed.sourceUrl,
    isPaid: parsed.isPaid || isPaid,
    suggestedText: parsed.suggestedText,
    confidence: parsed.confidence || 0.5
  };

  console.log(`[NORMS] Verification result for ${reference.number}:`, result);
  return result;
}

/**
 * Verifica múltiplas normas em paralelo (com rate limiting)
 */
export async function verifyMultipleNorms(
  references: NormReference[],
  provider: 'openai' | 'gemini',
  model: string,
  apiKey: string,
  webSearchFn?: (query: string) => Promise<string>,
  onProgress?: (current: number, total: number) => void
): Promise<NormReference[]> {

  const results: NormReference[] = [];
  const batchSize = 2; // Processa 2 por vez (Gemini tem rate limit)

  for (let i = 0; i < references.length; i += batchSize) {
    const batch = references.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(ref => verifyNormStatus(ref, provider, model, apiKey, webSearchFn))
    );

    results.push(...batchResults);

    if (onProgress) {
      onProgress(Math.min(i + batchSize, references.length), references.length);
    }

    // Pequeno delay entre batches
    if (i + batchSize < references.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}
