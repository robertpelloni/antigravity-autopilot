
import { createLogger } from '../utils/logger';
import * as vscode from 'vscode';
import { getAvailableModels } from './model-scraper';
import { ModelId, TaskType } from '../utils/constants';
import { taskAnalyzer } from './task-analyzer';

const log = createLogger('ModelSelector');

export interface ModelSelection {
    modelId: string;
    modelDisplayName: string;
    reasoning: string;
}

export class ModelSelector {

    private normalizeModelId(modelId: string | null | undefined): string {
        const raw = String(modelId || '').trim();
        if (!raw) {
            return ModelId.GEMINI_FLASH;
        }

        const aliases: Record<string, string> = {
            'claude-sonnet-4-5': ModelId.CLAUDE_SONNET,
            'claude-sonnet-4-5-thinking': ModelId.CLAUDE_SONNET_THINKING,
            'claude-opus-4-5-thinking': ModelId.CLAUDE_OPUS_THINKING,
        };

        return aliases[raw] || raw;
    }

    async selectForTask(task: string): Promise<ModelSelection> {
        const taskType = taskAnalyzer.analyze(task);
        let model: string = ModelId.GEMINI_FLASH;
        let reason = 'Default general purpose model';

        const config = vscode.workspace.getConfiguration('antigravity');
        const prefReasoning = this.normalizeModelId(config.get<string>('preferredModelForReasoning') || ModelId.CLAUDE_OPUS_THINKING);
        const prefFrontend = this.normalizeModelId(config.get<string>('preferredModelForFrontend') || ModelId.GEMINI_PRO_HIGH);
        const prefQuick = this.normalizeModelId(config.get<string>('preferredModelForQuick') || ModelId.GEMINI_FLASH);

        if (taskType === TaskType.FRONTEND) {
            model = prefFrontend;
            reason = 'Configured Frontend Model';
        } else if (taskType === TaskType.REASONING || taskType === TaskType.GENERAL) {
            model = prefReasoning;
            reason = 'Configured Reasoning Model';
        } else if (taskType === TaskType.QUICK) {
            model = prefQuick;
            reason = 'Configured Quick Model';
        } else {
            model = prefReasoning;
            reason = 'Default to Reasoning Model';
        }

        const availableModels = await getAvailableModels();
        const availableByNormalized = new Map<string, { value: string; label: string }>();
        for (const candidate of availableModels) {
            availableByNormalized.set(this.normalizeModelId(candidate.value), candidate);
        }
        const normalizedRequested = this.normalizeModelId(model);

        if (!availableByNormalized.has(normalizedRequested)) {
            const fallbackCandidates = [prefReasoning, ModelId.GEMINI_FLASH];
            const fallback = fallbackCandidates.find(candidate => availableByNormalized.has(this.normalizeModelId(candidate)));
            if (fallback) {
                reason += ` (Preferred ${normalizedRequested} unavailable, falling back to ${fallback})`;
                model = this.normalizeModelId(fallback);
            } else {
                reason += ` (Preferred ${normalizedRequested} unavailable, no known fallback available)`;
                model = normalizedRequested;
            }
        } else {
            model = normalizedRequested;
        }

        const modelObj = availableByNormalized.get(this.normalizeModelId(model));
        const displayName = modelObj ? modelObj.label : model;

        return {
            modelId: model,
            modelDisplayName: displayName,
            reasoning: reason
        };
    }

    showSwitchNotification(selection: ModelSelection) {
        vscode.window.showInformationMessage(`🧠 Switched to ${selection.modelDisplayName}: ${selection.reasoning}`);
    }
}

export const modelSelector = new ModelSelector();
