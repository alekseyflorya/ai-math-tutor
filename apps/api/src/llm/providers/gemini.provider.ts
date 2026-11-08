import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from '@google/genai';
import type { LlmJsonRequest, LlmProvider } from '../llm.types';

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;
  /** Primary model first, then fallbacks (free-tier models are sometimes overloaded). */
  private readonly models: string[];

  constructor(apiKey: string, models: string) {
    // v1beta: structured output via responseJsonSchema and the newest models live there.
    this.client = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
    this.models = models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (this.models.length === 0) throw new Error('GEMINI_MODEL is empty');
  }

  get model(): string {
    return this.models.join(',');
  }

  async completeJson(
    req: LlmJsonRequest<unknown>,
    jsonSchema: object,
    signal: AbortSignal,
    attempt = 0,
  ): Promise<string> {
    const model = this.models[Math.min(attempt, this.models.length - 1)]!;
    const res = await this.client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        thinkingConfig: thinkingFor(model),
        abortSignal: signal,
      },
    });
    const text = res.text;
    if (!text) throw new Error(`Empty response from ${model}`);
    return text;
  }
}

/**
 * Tutor turns are short and the math is pre-computed by the engine, so long
 * "thinking" only adds latency. Gemini 3 models take a level; 2.5 models a budget.
 */
function thinkingFor(model: string): ThinkingConfig | undefined {
  if (/^gemini-3/.test(model)) return { thinkingLevel: ThinkingLevel.LOW };
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  return undefined;
}
