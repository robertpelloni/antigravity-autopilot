
import { createLogger } from '../utils/logger';
import * as vscode from 'vscode';
import { getAvailableModels } from './model-scraper';
import { ModelId, TaskType } from '../utils/constants';

const log = createLogger('ModelSelector');

export interface ModelSelection {
    modelId: string;
    modelDisplayName: string;
    reasoning: string;
}

export class ModelSelector {

    async selectForTask(task: string): Promise<ModelSelection> {
        const lowerTask = task.toLowerCase();
        let model: string = ModelId.GEMINI_FLASH;
        let reason = 'Default general purpose model';

        // Use Yoke-style configuration logic
        const config = vscode.workspace.getConfiguration('antigravity');
        const prefReasoning = config.get<string>('preferredModelForReasoning') || ModelId.CLAUDE_OPUS_THINKING;
        const prefFrontend = config.get<string>('preferredModelForFrontend') || ModelId.GEMINI_PRO_HIGH;
        const prefQuick = config.get<string>('preferredModelForQuick') || ModelId.GEMINI_FLASH;

        // 1. Select based on task type (matching Yoke logic)
        if (lowerTask.includes('css') || lowerTask.includes('ui') || lowerTask.includes('frontend') || lowerTask.includes('style')) {
            model = prefFrontend;
            reason = 'Configured Frontend Model';
        } else if (lowerTask.includes('refactor') || lowerTask.includes('architecture') || lowerTask.includes('plan') || lowerTask.includes('complex')) {
            model = prefReasoning;
            reason = 'Configured Reasoning Model';
        } else if (lowerTask.includes('fix') || lowerTask.includes('brieft') || lowerTask.includes('quick')) {
            model = prefQuick;
            reason = 'Configured Quick Model';
        } else {
            // Default fallback to reasoning for general tasks (as per Yoke)
            model = prefReasoning;
            reason = 'Default to Reasoning Model';
        }

        // 2. Verify availability (Optional enhancement over Yoke, but good for safety)
        const availableModels = await getAvailableModels();
        const availableValues = availableModels.map(m => m.value);

        // If preferred model is not available, try to fall back intelligently
        if (!availableValues.includes(model)) {
            // If configured model isn't found, try to stick to family or fallback to Flash
            if (availableValues.includes(ModelId.GEMINI_FLASH)) {
                reason += ` (Preferred ${model} unavailable, falling back to Flash)`;
                model = ModelId.GEMINI_FLASH;
            }
        }

        // Find display name
        const modelObj = availableModels.find(m => m.value === model);
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
