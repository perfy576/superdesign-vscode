import { CoreMessage, CoreUserMessage, UserContent } from 'ai';

export type ChatContent = CoreMessage['content'] | UserContent | undefined;
export interface ImagePartMetadata {
    filePath?: string;
    fileName?: string;
}

function getSuperdesignMetadata(part: { providerOptions?: Record<string, unknown> }): ImagePartMetadata {
    const providerOptions = part.providerOptions as Record<string, unknown> | undefined;
    const superdesign = providerOptions?.superdesign as Record<string, unknown> | undefined;

    return {
        filePath: typeof superdesign?.filePath === 'string' ? superdesign.filePath : undefined,
        fileName: typeof superdesign?.fileName === 'string' ? superdesign.fileName : undefined
    };
}

export function extractTextFromContent(content: ChatContent): string {
    if (typeof content === 'string') {
        return content;
    }

    if (!Array.isArray(content)) {
        return '';
    }

    const arrayContent = content as Array<{ type: string; text?: string }>;

    return arrayContent
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n');
}

export function countImagesInContent(content: ChatContent): number {
    if (!Array.isArray(content)) {
        return 0;
    }

    return content.filter(part => part.type === 'image').length;
}

export function contentHasImages(content: ChatContent): boolean {
    return countImagesInContent(content) > 0;
}

export function historyHasImages(messages?: readonly CoreMessage[]): boolean {
    return !!messages?.some(message => message.role === 'user' && contentHasImages(message.content));
}

export function summarizeContent(content: ChatContent): string {
    const text = extractTextFromContent(content).trim();
    const imageCount = countImagesInContent(content);
    const summaryParts: string[] = [];

    if (text) {
        summaryParts.push(text);
    }

    if (imageCount > 0) {
        summaryParts.push(`[${imageCount} image${imageCount > 1 ? 's' : ''}]`);
    }

    return summaryParts.join(' ').trim();
}

export function listImageMetadata(content: ChatContent): ImagePartMetadata[] {
    if (!Array.isArray(content)) {
        return [];
    }

    return content
        .filter(part => part.type === 'image')
        .map(part => getSuperdesignMetadata(part as { providerOptions?: Record<string, unknown> }));
}

export function getLatestUserContent(
    chatHistory: readonly CoreMessage[],
    fallbackContent?: ChatContent
): CoreUserMessage['content'] {
    const latestUserMessage = [...chatHistory].reverse().find(message => message.role === 'user');
    return (latestUserMessage?.content ?? fallbackContent ?? '') as CoreUserMessage['content'];
}

export function serializeConversationForTextOnlyProvider(chatHistory: readonly CoreMessage[]): string {
    return chatHistory
        .map(message => {
            const summary = summarizeContent(message.content);
            return `${message.role}: ${summary || '[empty]'}`;
        })
        .join('\n\n');
}
