import { Global, Logger, Module } from '@nestjs/common';
import { AppConfig } from '../config/config.service';
import { LLM_PROVIDER, type LlmProvider } from './llm.types';
import { LlmService } from './llm.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { MockProvider } from './providers/mock.provider';

@Global()
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig): LlmProvider => {
        const provider: LlmProvider = (() => {
          switch (config.get('LLM_PROVIDER')) {
            case 'anthropic':
              return new AnthropicProvider(
                config.get('ANTHROPIC_API_KEY')!,
                config.get('ANTHROPIC_MODEL'),
              );
            case 'mock':
              return new MockProvider();
            default:
              return new GeminiProvider(config.get('GEMINI_API_KEY')!, config.get('GEMINI_MODEL'));
          }
        })();
        new Logger('LlmModule').log(`Using LLM provider "${provider.name}" (${provider.model})`);
        return provider;
      },
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
