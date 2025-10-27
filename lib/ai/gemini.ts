import { GoogleGenerativeAI } from '@google/generative-ai';
import { ChatRequest, AIResponse } from './types';
import { buildSystemPrompt, buildUserPrompt, extractCitations } from './prompts';
import { state } from '../state';

export async function executeGemini(
  request: ChatRequest,
  apiKey: string
): Promise<AIResponse> {
  const startTime = Date.now();

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: request.model });

  const systemPrompt = buildSystemPrompt(request.action);
  const userPrompt = buildUserPrompt(request.question, request.context);

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2000
        }
      });

      const latencyMs = Date.now() - startTime;
      const response = result.response;
      const text = response.text();

      // Estimativa de tokens
      const tokensIn = Math.round(fullPrompt.length / 4);
      const tokensOut = Math.round(text.length / 4);

      const pricing = state.settings.pricesUSD[request.model] ?? { in: 0, out: 0 };
      const costEstimatedUsd = (tokensIn / 1000) * pricing.in + (tokensOut / 1000) * pricing.out;

      const citations = extractCitations(text);

      return {
        provider: 'gemini',
        model: request.model,
        text,
        citations,
        latencyMs,
        tokensIn,
        tokensOut,
        costEstimatedUsd
      };
    } catch (error: any) {
      attempts++;
      if (attempts >= maxAttempts) {
        throw new Error(`Gemini error: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  throw new Error('Gemini execution failed after retries');
}
