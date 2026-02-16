/**
 * Antigravity Autopilot - Model Scraper
 * Dynamically detects available models from Antigravity's UI
 * @module core/model-scraper
 */

import { cdpClient } from '../providers/cdp-client';
import { createLogger } from '../utils/logger';
import { MODEL_LABELS } from '../utils/constants';

const log = createLogger('ModelScraper');

// Cache for scraped models
let cachedModels: { value: string; label: string }[] = [];
let lastScrapeTime = 0;
const CACHE_DURATION_MS = 60000; // 1 minute cache
const MODEL_SCRAPE_ATTEMPTS = 4;
const MODEL_SCRAPE_RETRY_DELAY_MS = 180;

/**
 * Get available models from Antigravity's model selector
 * Falls back to hardcoded list if scraping fails
 */
export async function getAvailableModels(): Promise<{ value: string; label: string }[]> {
    // Return cached if fresh
    if (cachedModels.length > 0 && Date.now() - lastScrapeTime < CACHE_DURATION_MS) {
        return cachedModels;
    }

    // Try to scrape from Antigravity
    try {
        const scraped = await scrapeModelsFromUI();
        if (scraped.length > 0) {
            cachedModels = scraped;
            lastScrapeTime = Date.now();
            log.info(`Scraped ${scraped.length} models from Antigravity`);
            return cachedModels;
        }
    } catch (err) {
        log.warn(`Failed to scrape models: ${(err as Error).message}`);
    }

    // Fallback to hardcoded models
    return getHardcodedModels();
}

/**
 * Scrape models from Antigravity's model selector dropdown via CDP
 */
async function scrapeModelsFromUI(): Promise<{ value: string; label: string }[]> {
    if (!cdpClient.isConnected()) {
        const connected = await cdpClient.connect();
        if (!connected) return [];
    }

    for (let attempt = 1; attempt <= MODEL_SCRAPE_ATTEMPTS; attempt++) {
        const result = await cdpClient.evaluate(`
        (function() {
            const seen = new Set();
            const models = [];
            const normalize = (v) => String(v || '').trim();
            const pushModel = (value, label) => {
                const normalizedValue = normalize(value);
                const normalizedLabel = normalize(label);
                if (!normalizedValue || !normalizedLabel) return;
                const key = normalizedValue + '::' + normalizedLabel;
                if (seen.has(key)) return;
                seen.add(key);
                models.push({ value: normalizedValue, label: normalizedLabel });
            };

            const optionSelector = '[role="option"], [role="menuitem"], .model-option, li[data-value], div[data-value], button[data-value]';
            const optionNodes = document.querySelectorAll(optionSelector);
            optionNodes.forEach(opt => {
                const value = opt.getAttribute('data-value') || opt.getAttribute('data-model') || opt.getAttribute('value') || opt.textContent;
                const label = opt.textContent || opt.getAttribute('aria-label') || value;
                pushModel(value, label);
            });

            if (models.length === 0) {
                const modelBtn = document.querySelector('[data-testid="model-selector"], .model-dropdown, button[aria-label*="model"], button[class*="model"]');
                if (modelBtn) {
                    const btnValue = modelBtn.getAttribute('data-value') || modelBtn.getAttribute('aria-label') || modelBtn.textContent;
                    const btnLabel = modelBtn.textContent || modelBtn.getAttribute('aria-label') || btnValue;
                    pushModel(btnValue, btnLabel);
                }
            }

            const currentModel = document.querySelector('.model-name, .current-model, [data-testid="current-model"]');
            if (currentModel) {
                const label = currentModel.textContent?.trim();
                if (label) {
                    pushModel(label.toLowerCase().replace(/\\s+/g, '-'), label);
                }
            }

            return models;
        })()
    `) as { value: string; label: string }[];

        const safeResult = Array.isArray(result) ? result : [];
        if (safeResult.length > 0) {
            if (attempt > 1) {
                log.info(`Model scrape succeeded on retry ${attempt}/${MODEL_SCRAPE_ATTEMPTS}`);
            }
            return safeResult;
        }

        if (attempt < MODEL_SCRAPE_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, MODEL_SCRAPE_RETRY_DELAY_MS));
        }
    }

    return [];
}

/**
 * Get hardcoded fallback models
 */
function getHardcodedModels(): { value: string; label: string }[] {
    return Object.entries(MODEL_LABELS).map(([value, label]) => ({
        value,
        label: label as string
    }));
}

/**
 * Force refresh the model cache
 */
export function refreshModelCache(): void {
    cachedModels = [];
    lastScrapeTime = 0;
}
