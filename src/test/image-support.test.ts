import assert from 'node:assert/strict';
import { CoreMessage } from 'ai';
import {
    countImagesInContent,
    getLatestUserContent,
    listImageMetadata,
    serializeConversationForTextOnlyProvider,
    summarizeContent
} from '../utils/chatContent';
import {
    getModelDisplayNameFromCatalog,
    getModelImageSupport,
    getModelImageSupportMessage,
    modelSupportsImageInput
} from '../utils/modelCapabilities';
import { getPersistableHistory, ChatMessage } from '../webview/hooks/useChat';

function testModelImageSupport(): void {
    assert.equal(getModelImageSupport('claude-4-sonnet-20250514'), 'supported');
    assert.equal(getModelImageSupport('google/gemini-2.5-pro'), 'supported');
    assert.equal(getModelImageSupport('deepseek/deepseek-r1'), 'unsupported');
    assert.equal(getModelImageSupport('cohere/command-a-03-2025'), 'unsupported');
    assert.equal(getModelImageSupport('custom/vendor-model'), 'unknown');

    assert.equal(modelSupportsImageInput('gpt-4.1'), true);
    assert.equal(modelSupportsImageInput('deepseek/deepseek-r1'), false);
    assert.equal(
        getModelImageSupportMessage('deepseek/deepseek-r1'),
        'The selected model appears to be text-only. Switch to Claude, GPT-4.1, Gemini, or another vision-capable model for image understanding.'
    );
    assert.equal(getModelDisplayNameFromCatalog('gpt-4.1-mini'), 'GPT-4.1 Mini');
}

function testChatContentHelpers(): void {
    const content: CoreMessage['content'] = [
        { type: 'text', text: 'Analyze this landing page' },
        {
            type: 'image',
            image: '[stored-in-moodboard]',
            mimeType: 'image/png',
            providerOptions: {
                superdesign: {
                    filePath: '/workspace/.superdesign/moodboard/landing-page.png',
                    fileName: 'landing-page.png'
                }
            }
        },
        {
            type: 'image',
            image: '[stored-in-moodboard]',
            mimeType: 'image/jpeg',
            providerOptions: {
                superdesign: {
                    filePath: '/workspace/.superdesign/moodboard/checkout.jpg',
                    fileName: 'checkout.jpg'
                }
            }
        }
    ];

    assert.equal(countImagesInContent(content), 2);
    assert.equal(summarizeContent(content), 'Analyze this landing page [2 images]');
    assert.deepEqual(listImageMetadata(content), [
        {
            filePath: '/workspace/.superdesign/moodboard/landing-page.png',
            fileName: 'landing-page.png'
        },
        {
            filePath: '/workspace/.superdesign/moodboard/checkout.jpg',
            fileName: 'checkout.jpg'
        }
    ]);

    const history: CoreMessage[] = [
        { role: 'assistant', content: 'What should I focus on?' },
        { role: 'user', content }
    ];

    assert.equal(getLatestUserContent(history), content);
    assert.equal(
        serializeConversationForTextOnlyProvider(history),
        'assistant: What should I focus on?\n\nuser: Analyze this landing page [2 images]'
    );
}

function testPersistableHistory(): void {
    const history: ChatMessage[] = [
        {
            role: 'user',
            content: [
                { type: 'text', text: 'Review these screens' },
                {
                    type: 'image',
                    image: 'REAL_BASE64_DATA',
                    mimeType: 'image/png',
                    providerOptions: {
                        superdesign: {
                            filePath: '/workspace/.superdesign/moodboard/a.png',
                            fileName: 'a.png'
                        }
                    }
                }
            ]
        },
        {
            role: 'assistant',
            content: 'I will compare the layouts.'
        }
    ];

    const persisted = getPersistableHistory(history);
    const persistedUserMessage = persisted[0];
    const persistedImagePart = Array.isArray(persistedUserMessage.content)
        ? persistedUserMessage.content[1]
        : undefined;

    assert.ok(Array.isArray(persistedUserMessage.content));
    assert.deepEqual(persistedImagePart, {
        type: 'image',
        image: '[stored-in-moodboard]',
        mimeType: 'image/png',
        providerOptions: {
            superdesign: {
                filePath: '/workspace/.superdesign/moodboard/a.png',
                fileName: 'a.png'
            }
        }
    });
    assert.equal(persisted[1].content, 'I will compare the layouts.');
}

function run(): void {
    testModelImageSupport();
    testChatContentHelpers();
    testPersistableHistory();
    console.log('image-support tests passed');
}

run();
