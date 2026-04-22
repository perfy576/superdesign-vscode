export type ModelImageSupport = 'supported' | 'unsupported' | 'unknown';

export interface ModelCatalogEntry {
    id: string;
    name: string;
    provider: string;
    category: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
    { id: 'claude-4-opus-20250514', name: 'Claude 4 Opus', provider: 'Anthropic', category: 'Premium' },
    { id: 'claude-4-sonnet-20250514', name: 'Claude 4 Sonnet', provider: 'Anthropic', category: 'Balanced' },
    { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'Anthropic', category: 'Balanced' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', category: 'Balanced' },
    { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'OpenRouter (Google)', category: 'Balanced' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B', provider: 'OpenRouter (Meta)', category: 'Balanced' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', provider: 'OpenRouter (DeepSeek)', category: 'Balanced' },
    { id: 'mistralai/mistral-small-3.2-24b-instruct-2506', name: 'Mistral Small 3.2 24B', provider: 'OpenRouter (Mistral)', category: 'Balanced' },
    { id: 'x-ai/grok-3', name: 'Grok 3', provider: 'OpenRouter (xAI)', category: 'Balanced' },
    { id: 'qwen/qwen3-235b-a22b-04-28', name: 'Qwen3 235B', provider: 'OpenRouter (Qwen)', category: 'Balanced' },
    { id: 'perplexity/sonar-reasoning-pro', name: 'Sonar Reasoning Pro', provider: 'OpenRouter (Perplexity)', category: 'Balanced' },
    { id: 'microsoft/phi-4-reasoning-plus-04-30', name: 'Phi-4 Reasoning Plus', provider: 'OpenRouter (Microsoft)', category: 'Balanced' },
    { id: 'nvidia/llama-3.3-nemotron-super-49b-v1', name: 'Llama 3.3 Nemotron Super 49B', provider: 'OpenRouter (NVIDIA)', category: 'Balanced' },
    { id: 'cohere/command-a-03-2025', name: 'Command A', provider: 'OpenRouter (Cohere)', category: 'Balanced' },
    { id: 'amazon/nova-pro-v1', name: 'Nova Pro', provider: 'OpenRouter (Amazon)', category: 'Balanced' },
    { id: 'inflection/inflection-3-productivity', name: 'Inflection 3 Productivity', provider: 'OpenRouter (Inflection)', category: 'Balanced' },
    { id: 'rekaai/reka-flash-3', name: 'Reka Flash 3', provider: 'OpenRouter (Reka)', category: 'Balanced' },
    { id: 'x-ai/grok-code-fast-1', name: 'Grok Code Fast 1', provider: 'OpenRouter (xAI)', category: 'Fast' },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'OpenRouter (Anthropic)', category: 'Balanced' },
    { id: 'deepseek/deepseek-chat-v3.1:free', name: 'DeepSeek Chat V3.1 Free', provider: 'OpenRouter (DeepSeek)', category: 'Balanced' },
    { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI', category: 'Balanced' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'OpenAI', category: 'Fast' }
];

const SUPPORTED_MODEL_PATTERNS: RegExp[] = [
    /^claude-/i,
    /^anthropic\/claude/i,
    /^gpt-4\.1/i,
    /^gpt-4o/i,
    /^google\/gemini/i,
    /^meta-llama\/llama-4/i,
    /vision/i,
    /multimodal/i,
    /(?:^|\/)pixtral/i,
    /(?:^|\/)qwen.*(?:^|[-/.])vl/i,
    /^amazon\/nova/i
];

const UNSUPPORTED_MODEL_PATTERNS: RegExp[] = [
    /^deepseek\//i,
    /^perplexity\//i,
    /^cohere\//i,
    /^microsoft\/phi-4(?:$|-reasoning)/i,
    /^microsoft\/mai-ds-r1$/i,
    /^qwen\/qwen3/i,
    /^qwen\/qwen-2\.5-coder/i,
    /^qwen\/qwen-2\.5-(?:72b|7b)-instruct/i,
    /^qwen\/qwen-2-72b-instruct/i,
    /^qwen\/qwq-/i,
    /^qwen\/qwen-(?:max|plus|turbo)/i,
    /^mistralai\/(?!pixtral)/i,
    /^x-ai\/grok-code-fast-1$/i,
    /^x-ai\/grok-(?:2-1212|3|3-mini|3-beta|3-mini-beta)$/i,
    /^nvidia\//i,
    /^inflection\//i,
    /^rekaai\//i,
    /^minimax\//i,
    /^liquid\//i,
    /^ai21\//i,
    /^01-ai\//i
];

export function getModelImageSupport(modelId?: string): ModelImageSupport {
    if (!modelId) {
        return 'unknown';
    }

    if (SUPPORTED_MODEL_PATTERNS.some(pattern => pattern.test(modelId))) {
        return 'supported';
    }

    if (UNSUPPORTED_MODEL_PATTERNS.some(pattern => pattern.test(modelId))) {
        return 'unsupported';
    }

    return 'unknown';
}

export function getModelImageSupportMessage(modelId?: string): string {
    const support = getModelImageSupport(modelId);

    if (support === 'unsupported') {
        return 'The selected model appears to be text-only. Switch to Claude, GPT-4.1, Gemini, or another vision-capable model for image understanding.';
    }

    if (support === 'unknown') {
        return 'Image input may not be supported by the selected model. If analysis fails, switch to Claude, GPT-4.1, Gemini, or another vision-capable model.';
    }

    return '';
}

export function modelSupportsImageInput(modelId?: string): boolean {
    return getModelImageSupport(modelId) === 'supported';
}

export function getModelDisplayNameFromCatalog(modelId: string): string | undefined {
    return MODEL_CATALOG.find(model => model.id === modelId)?.name;
}
