import { GoogleGenAI } from '@google/genai';
import type { LlmJsonRequest, LlmProvider } from '../llm.types';

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async completeJson(
    req: LlmJsonRequest<unknown>,
    jsonSchema: object,
    signal: AbortSignal,
  ): Promise<string> {
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        abortSignal: signal,
      },
    });
    const text = res.text;
    if (!text) throw new Error('Empty response from Gemini');
    return text;
  }
}
