import * as vscode from 'vscode';
import { CoreMessage } from 'ai';
import * as fs from 'fs';
import * as path from 'path';

export interface AIRequestTokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}

export type AIRequestStatus = 'running' | 'success' | 'error' | 'cancelled' | 'timeout';

export interface AIRequestHistoryEntry {
    id: string;
    createdAt: number;
    completedAt?: number;
    status: AIRequestStatus;
    hidden?: boolean;
    requestKind?: 'aggregate' | 'roundtrip';
    provider?: string;
    model?: string;
    baseUrl?: string;
    requestInput: string;
    responseOutput?: string;
    resultSummary?: string;
    finishReason?: string;
    durationMs?: number;
    tokenUsage?: AIRequestTokenUsage;
    errorMessage?: string;
    errorResponseBody?: string;
    httpStatus?: number;
    responseHeaders?: Record<string, string>;
}

const MAX_HISTORY_ENTRIES = 200;
const MAX_STORED_TEXT_LENGTH = 120000;
const REQUEST_LOG_DIR = path.join('.superdesign', 'request_log');

function normalizeFiniteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampText(value: string | undefined, maxLength: number = MAX_STORED_TEXT_LENGTH): string | undefined {
    if (!value) {
        return value;
    }

    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength)}\n\n...[truncated]`;
}

function stringifyUnknown(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function serializeContent(content: CoreMessage['content']): string {
    if (typeof content === 'string') {
        return content;
    }

    if (!Array.isArray(content)) {
        return stringifyUnknown(content);
    }

    return content.map((part: any) => {
        if (part?.type === 'text' && typeof part.text === 'string') {
            return part.text;
        }

        if (part?.type === 'image') {
            const providerOptions = part.providerOptions as Record<string, unknown> | undefined;
            const superdesign = providerOptions?.superdesign as Record<string, unknown> | undefined;
            const fileName = typeof superdesign?.fileName === 'string'
                ? superdesign.fileName
                : typeof superdesign?.filePath === 'string'
                    ? superdesign.filePath
                    : 'unknown-image';
            return `[Image: ${fileName}]`;
        }

        if (part?.type === 'tool-call') {
            return `[Tool Call] ${part.toolName || 'unknown'} ${stringifyUnknown(part.args ?? {})}`;
        }

        if (part?.type === 'tool-result') {
            return `[Tool Result] ${part.toolName || 'unknown'} ${stringifyUnknown(part.result ?? '')}`;
        }

        return stringifyUnknown(part);
    }).join('\n');
}

export function serializeMessagesForHistory(messages: readonly CoreMessage[]): string {
    return messages
        .map((message, index) => {
            const header = `#${index + 1} ${message.role}`;
            const body = serializeContent(message.content).trim();
            return `${header}\n${body || '[empty]'}`;
        })
        .join('\n\n');
}

export function extractErrorInfo(error: unknown): {
    message: string;
    responseBody?: string;
    httpStatus?: number;
} {
    if (error instanceof Error) {
        const errorObject = error as Record<string, any>;
        const cause = errorObject.cause as Record<string, any> | undefined;
        const response = errorObject.response as Record<string, any> | undefined;

        const responseBody = clampText(
            typeof errorObject.responseBody === 'string'
                ? errorObject.responseBody
                : typeof errorObject.body === 'string'
                    ? errorObject.body
                    : typeof response?.body === 'string'
                        ? response.body
                        : typeof cause?.responseBody === 'string'
                            ? cause.responseBody
                            : typeof cause?.body === 'string'
                                ? cause.body
                                : typeof response?.data === 'string'
                                    ? response.data
                                    : response?.data
                                        ? stringifyUnknown(response.data)
                                        : cause?.response
                                            ? stringifyUnknown(cause.response)
                                            : undefined
        );

        const httpStatus = typeof errorObject.statusCode === 'number'
            ? errorObject.statusCode
            : typeof errorObject.status === 'number'
                ? errorObject.status
                : typeof response?.status === 'number'
                    ? response.status
                    : typeof cause?.statusCode === 'number'
                        ? cause.statusCode
                        : undefined;

        return {
            message: error.message,
            responseBody,
            httpStatus
        };
    }

    return {
        message: stringifyUnknown(error)
    };
}

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getRequestLogDir(): string | undefined {
    const workspaceRoot = getWorkspaceRoot();
    return workspaceRoot ? path.join(workspaceRoot, REQUEST_LOG_DIR) : undefined;
}

function sanitizeTokenUsage(tokenUsage: AIRequestTokenUsage | undefined): AIRequestTokenUsage | undefined {
    if (!tokenUsage) {
        return undefined;
    }

    const inputTokens = normalizeFiniteNumber(tokenUsage.inputTokens);
    const outputTokens = normalizeFiniteNumber(tokenUsage.outputTokens);
    const totalTokens = normalizeFiniteNumber(tokenUsage.totalTokens) ?? (
        inputTokens !== undefined || outputTokens !== undefined
            ? (inputTokens || 0) + (outputTokens || 0)
            : undefined
    );
    const cacheReadTokens = normalizeFiniteNumber(tokenUsage.cacheReadTokens);
    const cacheWriteTokens = normalizeFiniteNumber(tokenUsage.cacheWriteTokens);

    if ([inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens].every(value => value === undefined)) {
        return undefined;
    }

    return {
        inputTokens,
        outputTokens,
        totalTokens,
        cacheReadTokens,
        cacheWriteTokens
    };
}

export class AIRequestHistoryService {
    private static instance: AIRequestHistoryService;
    private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
    private entries: AIRequestHistoryEntry[] = [];

    private constructor() {
        this.loadPersistedEntries();
    }

    public static getInstance(): AIRequestHistoryService {
        if (!this.instance) {
            this.instance = new AIRequestHistoryService();
        }

        return this.instance;
    }

    public readonly onDidChange = this.onDidChangeEmitter.event;

    createEntry(input: {
        requestInput: string;
        hidden?: boolean;
        requestKind?: 'aggregate' | 'roundtrip';
    }): string {
        const id = `ai_request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        this.entries.unshift({
            id,
            createdAt: Date.now(),
            status: 'running',
            hidden: input.hidden ?? false,
            requestKind: input.requestKind ?? 'roundtrip',
            requestInput: clampText(input.requestInput) || ''
        });

        if (this.entries.length > MAX_HISTORY_ENTRIES) {
            this.entries = this.entries.slice(0, MAX_HISTORY_ENTRIES);
        }

        this.persistEntryById(id);
        this.onDidChangeEmitter.fire();
        return id;
    }

    addEntry(entry: Omit<AIRequestHistoryEntry, 'id' | 'createdAt'> & {
        id?: string;
        createdAt?: number;
    }): string {
        const id = entry.id || `ai_request_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const createdAt = entry.createdAt ?? Date.now();

        this.entries.unshift({
            id,
            createdAt,
            status: entry.status,
            hidden: entry.hidden ?? false,
            requestKind: entry.requestKind ?? 'roundtrip',
            provider: entry.provider,
            model: entry.model,
            baseUrl: entry.baseUrl,
            requestInput: clampText(entry.requestInput) || '',
            responseOutput: clampText(entry.responseOutput),
            resultSummary: clampText(entry.resultSummary, 20000),
            finishReason: entry.finishReason,
            durationMs: entry.durationMs,
            tokenUsage: sanitizeTokenUsage(entry.tokenUsage),
            errorMessage: clampText(entry.errorMessage, 20000),
            errorResponseBody: clampText(entry.errorResponseBody),
            httpStatus: entry.httpStatus,
            completedAt: entry.completedAt,
            responseHeaders: entry.responseHeaders
        });

        if (this.entries.length > MAX_HISTORY_ENTRIES) {
            this.entries = this.entries.slice(0, MAX_HISTORY_ENTRIES);
        }

        this.persistEntryById(id);
        this.onDidChangeEmitter.fire();
        return id;
    }

    updateEntry(id: string, patch: Partial<AIRequestHistoryEntry>) {
        const entry = this.entries.find(item => item.id === id);
        if (!entry) {
            return;
        }

        Object.assign(entry, {
            ...patch,
            requestInput: clampText(patch.requestInput ?? entry.requestInput) || '',
            responseOutput: clampText(patch.responseOutput ?? entry.responseOutput),
            resultSummary: clampText(patch.resultSummary ?? entry.resultSummary, 20000),
            errorMessage: clampText(patch.errorMessage ?? entry.errorMessage, 20000),
            errorResponseBody: clampText(patch.errorResponseBody ?? entry.errorResponseBody),
            tokenUsage: sanitizeTokenUsage(patch.tokenUsage ?? entry.tokenUsage),
            responseHeaders: patch.responseHeaders ?? entry.responseHeaders
        });

        this.persistEntryById(id);
        this.onDidChangeEmitter.fire();
    }

    getEntries(): AIRequestHistoryEntry[] {
        return [...this.entries]
            .filter(entry => !entry.hidden)
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    private loadPersistedEntries() {
        const requestLogDir = getRequestLogDir();
        if (!requestLogDir || !fs.existsSync(requestLogDir)) {
            return;
        }

        try {
            const entries = fs.readdirSync(requestLogDir)
                .filter(fileName => fileName.endsWith('.json'))
                .map(fileName => path.join(requestLogDir, fileName))
                .reduce<AIRequestHistoryEntry[]>((acc, filePath) => {
                    try {
                        const raw = fs.readFileSync(filePath, 'utf8');
                        const parsed = JSON.parse(raw) as AIRequestHistoryEntry;
                        acc.push({
                            ...parsed,
                            tokenUsage: sanitizeTokenUsage(parsed.tokenUsage)
                        });
                    } catch {
                        // ignore unreadable persisted entries
                    }
                    return acc;
                }, [])
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, MAX_HISTORY_ENTRIES);

            this.entries = entries;
        } catch {
            this.entries = [];
        }
    }

    private persistEntryById(id: string) {
        const entry = this.entries.find(item => item.id === id);
        const requestLogDir = getRequestLogDir();
        if (!entry || !requestLogDir) {
            return;
        }

        try {
            fs.mkdirSync(requestLogDir, { recursive: true });
            const filePath = path.join(requestLogDir, `${entry.createdAt}_${entry.id}.json`);
            fs.writeFileSync(filePath, JSON.stringify({
                ...entry,
                tokenUsage: sanitizeTokenUsage(entry.tokenUsage)
            }, null, 2), 'utf8');
        } catch {
            // ignore persistence failures to avoid breaking chat flow
        }
    }
}
