import Anthropic from '@anthropic-ai/sdk';
import type { LlmJsonRequest, LlmProvider } from '../llm.types';

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async completeJson(req: LlmJsonRequest<unknown>, jsonSchema: object, signal: AbortSignal): Promise<string> {
    const msg = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: req.maxOutputTokens ?? 1024,
        system:
          `${req.system}\n\nRespond with a single JSON object only, no prose and no code fences. ` +
          `It must match this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
        messages: [{ role: 'user', content: req.prompt }],
      },
      { signal },
    );
    const text = msg.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    // Tolerate stray prose or ```json fences around the object; zod validates the rest.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No JSON object in model output');
    return text.slice(start, end + 1);
  }
}
