import * as cp from 'child_process';
import * as os from 'os';
import { config } from './config';

export type SoundEffect = 'submit' | 'bump' | 'type' | 'run' | 'expand' | 'alt-enter' | 'click' | 'success' | 'error';
export type ActionSoundGroup =
    | 'submit'
    | 'bump'
    | 'resume'
    | 'type'
    | 'run'
    | 'expand'
    | 'alt-enter'
    | 'accept'
    | 'accept-all'
    | 'allow'
    | 'continue'
    | 'click'
    | 'success'
    | 'error';

export const SOUND_EFFECTS: SoundEffect[] = [
    'submit', 'bump', 'type', 'run', 'expand', 'alt-enter', 'click', 'success', 'error'
];

const DEFAULT_ACTION_SOUND_MAP: Record<ActionSoundGroup, SoundEffect> = {
    submit: 'submit',
    bump: 'bump',
    resume: 'bump',
    type: 'type',
    run: 'run',
    expand: 'expand',
    'alt-enter': 'alt-enter',
    accept: 'click',
    'accept-all': 'success',
    allow: 'click',
    continue: 'submit',
    click: 'click',
    success: 'success',
    error: 'error'
};

export class SoundEffects {
    private static isWindows = os.platform() === 'win32';

    static play(effect: SoundEffect) {
        if (!this.isWindows) return;
        if (!config.get<boolean>('soundEffectsEnabled')) return;

        let command = '';
        switch (effect) {
            case 'submit':
                // High chirp: 1500Hz, 100ms
                command = '[Console]::Beep(1500, 100)';
                break;
            case 'bump':
                // Rising two-tone: 600Hz 80ms -> 800Hz 80ms
                command = '[Console]::Beep(600, 80); [Console]::Beep(800, 80)';
                break;
            case 'type':
                // Very short tick: 2000Hz 5ms
                command = '[Console]::Beep(2000, 5)';
                break;
            case 'run':
                // Major third up: 1000Hz 150ms -> 1250Hz 150ms
                command = '[Console]::Beep(1000, 100); [Console]::Beep(1250, 150)';
                break;
            case 'expand':
                // Slide up: 400Hz 80ms -> 600Hz 80ms
                command = '[Console]::Beep(400, 80); [Console]::Beep(600, 80)';
                break;
            case 'alt-enter':
                // Distinct confirmation: 1200Hz 150ms
                command = '[Console]::Beep(1200, 150)';
                break;
            case 'click':
                // Standard click: 800Hz 50ms
                command = '[Console]::Beep(800, 50)';
                break;
            case 'success':
                // Success: 1000Hz 100ms -> 1500Hz 100ms
                command = '[Console]::Beep(1000, 100); [Console]::Beep(1500, 100)';
                break;
            case 'error':
                // Error: 400Hz 200ms
                command = '[Console]::Beep(400, 200)';
                break;
        }

        if (command) {
            // Run detached/unrefed to prevent blocking node event loop if possible,
            // though exec is async callback-based.
            // Using a timeout to debounce/throttle could be added later if needed.
            cp.exec(`powershell -c "${command}"`, (err) => {
                if (err) {
                    // Fail silently
                }
            });
        }
    }

    static playActionGroup(group: ActionSoundGroup) {
        // 1. Check Global Audio Enable (New -> Legacy)
        const enabled = config.get<boolean>('audio.enabled') ?? config.get<boolean>('soundEffectsEnabled');
        if (!enabled) return;

        // 2. Check Action-Specific Filters
        // Map detailed groups to broader config categories
        let configCategory = 'click'; // Default
        switch (group) {
            case 'run': configCategory = 'run'; break;
            case 'expand': configCategory = 'expand'; break;
            case 'accept':
            case 'accept-all':
            case 'allow':
                configCategory = 'accept'; break;
            case 'submit':
            case 'continue':
                configCategory = 'submit'; break;
            case 'bump':
            case 'resume':
                configCategory = 'bump'; break;
            default: configCategory = 'click'; break;
        }

        // Check if this category is explicitly disabled
        // We default to true if the setting doesn't exist, to match "enabled" behavior
        const specificEnabled = config.get<boolean>(`audio.actions.${configCategory}`);
        if (specificEnabled === false) return;

        // 3. Fallback to Legacy "Per Action" Switch (if new config not set)
        if (specificEnabled === undefined) {
            const legacyPerAction = config.get<boolean>('soundEffectsPerActionEnabled');
            if (legacyPerAction === false) {
                this.play('click');
                return;
            }
        }

        const configured = config.get<Record<string, SoundEffect>>('soundEffectsActionMap') || {};
        const mapped = configured[group] || DEFAULT_ACTION_SOUND_MAP[group] || 'click';
        this.play(mapped);
    }
}
