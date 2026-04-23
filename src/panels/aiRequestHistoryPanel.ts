import * as vscode from 'vscode';
import { AIRequestHistoryEntry, AIRequestHistoryService } from '../services/aiRequestHistoryService';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString('zh-CN', {
        hour12: false
    });
}

function formatDuration(durationMs?: number): string {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
        return '-';
    }

    if (durationMs < 1000) {
        return `${durationMs}ms`;
    }

    return `${(durationMs / 1000).toFixed(2)}s`;
}

function renderTokenRow(label: string, value?: number): string {
    return `<div class="meta-pair"><span>${label}</span><strong>${typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '-'}</strong></div>`;
}

function renderCollapsibleContent(title: string, content: string | undefined): string {
    return `
        <details class="content-card content-card--collapsible">
            <summary class="content-card__summary">${escapeHtml(title)}</summary>
            <div class="content-card__body">
                <pre>${escapeHtml(content || '-')}</pre>
            </div>
        </details>
    `;
}

function renderEntry(entry: AIRequestHistoryEntry): string {
    const statusClass = `status-${entry.status}`;
    const tokenUsage = entry.tokenUsage;

    return `
        <details class="request-item" open>
            <summary class="request-summary">
                <div class="request-summary__main">
                    <span class="status-badge ${statusClass}">${entry.status}</span>
                    <span class="request-title">${escapeHtml(entry.model || entry.provider || 'AI Request')}</span>
                    <span class="request-time">${escapeHtml(formatDate(entry.createdAt))}</span>
                </div>
                <div class="request-summary__meta">
                    <span>${escapeHtml(entry.provider || '-')}</span>
                    <span>${escapeHtml(formatDuration(entry.durationMs))}</span>
                    <span>${escapeHtml(entry.baseUrl || '-')}</span>
                </div>
            </summary>
            <div class="request-body">
                <div class="request-grid">
                    <div class="meta-card">
                        <h4>请求信息</h4>
                        <div class="meta-pair"><span>Provider</span><strong>${escapeHtml(entry.provider || '-')}</strong></div>
                        <div class="meta-pair"><span>Model</span><strong>${escapeHtml(entry.model || '-')}</strong></div>
                        <div class="meta-pair"><span>Base URL</span><strong>${escapeHtml(entry.baseUrl || '-')}</strong></div>
                        <div class="meta-pair"><span>结果</span><strong>${escapeHtml(entry.resultSummary || entry.finishReason || '-')}</strong></div>
                        <div class="meta-pair"><span>HTTP 状态</span><strong>${typeof entry.httpStatus === 'number' && Number.isFinite(entry.httpStatus) ? entry.httpStatus : '-'}</strong></div>
                    </div>
                    <div class="meta-card">
                        <h4>Token</h4>
                        ${renderTokenRow('输入 Token', tokenUsage?.inputTokens)}
                        ${renderTokenRow('输出 Token', tokenUsage?.outputTokens)}
                        ${renderTokenRow('缓存读取 Token', tokenUsage?.cacheReadTokens)}
                        ${renderTokenRow('缓存写入 Token', tokenUsage?.cacheWriteTokens)}
                        ${renderTokenRow('总 Token', tokenUsage?.totalTokens)}
                    </div>
                </div>
                ${renderCollapsibleContent('请求输入', entry.requestInput)}
                ${renderCollapsibleContent('请求输出', entry.responseOutput)}
                ${entry.errorMessage ? `
                <div class="content-card error-card">
                    <h4>错误信息</h4>
                    <pre>${escapeHtml(entry.errorMessage)}</pre>
                </div>` : ''}
                ${entry.errorResponseBody ? `
                <div class="content-card error-card">
                    <h4>响应报文</h4>
                    <pre>${escapeHtml(entry.errorResponseBody)}</pre>
                </div>` : ''}
            </div>
        </details>
    `;
}

export class AIRequestHistoryPanel {
    private static currentPanel: AIRequestHistoryPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (AIRequestHistoryPanel.currentPanel) {
            AIRequestHistoryPanel.currentPanel.panel.reveal(column);
            AIRequestHistoryPanel.currentPanel.update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'superdesign.aiRequestHistory',
            'AI 请求历史',
            column || vscode.ViewColumn.One,
            {
                enableScripts: false,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')]
            }
        );

        AIRequestHistoryPanel.currentPanel = new AIRequestHistoryPanel(panel);
    }

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;

        this.update();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        AIRequestHistoryService.getInstance().onDidChange(() => this.update(), undefined, this.disposables);
    }

    private update() {
        const entries = AIRequestHistoryService.getInstance().getEntries();
        this.panel.webview.html = this.getHtml(entries);
    }

    private getHtml(entries: AIRequestHistoryEntry[]): string {
        const content = entries.length > 0
            ? entries.map(renderEntry).join('\n')
            : `<div class="empty">暂无 AI 请求历史。</div>`;

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI 请求历史</title>
    <style>
        :root {
            color-scheme: light dark;
        }
        body {
            margin: 0;
            padding: 20px;
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .page-header {
            margin-bottom: 16px;
        }
        .page-header h1 {
            margin: 0 0 6px;
            font-size: 20px;
        }
        .page-header p {
            margin: 0;
            color: var(--vscode-descriptionForeground);
        }
        .request-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .request-item {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 10px;
            background: var(--vscode-sideBar-background);
            overflow: hidden;
        }
        .request-summary {
            list-style: none;
            cursor: pointer;
            padding: 14px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
        .request-summary::-webkit-details-marker {
            display: none;
        }
        .request-summary__main,
        .request-summary__meta {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .request-summary__meta {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            justify-content: flex-end;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 68px;
            height: 24px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .status-running {
            background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
            color: var(--vscode-textLink-foreground);
        }
        .status-success {
            background: color-mix(in srgb, var(--vscode-testing-iconPassed) 18%, transparent);
            color: var(--vscode-testing-iconPassed);
        }
        .status-error,
        .status-timeout {
            background: color-mix(in srgb, var(--vscode-errorForeground) 18%, transparent);
            color: var(--vscode-errorForeground);
        }
        .status-cancelled {
            background: color-mix(in srgb, var(--vscode-descriptionForeground) 18%, transparent);
            color: var(--vscode-descriptionForeground);
        }
        .request-title {
            font-weight: 700;
        }
        .request-time {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .request-body {
            border-top: 1px solid var(--vscode-panel-border);
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .request-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 12px;
        }
        .meta-card,
        .content-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 12px;
            background: var(--vscode-editorWidget-background);
        }
        .meta-card h4,
        .content-card h4 {
            margin: 0 0 10px;
            font-size: 13px;
        }
        .content-card--collapsible {
            padding: 0;
            overflow: hidden;
        }
        .content-card__summary {
            cursor: pointer;
            list-style: none;
            padding: 12px;
            font-size: 13px;
            font-weight: 600;
        }
        .content-card__summary::-webkit-details-marker {
            display: none;
        }
        .content-card__summary::after {
            content: '展开';
            float: right;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            font-weight: 400;
        }
        .content-card--collapsible[open] .content-card__summary::after {
            content: '收起';
        }
        .content-card__body {
            border-top: 1px solid var(--vscode-panel-border);
            padding: 12px;
        }
        .meta-pair {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            padding: 6px 0;
            border-bottom: 1px dashed var(--vscode-panel-border);
            font-size: 12px;
        }
        .meta-pair:last-child {
            border-bottom: 0;
        }
        .meta-pair span {
            color: var(--vscode-descriptionForeground);
        }
        pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            line-height: 1.5;
        }
        .error-card {
            border-color: color-mix(in srgb, var(--vscode-errorForeground) 45%, var(--vscode-panel-border));
        }
        .empty {
            padding: 20px;
            border: 1px dashed var(--vscode-panel-border);
            border-radius: 10px;
            color: var(--vscode-descriptionForeground);
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="page-header">
        <h1>AI 请求历史</h1>
        <p>按列表查看每次 AI 请求的输入、输出、Token、Base URL、结果和失败响应报文。</p>
    </div>
    <div class="request-list">
        ${content}
    </div>
</body>
</html>`;
    }

    public dispose() {
        AIRequestHistoryPanel.currentPanel = undefined;

        while (this.disposables.length > 0) {
            const item = this.disposables.pop();
            item?.dispose();
        }
    }
}
