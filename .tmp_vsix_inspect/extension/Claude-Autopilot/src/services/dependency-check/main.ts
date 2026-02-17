/**
 * Main dependency checking orchestration
 */
import * as vscode from 'vscode';
import { DependencyCheckResults } from './types';
import { 
    checkClaudeInstallation,
    checkPythonInstallation, 
    checkPtyWrapperAvailability,
    checkNgrokInstallation
} from './checkers';
import * as os from 'os';

function getPythonInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `Python Installation (macOS):
1. Install via Homebrew: brew install python3
2. Or download from: https://python.org/downloads
3. Restart VS Code
4. Verify installation: python3 --version`;
            
        case 'win32': // Windows  
            return `Python Installation (Windows):
1. Download from: https://python.org/downloads
2. During installation, check "Add Python to PATH"
3. Restart VS Code
4. Verify installation: python --version`;
            
        case 'linux': // Linux
            return `Python Installation (Linux):
1. Ubuntu/Debian: sudo apt update && sudo apt install python3
2. CentOS/RHEL: sudo yum install python3
3. Restart VS Code
4. Verify installation: python3 --version`;
            
        default:
            return `Python Installation:
1. Visit: https://python.org/downloads
2. Download Python 3.9 or higher
3. Follow platform-specific installation instructions
4. Restart VS Code
5. Verify installation: python3 --version`;
    }
}

// Re-export status functions
export { showDependencyStatus, showInstallationInstructions } from './status';

// Debounce validation to prevent multiple simultaneous checks
let validationTimeout: NodeJS.Timeout | undefined;

export async function runDependencyCheck(): Promise<DependencyCheckResults> {
    // Check if external server (ngrok) is enabled
    const config = vscode.workspace.getConfiguration('claudeAutopilot');
    const useExternalServer = config.get<boolean>('webInterface.useExternalServer', false);

    // Run core checks concurrently
    const [claude, pythonResult, wrapper] = await Promise.all([
        checkClaudeInstallation(),
        checkPythonInstallation().catch(error => ({
            available: false,
            error: error.message,
            installInstructions: getPythonInstallInstructions()
        })),
        checkPtyWrapperAvailability()
    ]);
    
    const python = pythonResult;

    let ngrok;
    if (useExternalServer) {
        // Only check ngrok if external server is enabled
        ngrok = await checkNgrokInstallation();
        
        // If ngrok is not available but external server is enabled, disable external server
        if (!ngrok.available) {
            await handleNgrokUnavailable();
        }
    } else {
        // Mock successful ngrok check when external server is disabled
        ngrok = {
            available: true,
            version: 'Not required (external server disabled)',
            path: 'n/a'
        };
    }

    return {
        claude,
        python,
        wrapper,
        ngrok
    };
}

/**
 * Check ngrok availability when external server setting is enabled
 * Called when user enables external server through settings
 */
export async function validateExternalServerSetting(): Promise<boolean> {
    // Clear any existing validation timeout to debounce rapid changes
    if (validationTimeout) {
        clearTimeout(validationTimeout);
    }
    
    // Debounce rapid configuration changes
    return new Promise((resolve) => {
        validationTimeout = setTimeout(async () => {
            try {
                const result = await performValidation();
                resolve(result);
            } catch (error) {
                console.error('Validation error:', error);
                resolve(false);
            }
        }, 200);
    });
}

async function performValidation(): Promise<boolean> {
    console.log('🔍 Starting external server validation...');
    
    const config = vscode.workspace.getConfiguration('claudeAutopilot');
    const settingInspection = config.inspect('webInterface.useExternalServer');
    
    // Debug configuration details
    console.log('  - Final value:', config.get<boolean>('webInterface.useExternalServer', false));
    console.log('  - Global value:', settingInspection?.globalValue);
    console.log('  - Workspace value:', settingInspection?.workspaceValue);
    console.log('  - Default value:', settingInspection?.defaultValue);
    
    // Check if external server is enabled in either global or workspace settings
    const useExternalServerGlobal = settingInspection?.globalValue === true;
    const useExternalServerWorkspace = settingInspection?.workspaceValue === true;
    const useExternalServer = useExternalServerGlobal || useExternalServerWorkspace;
    
    console.log('  - Should validate:', useExternalServer, '(global:', useExternalServerGlobal, ', workspace:', useExternalServerWorkspace, ')');
    
    if (!useExternalServer) {
        console.log('  - Skipping validation (setting is false in both scopes)');
        return true; // No need to check if not enabled
    }
    
    // Show checking message and await the result
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Checking ngrok availability...",
        cancellable: false
    }, async () => {
        console.log('  - Starting ngrok check...');
        const ngrokResult = await checkNgrokInstallation();
        console.log('  - Ngrok check result:', ngrokResult.available, ngrokResult.version || ngrokResult.error);
        
        if (!ngrokResult.available) {
            console.log('  - Ngrok not available, calling handleNgrokUnavailable');
            await handleNgrokUnavailable();
            return false;
        } else {
            // Show success message when ngrok is available
            vscode.window.showInformationMessage(
                `✅ External server enabled successfully. ${ngrokResult.version} is ready.`
            );
            return true;
        }
    });
    
    console.log('  - Validation completed with result:', result);
    return result || false;
}

/**
 * Handle the case when ngrok is not available but external server is enabled
 */
async function handleNgrokUnavailable(): Promise<void> {
    const config = vscode.workspace.getConfiguration('claudeAutopilot');
    
    try {
        // Check where the setting is configured (user vs workspace)
        const settingInspection = config.inspect('webInterface.useExternalServer');
        const isEnabledInGlobal = settingInspection?.globalValue === true;
        const isEnabledInWorkspace = settingInspection?.workspaceValue === true;
        
        console.log('  - Handling ngrok unavailable. Global:', isEnabledInGlobal, ', Workspace:', isEnabledInWorkspace);
        
        // If enabled in global but overridden by workspace false, clear workspace setting first
        if (isEnabledInGlobal && settingInspection?.workspaceValue === false) {
            console.log('  - Clearing workspace override to respect user setting');
            await config.update('webInterface.useExternalServer', undefined, vscode.ConfigurationTarget.Workspace);
            // Small delay to let the setting clear
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Now determine which scope to disable
        let targetScope = vscode.ConfigurationTarget.Workspace;
        let scopeMessage = 'workspace';
        
        // If the setting is only in user settings, update user settings
        if (isEnabledInGlobal && !isEnabledInWorkspace) {
            targetScope = vscode.ConfigurationTarget.Global;
            scopeMessage = 'user';
        }
        
        await config.update('webInterface.useExternalServer', false, targetScope);
        
        // Show error message to user
        vscode.window.showErrorMessage(
            `ngrok is required for external server but not available. External server has been disabled in ${scopeMessage} settings. Please install ngrok globally: 'npm install -g ngrok'`,
            'Download ngrok'
        ).then(selection => {
            if (selection === 'Download ngrok') {
                vscode.env.openExternal(vscode.Uri.parse('https://ngrok.com/download'));
            }
        });
    } catch (error) {
        console.error('Failed to disable external server setting:', error);
    }
}