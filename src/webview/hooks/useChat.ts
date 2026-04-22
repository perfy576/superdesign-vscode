import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CoreMessage, UserContent } from 'ai';
import { summarizeContent } from '../../utils/chatContent';

const LEGACY_CHAT_HISTORY_KEY = 'superdesign-chat-history';
const CHAT_CONVERSATIONS_KEY = 'superdesign-chat-conversations';
const ACTIVE_CONVERSATION_KEY = 'superdesign-active-conversation';

interface MessageMetadata {
    timestamp?: number;
    is_loading?: boolean;
    estimated_duration?: number;
    start_time?: number;
    elapsed_time?: number;
    progress_percentage?: number;
    session_id?: string;
    result_type?: string;
    is_error?: boolean;
    duration_ms?: number;
    total_cost_usd?: number;
    tool_name?: string;
    tool_id?: string;
    tool_input?: any;
    tool_result?: any;
    result_is_error?: boolean;
    result_received?: boolean;
    actions?: Array<{
        text: string;
        command: string;
        args?: string;
    }>;
}

export type ChatMessage = CoreMessage & {
    metadata?: MessageMetadata;
};

export interface ChatConversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    history: ChatMessage[];
}

export interface ChatConversationSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
}

export interface ChatHookResult {
    chatHistory: ChatMessage[];
    isLoading: boolean;
    activeConversationId: string | null;
    activeConversationTitle: string;
    conversations: ChatConversationSummary[];
    sendMessage: (message: UserContent) => void;
    clearHistory: () => void;
    createConversation: () => void;
    switchConversation: (conversationId: string) => void;
    deleteConversation: (conversationId: string) => void;
    setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

function cleanIncompleteToolCalls(history: ChatMessage[]): ChatMessage[] {
    const cleanedHistory: ChatMessage[] = [];

    for (let i = 0; i < history.length; i++) {
        const message = history[i];

        if (message.role === 'assistant' && Array.isArray(message.content)) {
            const toolCalls = message.content.filter(part => part.type === 'tool-call');

            if (toolCalls.length > 0) {
                const hasIncompleteTools = toolCalls.some(toolCall => {
                    const toolCallId = (toolCall as any).toolCallId;

                    for (let j = i + 1; j < history.length; j++) {
                        const laterMsg = history[j];
                        if (laterMsg.role === 'tool' && Array.isArray(laterMsg.content)) {
                            const hasMatchingResult = laterMsg.content.some(
                                part => part.type === 'tool-result' && (part as any).toolCallId === toolCallId
                            );
                            if (hasMatchingResult) {
                                return false;
                            }
                        }
                        if (laterMsg.role === 'assistant') {
                            break;
                        }
                    }
                    return true;
                });

                if (hasIncompleteTools) {
                    const filteredContent = message.content.filter(part => part.type !== 'tool-call');

                    if (filteredContent.length > 0) {
                        cleanedHistory.push({
                            ...message,
                            content: filteredContent.length === 1 && filteredContent[0].type === 'text'
                                ? (filteredContent[0] as any).text
                                : filteredContent,
                            metadata: {
                                ...message.metadata,
                                is_loading: false
                            }
                        });
                    }
                    continue;
                }
            }
        }

        cleanedHistory.push(message);
    }

    return cleanedHistory;
}

export function getPersistableHistory(history: ChatMessage[]): ChatMessage[] {
    return history.map(message => {
        if (message.role !== 'user' || !Array.isArray(message.content)) {
            return message;
        }

        const content = message.content.map(part => {
            if (part.type !== 'image') {
                return part;
            }

            return {
                ...part,
                image: '[stored-in-moodboard]'
            };
        });

        return {
            ...message,
            content
        };
    });
}

function createConversationTitle(history: ChatMessage[]): string {
    const firstUserMessage = history.find(message => message.role === 'user');
    if (!firstUserMessage) {
        return 'New Conversation';
    }

    const summary = summarizeContent(firstUserMessage.content).trim();
    if (!summary) {
        return 'New Conversation';
    }

    return summary.length > 48 ? `${summary.slice(0, 48).trim()}...` : summary;
}

function createConversation(history: ChatMessage[] = []): ChatConversation {
    const timestamp = Date.now();
    return {
        id: `conversation_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
        title: createConversationTitle(history),
        createdAt: timestamp,
        updatedAt: timestamp,
        history
    };
}

function sortConversations(conversations: ChatConversation[]): ChatConversation[] {
    return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

function ensureConversationList(conversations: ChatConversation[]): ChatConversation[] {
    return conversations.length > 0 ? sortConversations(conversations) : [createConversation()];
}

function loadStoredState(): {
    conversations: ChatConversation[];
    activeConversationId: string | null;
} {
    try {
        const savedConversations = localStorage.getItem(CHAT_CONVERSATIONS_KEY);
        const savedActiveConversationId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);

        if (savedConversations) {
            const parsed = JSON.parse(savedConversations) as ChatConversation[];
            const conversations = ensureConversationList(parsed);
            const activeConversationId = conversations.some(conversation => conversation.id === savedActiveConversationId)
                ? savedActiveConversationId
                : conversations[0]?.id || null;

            return { conversations, activeConversationId };
        }

        const legacyHistory = localStorage.getItem(LEGACY_CHAT_HISTORY_KEY);
        if (legacyHistory) {
            const parsedHistory = JSON.parse(legacyHistory) as ChatMessage[];
            const migratedConversation = createConversation(parsedHistory);
            return {
                conversations: [migratedConversation],
                activeConversationId: migratedConversation.id
            };
        }
    } catch (error) {
        console.warn('Failed to load chat history from localStorage:', error);
    }

    const initialConversation = createConversation();
    return {
        conversations: [initialConversation],
        activeConversationId: initialConversation.id
    };
}

function updateConversationHistory(
    conversations: ChatConversation[],
    conversationId: string | null,
    updater: ChatMessage[] | ((history: ChatMessage[]) => ChatMessage[])
): ChatConversation[] {
    const targetConversationId = conversationId || conversations[0]?.id || null;
    if (!targetConversationId) {
        return conversations;
    }

    return sortConversations(conversations.map(conversation => {
        if (conversation.id !== targetConversationId) {
            return conversation;
        }

        const nextHistory = typeof updater === 'function'
            ? updater(conversation.history)
            : updater;

        return {
            ...conversation,
            history: nextHistory,
            title: createConversationTitle(nextHistory),
            updatedAt: Date.now()
        };
    }));
}

export function useChat(vscode: any): ChatHookResult {
    const initialState = useMemo(loadStoredState, []);
    const [conversations, setConversations] = useState<ChatConversation[]>(initialState.conversations);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(initialState.activeConversationId);
    const [isLoading, setIsLoading] = useState(false);
    const activeConversationIdRef = useRef<string | null>(initialState.activeConversationId);

    useEffect(() => {
        activeConversationIdRef.current = activeConversationId;
    }, [activeConversationId]);

    const activeConversation = useMemo(
        () => conversations.find(conversation => conversation.id === activeConversationId) || conversations[0] || null,
        [activeConversationId, conversations]
    );

    const chatHistory = activeConversation?.history || [];

    useEffect(() => {
        try {
            const persistableConversations = conversations.map(conversation => ({
                ...conversation,
                history: getPersistableHistory(conversation.history)
            }));
            localStorage.setItem(CHAT_CONVERSATIONS_KEY, JSON.stringify(persistableConversations));
            if (activeConversationId) {
                localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
            }
            localStorage.removeItem(LEGACY_CHAT_HISTORY_KEY);
        } catch (error) {
            console.warn('Failed to save chat history to localStorage:', error);
        }
    }, [activeConversationId, conversations]);

    const setChatHistory = useCallback<React.Dispatch<React.SetStateAction<ChatMessage[]>>>((value) => {
        setConversations(prev => updateConversationHistory(prev, activeConversationIdRef.current, value));
    }, []);

    const clearHistory = useCallback(() => {
        setConversations(prev => updateConversationHistory(prev, activeConversationIdRef.current, []));
    }, []);

    const createConversationEntry = useCallback(() => {
        const conversation = createConversation();
        setConversations(prev => sortConversations([conversation, ...prev]));
        setActiveConversationId(conversation.id);
    }, []);

    const switchConversation = useCallback((conversationId: string) => {
        if (isLoading) {
            return;
        }
        setActiveConversationId(conversationId);
    }, [isLoading]);

    const deleteConversation = useCallback((conversationId: string) => {
        if (isLoading) {
            return;
        }

        setConversations(prev => {
            const remaining = prev.filter(conversation => conversation.id !== conversationId);
            const nextConversations = ensureConversationList(remaining);

            setActiveConversationId(currentActiveId => {
                if (currentActiveId !== conversationId) {
                    return nextConversations.some(conversation => conversation.id === currentActiveId)
                        ? currentActiveId
                        : nextConversations[0]?.id || null;
                }
                return nextConversations[0]?.id || null;
            });

            return nextConversations;
        });
    }, [isLoading]);

    const sendMessage = useCallback((message: UserContent) => {
        setIsLoading(true);

        const targetConversationId = activeConversationIdRef.current || activeConversation?.id || null;
        if (!targetConversationId) {
            return;
        }

        const cleanedHistory = cleanIncompleteToolCalls(chatHistory);
        const userMessage: ChatMessage = {
            role: 'user',
            content: message,
            metadata: {
                timestamp: Date.now()
            }
        };

        const newHistory = [...cleanedHistory, userMessage];
        setConversations(prev => updateConversationHistory(prev, targetConversationId, newHistory));

        vscode.postMessage({
            command: 'chatMessage',
            message: summarizeContent(message),
            messageContent: message,
            chatHistory: newHistory
        });
    }, [activeConversation, chatHistory, vscode]);

    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            const targetConversationId = activeConversationIdRef.current;

            switch (message.command) {
                case 'chatResponseChunk':
                    setConversations(prev => updateConversationHistory(prev, targetConversationId, history => {
                        const newHistory = [...history];

                        if (message.messageType === 'assistant') {
                            const lastMessage = newHistory[newHistory.length - 1];

                            if (lastMessage && lastMessage.role === 'assistant' && typeof lastMessage.content === 'string') {
                                newHistory[newHistory.length - 1] = {
                                    ...lastMessage,
                                    content: lastMessage.content + message.content
                                };
                            } else {
                                newHistory.push({
                                    role: 'assistant',
                                    content: message.content,
                                    metadata: {
                                        timestamp: Date.now(),
                                        session_id: message.metadata?.session_id
                                    }
                                });
                            }
                        } else if (message.messageType === 'tool-call') {
                            const toolCallPart = {
                                type: 'tool-call' as const,
                                toolCallId: message.metadata?.tool_id || 'unknown',
                                toolName: message.metadata?.tool_name || 'unknown',
                                args: message.metadata?.tool_input || {}
                            };

                            const lastMessage = newHistory[newHistory.length - 1];
                            const lastIndex = newHistory.length - 1;

                            if (lastMessage && lastMessage.role === 'assistant') {
                                let newContent;
                                if (typeof lastMessage.content === 'string') {
                                    newContent = [
                                        { type: 'text', text: lastMessage.content },
                                        toolCallPart
                                    ];
                                } else if (Array.isArray(lastMessage.content)) {
                                    newContent = [...lastMessage.content, toolCallPart];
                                } else {
                                    newContent = [toolCallPart];
                                }

                                newHistory[lastIndex] = {
                                    ...lastMessage,
                                    content: newContent as any,
                                    metadata: {
                                        ...lastMessage.metadata,
                                        is_loading: true,
                                        estimated_duration: 90,
                                        start_time: Date.now(),
                                        progress_percentage: 0
                                    }
                                };
                            } else {
                                newHistory.push({
                                    role: 'assistant',
                                    content: [toolCallPart],
                                    metadata: {
                                        timestamp: Date.now(),
                                        session_id: message.metadata?.session_id,
                                        is_loading: true,
                                        estimated_duration: 90,
                                        start_time: Date.now(),
                                        progress_percentage: 0
                                    }
                                });
                            }
                        } else if (message.messageType === 'tool-result') {
                            newHistory.push({
                                role: 'tool',
                                content: [{
                                    type: 'tool-result',
                                    toolCallId: message.metadata?.tool_id || 'unknown',
                                    toolName: message.metadata?.tool_name || 'unknown',
                                    result: message.content || '',
                                    isError: false
                                }]
                            });
                        }

                        return newHistory;
                    }));
                    break;

                case 'chatToolUpdate':
                    setConversations(prev => updateConversationHistory(prev, targetConversationId, history => {
                        const newHistory = [...history];

                        for (let i = newHistory.length - 1; i >= 0; i--) {
                            const chatMessage = newHistory[i];
                            if (chatMessage.role === 'assistant' && Array.isArray(chatMessage.content)) {
                                const toolCallIndex = chatMessage.content.findIndex(
                                    part => part.type === 'tool-call' && (part as any).toolCallId === message.tool_use_id
                                );

                                if (toolCallIndex !== -1) {
                                    const updatedContent = [...chatMessage.content];
                                    updatedContent[toolCallIndex] = {
                                        ...updatedContent[toolCallIndex],
                                        args: message.tool_input
                                    } as any;

                                    newHistory[i] = {
                                        ...chatMessage,
                                        content: updatedContent
                                    };
                                    break;
                                }
                            }
                        }

                        return newHistory;
                    }));
                    break;

                case 'chatToolResult':
                    setConversations(prev => updateConversationHistory(prev, targetConversationId, history => {
                        const newHistory = [...history];

                        for (let i = newHistory.length - 1; i >= 0; i--) {
                            const chatMessage = newHistory[i];
                            if (chatMessage.role === 'assistant' && Array.isArray(chatMessage.content) && chatMessage.metadata?.is_loading) {
                                const hasMatchingToolCall = chatMessage.content.some(
                                    part => part.type === 'tool-call' && (part as any).toolCallId === message.tool_use_id
                                );

                                if (hasMatchingToolCall) {
                                    newHistory[i] = {
                                        ...chatMessage,
                                        metadata: {
                                            ...chatMessage.metadata,
                                            is_loading: false,
                                            progress_percentage: 100,
                                            elapsed_time: chatMessage.metadata.estimated_duration || 90
                                        }
                                    };
                                    break;
                                }
                            }
                        }

                        return newHistory;
                    }));
                    break;

                case 'chatStreamEnd':
                    setIsLoading(false);
                    break;

                case 'chatErrorWithActions':
                    setIsLoading(false);
                    setConversations(prev => updateConversationHistory(prev, targetConversationId, history => [
                        ...history,
                        {
                            role: 'assistant',
                            content: `❌ **${message.error}**\n\nPlease configure your API key to use this AI model.`,
                            metadata: {
                                timestamp: Date.now(),
                                is_error: true,
                                actions: message.actions || []
                            }
                        }
                    ]));
                    break;

                case 'chatError':
                    setIsLoading(false);
                    setConversations(prev => updateConversationHistory(prev, targetConversationId, history => [
                        ...history,
                        {
                            role: 'assistant',
                            content: `❌ **Error**: ${message.error}`,
                            metadata: {
                                timestamp: Date.now(),
                                is_error: true
                            }
                        }
                    ]));
                    break;

                case 'chatStopped':
                    setIsLoading(false);
                    break;

                default:
                    break;
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, []);

    const conversationSummaries = useMemo<ChatConversationSummary[]>(
        () => sortConversations(conversations).map(conversation => ({
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            messageCount: conversation.history.length
        })),
        [conversations]
    );

    return {
        chatHistory,
        isLoading,
        activeConversationId: activeConversation?.id || null,
        activeConversationTitle: activeConversation?.title || 'New Conversation',
        conversations: conversationSummaries,
        sendMessage,
        clearHistory,
        createConversation: createConversationEntry,
        switchConversation,
        deleteConversation,
        setChatHistory
    };
}
