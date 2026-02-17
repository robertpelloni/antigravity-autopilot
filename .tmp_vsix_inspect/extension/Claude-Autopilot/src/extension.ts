import * as vscode from 'vscode';
import {
    claudePanel, isRunning, setClaudePanel, setIsRunning,
    setExtensionContext, setDebugMode, isDevelopmentMode, developmentOnly,
    getValidatedConfig, showConfigValidationStatus, resetConfigToDefaults, watchConfigChanges, debugMode
} from './core';
import { updateWebviewContent, updateSessionState, getWebviewContent, sendHistoryVisibilitySettings } from './ui';
import { startClaudeSession, resetClaudeSession, handleClaudeKeypress, startProcessingQueue, stopProcessingQueue, flushClaudeOutput, clearClaudeOutput } from './claude';
import {
    removeMessageFromQueue, duplicateMessageInQueue, editMessageInQueue, reorderQueue, clearMessageQueue,
    addMessageToQueueFromWebview, loadWorkspaceHistory, filterHistory, 
    loadPendingQueue, clearPendingQueue, saveWorkspaceHistory, endCurrentHistoryRun,
    deleteHistoryRun, deleteAllHistory,
    startAutomaticMaintenance, stopAutomaticMaintenance, performQueueMaintenance, getMemoryUsageSummary
} from './queue';
import { recoverWaitingMessages, stopSleepPrevention, stopHealthCheck, startScheduledSession, stopScheduledSession } from './services';
import { sendSecuritySettings, toggleXssbypassSetting } from './services/security';
import { debugLog } from './utils';
import { showError, showInfo, showWarning, showInput, Messages, showErrorFromException } from './utils/notifications';
import { runDependencyCheck, showDependencyStatus } from './services/dependency-check/main';
import {getMobileServer} from "./services/mobile/index";

let configWatcher: vscode.Disposable | undefined;


export function activate(context: vscode.ExtensionContext) {
    debugLog('🚀 Activating Claude Autopilot Extension');

    // Set global extension context
    setExtensionContext(context);

    // Initialize configuration
    const config = getValidatedConfig();
    setDebugMode(config.developmentMode);


    // Show configuration status
    showConfigValidationStatus();

    // Start automatic queue maintenance
    startAutomaticMaintenance();

    // Start watching for configuration changes
    configWatcher = watchConfigChanges((newConfig) => {
        setDebugMode(newConfig.developmentMode);
        debugLog('= Configuration updated and applied');
        
        // Update UI immediately when settings change
        if (claudePanel) {
            claudePanel.webview.postMessage({
                command: 'setDevelopmentModeSetting',
                enabled: newConfig.developmentMode
            });
            claudePanel.webview.postMessage({
                command: 'setSkipPermissionsSetting',
                enabled: newConfig.session.skipPermissions
            });
            claudePanel.webview.postMessage({
                command: 'setHistoryVisibility',
                showInUI: newConfig.history.showInUI
            });
        }
    });

    // Load pending queue from previous sessions
    loadPendingQueue();

    // Register commands
    const commands = [
        vscode.commands.registerCommand('claude-autopilot.start', async () => {
            debugLog('🚀 Command: claude-autopilot.start');

            // Check dependencies FIRST and block if missing
            try {
                debugLog('🔍 Validating Claude session dependencies...');
                const dependencies = await runDependencyCheck();
                
                const missingDeps: string[] = [];
                if (!dependencies.claude.available) {
                    missingDeps.push(`• Claude CLI: ${dependencies.claude.error}`);
                }
                if (!dependencies.python.available) {
                    missingDeps.push(`• Python: ${dependencies.python.error}`);
                }
                if (!dependencies.wrapper.available) {
                    missingDeps.push(`• PTY Wrapper: ${dependencies.wrapper.error}`);
                }
                
                if (missingDeps.length > 0) {
                    debugLog('❌ BLOCKING START - Missing dependencies detected');
                    showDependencyStatus(dependencies);
                    return; // BLOCK START
                }
                
                debugLog('✅ All dependencies available, proceeding with start');
                
            } catch (error) {
                debugLog(`❌ Failed to check dependencies: ${error}`);
                showErrorFromException(error, 'Failed to check dependencies');
                return; // BLOCK START
            }

            // Check if panel is already open
            if (claudePanel) {
                claudePanel.reveal(vscode.ViewColumn.One);
                return;
            }

            // Create and show webview panel
            const panel = vscode.window.createWebviewPanel(
                'claudeAutopilot',
                'Claude Autopilot',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
                    retainContextWhenHidden: true,
                    enableCommandUris: true
                }
            );

            setClaudePanel(panel);

            // Set webview content
            panel.webview.html = getWebviewContent(context, panel.webview);

            // Initialize webview with current state after a brief delay
            // to ensure the webview DOM is ready to receive messages
            setTimeout(() => {
                updateWebviewContent();
                updateSessionState();
            }, 100);

            // Handle panel disposal
            panel.onDidDispose(() => {
                debugLog('📱 Webview panel disposed');
                setClaudePanel(null);
            });

            // Handle messages from webview
            panel.webview.onDidReceiveMessage(
                async (message) => {
                    debugLog(`📨 Webview message: ${message.command}`);
                    
                    switch (message.command) {
                        case 'addMessage':
                            addMessageToQueueFromWebview(message.text);
                            break;
                        case 'startProcessing':
                            try {
                                if (!isRunning) {
                                    await startProcessingQueue(message.skipPermissions);
                                }
                            } catch (error) {
                                showErrorFromException(error, Messages.FAILED_TO_START_PROCESSING);
                                debugLog(`Error starting processing: ${error}`);
                            }
                            break;
                        case 'stopProcessing':
                            stopProcessingQueue();
                            break;
                        case 'resetSession':
                            resetClaudeSession();
                            break;
                        case 'startClaudeSession':
                            startClaudeSession(message.skipPermissions).catch(error => {
                                showErrorFromException(error, Messages.FAILED_TO_START_SESSION);
                                debugLog(`Error starting Claude session: ${error}`);
                            });
                            break;
                        case 'claudeKeypress':
                            handleClaudeKeypress(message.key);
                            break;
                        case 'removeMessage':
                            removeMessageFromQueue(message.messageId);
                            break;
                        case 'duplicateMessage':
                            duplicateMessageInQueue(message.messageId);
                            break;
                        case 'editMessage':
                            console.log('Extension received editMessage command:', message);
                            editMessageInQueue(message.messageId, message.newText);
                            break;
                        case 'reorderQueue':
                            reorderQueue(message.fromIndex, message.toIndex);
                            break;
                        case 'clearQueue':
                            clearMessageQueue();
                            break;
                        case 'clearOutput':
                            clearClaudeOutput();
                            break;
                        case 'flushOutput':
                            flushClaudeOutput();
                            break;
                        case 'loadHistory':
                            loadWorkspaceHistory();
                            break;
                        case 'filterHistory':
                            filterHistory(message.filter || '');
                            break;
                        case 'clearHistory':
                            context.globalState.update('claudeAutopilot.workspaceHistory', undefined);
                            panel.webview.postMessage({
                                command: 'historyCleared'
                            });
                            break;
                        case 'deleteHistoryRun':
                            deleteHistoryRun(message.runId);
                            break;
                        case 'deleteAllHistory':
                            deleteAllHistory();
                            break;
                        case 'clearPendingQueue':
                            clearPendingQueue();
                            break;
                        case 'manualMaintenance':
                            performQueueMaintenance();
                            break;
                        case 'getMemoryUsage':
                            const memoryUsage = getMemoryUsageSummary();
                            panel.webview.postMessage({
                                command: 'memoryUsageResult',
                                data: memoryUsage
                            });
                            break;
                        case 'resetConfig':
                            resetConfigToDefaults();
                            break;
                        case 'toggleXssbypass':
                            toggleXssbypassSetting(message.enabled);
                            break;
                        case 'getWorkspaceFiles':
                            await handleWorkspaceFilesRequest(message.query, message.page, message.pageSize);
                            break;
                        case 'startWebInterface':
                            try {
                                await vscode.commands.executeCommand('claude-autopilot.startWebInterface');
                            } catch (error) {
                                showErrorFromException(error, Messages.FAILED_TO_START_WEB_INTERFACE);
                            }
                            break;
                        case 'stopWebInterface':
                            try {
                                await vscode.commands.executeCommand('claude-autopilot.stopWebInterface');
                            } catch (error) {
                                showErrorFromException(error, Messages.FAILED_TO_STOP_WEB_INTERFACE);
                            }
                            break;
                        case 'showWebInterfaceQR':
                            try {
                                await vscode.commands.executeCommand('claude-autopilot.showWebInterfaceQR');
                            } catch (error) {
                                showErrorFromException(error, Messages.FAILED_TO_SHOW_QR);
                            }
                            break;
                        case 'openWebInterface':
                            try {
                                const webServer = getMobileServer();
                                const webUrl = webServer.getWebUrl();
                                if (webUrl) {
                                    vscode.env.openExternal(vscode.Uri.parse(webUrl));
                                } else {
                                    showError(Messages.WEB_INTERFACE_NOT_RUNNING);
                                }
                            } catch (error) {
                                showErrorFromException(error, Messages.FAILED_TO_OPEN_WEB_INTERFACE);
                            }
                            break;
                        case 'getWebServerStatus':
                            try {
                                const webServer = getMobileServer();
                                const status = webServer.getServerStatus();
                                panel.webview.postMessage({
                                    command: 'webServerStatusUpdate',
                                    status: status
                                });
                            } catch (error) {
                                debugLog(`Error getting web server status: ${error}`);
                            }
                            break;
                        case 'openSettings':
                            try {
                                vscode.commands.executeCommand('workbench.action.openSettings', '@ext:benbasha.claude-autopilot');
                            } catch (error) {
                                debugLog(`Error opening settings: ${error}`);
                                showErrorFromException(error, Messages.FAILED_TO_OPEN_SETTINGS);
                            }
                            break;
                        case 'getDevelopmentModeSetting':
                            try {
                                const config = getValidatedConfig();
                                panel.webview.postMessage({
                                    command: 'setDevelopmentModeSetting',
                                    enabled: config.developmentMode
                                });
                            } catch (error) {
                                debugLog(`Error getting development mode setting: ${error}`);
                            }
                            break;
                        case 'getSkipPermissionsSetting':
                            try {
                                const config = getValidatedConfig();
                                panel.webview.postMessage({
                                    command: 'setSkipPermissionsSetting',
                                    enabled: config.session.skipPermissions
                                });
                            } catch (error) {
                                debugLog(`Error getting skip permissions setting: ${error}`);
                            }
                            break;
                        case 'updateSkipPermissionsSetting':
                            try {
                                const workspaceConfig = vscode.workspace.getConfiguration('claudeAutopilot');
                                await workspaceConfig.update('session.skipPermissions', message.enabled);
                                debugLog(`Updated skipPermissions setting to: ${message.enabled}`);
                            } catch (error) {
                                debugLog(`Error updating skip permissions setting: ${error}`);
                                showErrorFromException(error, 'Failed to update skip permissions setting');
                            }
                            break;
                        case 'getHistoryVisibilitySetting':
                            try {
                                const config = getValidatedConfig();
                                panel.webview.postMessage({
                                    command: 'setHistoryVisibility',
                                    showInUI: config.history.showInUI
                                });
                            } catch (error) {
                                debugLog(`Error getting history visibility setting: ${error}`);
                            }
                            break;
                        case 'simulateUsageLimit':
                            try {
                                const { simulateUsageLimit } = await import('./services/usage');
                                simulateUsageLimit();
                                showInfo('Usage limit simulation started (10 seconds)');
                            } catch (error) {
                                debugLog(`Error simulating usage limit: ${error}`);
                                showErrorFromException(error, 'Failed to simulate usage limit');
                            }
                            break;
                        case 'clearAllTimers':
                            try {
                                const { clearAllTimers } = await import('./services/usage');
                                clearAllTimers();
                                showInfo('All timers cleared');
                            } catch (error) {
                                debugLog(`Error clearing timers: ${error}`);
                                showErrorFromException(error, 'Failed to clear timers');
                            }
                            break;
                        case 'debugQueueState':
                            try {
                                const { debugQueueState } = await import('./services/usage');
                                debugQueueState();
                            } catch (error) {
                                debugLog(`Error debugging queue state: ${error}`);
                                showErrorFromException(error, 'Failed to debug queue state');
                            }
                            break;
                        case 'toggleDebugLogging':
                            try {
                                const newDebugMode = !debugMode;
                                
                                setDebugMode(newDebugMode);
                                showInfo(`Debug logging ${newDebugMode ? 'enabled' : 'disabled'}`);
                            } catch (error) {
                                debugLog(`Error toggling debug logging: ${error}`);
                                showErrorFromException(error, 'Failed to toggle debug logging');
                            }
                            break;
                        default:
                            debugLog(`⚠️ Unknown webview command: ${message.command}`);
                    }
                },
                undefined,
                context.subscriptions
            );

            // Send initial data to webview
            updateWebviewContent();
            sendSecuritySettings();
            sendHistoryVisibilitySettings();
            
            // Send development mode setting and skip permissions setting
            setTimeout(() => {
                const config = getValidatedConfig();
                panel.webview.postMessage({
                    command: 'setDevelopmentModeSetting',
                    enabled: config.developmentMode
                });
                panel.webview.postMessage({
                    command: 'setSkipPermissionsSetting',
                    enabled: config.session.skipPermissions
                });
            }, 150);

            // Auto-start session if configured
            const autoStart = config.session.autoStart;
            const scheduledStart = config.session.scheduledStartTime;
            
            if (autoStart && !scheduledStart) {
                debugLog('= Auto-starting Claude session');
                try {
                    await startClaudeSession(config.session.skipPermissions);
                    if (config.developmentMode) {
                        developmentOnly(() => {
                            debugLog('🔍 Development mode: Auto-starting processing queue');
                            startProcessingQueue(config.session.skipPermissions).catch(error => {
                                debugLog(`Error auto-starting processing queue: ${error}`);
                            });
                        });
                    }
                } catch (error) {
                    debugLog(`Error auto-starting Claude session: ${error}`);
                    showWarning(Messages.FAILED_AUTO_START_SESSION);
                }
            } else if (scheduledStart) {
                debugLog(`✅ Scheduling Claude session start for ${scheduledStart}`);
                startScheduledSession(() => {
                    startClaudeSession(config.session.skipPermissions);
                });
            }
        }),

        vscode.commands.registerCommand('claude-autopilot.stop', () => {
            debugLog('🚀 Command: claude-autopilot.stop');
            if (claudePanel) {
                claudePanel.dispose();
                setClaudePanel(null);
            }
            stopProcessingQueue();
        }),

        vscode.commands.registerCommand('claude-autopilot.addMessage', async () => {
            debugLog('🚀 Command: claude-autopilot.addMessage');
            
            const message = await showInput({
                prompt: 'Enter message to add to Claude queue',
                placeholder: 'Type your message here...'
            });
            
            if (message) {
                addMessageToQueueFromWebview(message);
                showInfo(Messages.MESSAGE_ADDED);
            }
        }),

        vscode.commands.registerCommand('claude-autopilot.startWebInterface', async () => {
            debugLog('🚀 Command: claude-autopilot.startWebInterface');
            
            // Check web interface dependencies FIRST 
            try {
                debugLog('🔍 Validating web interface dependencies...');
                const config = vscode.workspace.getConfiguration('claudeAutopilot');
                const useExternalServer = config.get<boolean>('webInterface.useExternalServer', false);
                
                if (useExternalServer) {
                    const dependencies = await runDependencyCheck();
                    
                    if (!dependencies.ngrok.available) {
                        debugLog('❌ BLOCKING WEB INTERFACE START - ngrok missing');
                        showDependencyStatus(dependencies);
                        return; // BLOCK START
                    }
                }
                
                debugLog('✅ Web interface dependencies available, proceeding');
                
            } catch (error) {
                debugLog(`❌ Failed to check web interface dependencies: ${error}`);
                showErrorFromException(error, 'Failed to check dependencies');
                return; // BLOCK START
            }
            
            try {
                const webServer = getMobileServer();
                const baseUrl = await webServer.start();
                
                // Generate QR code and get the authenticated URL
                const qrCodeDataUrl = await webServer.generateQRCode();
                const webUrl = webServer.getWebUrl();
                
                if (!webUrl) {
                    throw new Error('Failed to get web URL');
                }
                
                debugLog(`🌐 Start Interface - Display URL: ${webUrl}`);
                
                // Show QR code in webview
                const panel = vscode.window.createWebviewPanel(
                    'claudeMobile',
                    'Claude Web Interface',
                    vscode.ViewColumn.Two,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        enableCommandUris: true
                    }
                );

                panel.webview.html = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Claude Web Interface</title>
                        <style>
                            body {
                                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                                margin: 0;
                                padding: 20px;
                                background-color: var(--vscode-editor-background);
                                color: var(--vscode-editor-foreground);
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                min-height: 100vh;
                                box-sizing: border-box;
                            }
                            .container {
                                max-width: 500px;
                                text-align: center;
                                background: var(--vscode-panel-background);
                                border: 1px solid var(--vscode-panel-border);
                                border-radius: 8px;
                                padding: 30px;
                                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                            }
                            h1 {
                                color: var(--vscode-foreground);
                                margin-bottom: 10px;
                                font-size: 24px;
                                font-weight: 600;
                            }
                            .subtitle {
                                color: var(--vscode-descriptionForeground);
                                margin-bottom: 30px;
                                font-size: 14px;
                                line-height: 1.5;
                            }
                            .qr-container {
                                background: white;
                                padding: 20px;
                                border-radius: 8px;
                                margin: 20px 0;
                                display: inline-block;
                                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                            }
                            .qr-code {
                                max-width: 100%;
                                height: auto;
                            }
                            .url-container {
                                margin: 20px 0;
                                padding: 10px;
                                background: var(--vscode-textBlockQuote-background);
                                border-left: 4px solid var(--vscode-textBlockQuote-border);
                                border-radius: 4px;
                            }
                            .url {
                                font-family: 'Courier New', monospace;
                                font-size: 12px;
                                word-break: break-all;
                                color: var(--vscode-textLink-foreground);
                            }
                            .instructions {
                                margin-top: 20px;
                                text-align: left;
                                color: var(--vscode-descriptionForeground);
                                font-size: 13px;
                                line-height: 1.6;
                            }
                            .instructions ol {
                                padding-left: 20px;
                            }
                            .instructions li {
                                margin-bottom: 8px;
                            }
                            .status {
                                margin-top: 20px;
                                padding: 10px;
                                border-radius: 4px;
                                font-size: 13px;
                                background: var(--vscode-badge-background);
                                color: var(--vscode-badge-foreground);
                            }
                            .button {
                                background: var(--vscode-button-background);
                                color: var(--vscode-button-foreground);
                                border: none;
                                padding: 8px 16px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 13px;
                                margin: 5px;
                            }
                            .button:hover {
                                background: var(--vscode-button-hoverBackground);
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>🌐 Claude Web Interface</h1>
                            <p class="subtitle">
                                Scan the QR code or visit the URL to access Claude Autopilot from your mobile device
                            </p>
                            
                            <div class="qr-container">
                                <img src="${qrCodeDataUrl}" alt="QR Code for Web Interface" class="qr-code" />
                            </div>
                            
                            <div class="url-container">
                                <strong>Web URL:</strong><br>
                                <div class="url">${webUrl}</div>
                            </div>
                            
                            <div class="instructions">
                                <strong>Instructions:</strong>
                                <ol>
                                    <li>Open your mobile camera or QR code scanner</li>
                                    <li>Scan the QR code above, or manually visit the URL</li>
                                    <li>The interface will connect automatically with authentication</li>
                                    <li>Start managing your Claude queue from your mobile device!</li>
                                </ol>
                            </div>
                            
                            <div class="status">
                                 Web server is running and ready for connections
                            </div>
                            
                            <button class="button" onclick="copyUrl()">📋 Copy URL</button>
                            <button class="button" onclick="openUrl()">🔗 Open in Browser</button>
                            <button class="button" onclick="stopServer()">⏹️ Stop Server</button>
                        </div>
                        
                        <script>
                            const vscode = acquireVsCodeApi();
                            
                            function copyUrl() {
                                navigator.clipboard.writeText('${webUrl}').then(() => {
                                    vscode.postMessage({ command: 'showMessage', text: 'URL copied to clipboard!' });
                                });
                            }
                            
                            function openUrl() {
                                vscode.postMessage({ command: 'openUrl', url: '${webUrl}' });
                            }
                            
                            function stopServer() {
                                vscode.postMessage({ command: 'stopMobileServer' });
                            }
                        </script>
                    </body>
                    </html>
                `;

                panel.webview.onDidReceiveMessage(
                    (message) => {
                        switch (message.command) {
                            case 'showMessage':
                                showInfo(message.text);
                                break;
                            case 'openUrl':
                                vscode.env.openExternal(vscode.Uri.parse(message.url));
                                break;
                            case 'stopMobileServer':
                                vscode.commands.executeCommand('claude-autopilot.stopWebInterface');
                                panel.dispose();
                                break;
                        }
                    },
                    undefined,
                    context.subscriptions
                );

                showInfo(
                    Messages.WEB_INTERFACE_STARTED(webUrl)
                );
                
                // Send status update to main panel if open
                if (claudePanel) {
                    const status = webServer.getServerStatus();
                    claudePanel.webview.postMessage({
                        command: 'webServerStatusUpdate',
                        status: status
                    });
                }
                
            } catch (error) {
                debugLog(`❌ Failed to start web interface: ${error}`);
                showErrorFromException(error, Messages.FAILED_TO_START_WEB_INTERFACE);
            }
        }),

        vscode.commands.registerCommand('claude-autopilot.stopWebInterface', async () => {
            debugLog('🔄 Command: claude-autopilot.stopWebInterface');
            
            try {
                const webServer = getMobileServer();
                await webServer.stop();
                showInfo(Messages.WEB_INTERFACE_STOPPED);
                
                // Send status update to main panel if open
                if (claudePanel) {
                    const status = webServer.getServerStatus();
                    claudePanel.webview.postMessage({
                        command: 'webServerStatusUpdate',
                        status: status
                    });
                }
            } catch (error) {
                debugLog(`❌ Failed to stop web interface: ${error}`);
                showErrorFromException(error, Messages.FAILED_TO_STOP_WEB_INTERFACE);
            }
        }),

        vscode.commands.registerCommand('claude-autopilot.showWebInterfaceQR', async () => {
            debugLog('🔄 Command: claude-autopilot.showWebInterfaceQR');
            
            try {
                const webServer = getMobileServer();
                
                if (!webServer.isRunning()) {
                    showError(Messages.WEB_INTERFACE_NOT_RUNNING);
                    return;
                }

                // Generate QR code and get the authenticated URL
                const qrCodeDataUrl = await webServer.generateQRCode();
                const serverStatus = webServer.getServerStatus();
                const webUrl = webServer.getWebUrl();
                
                if (!webUrl) {
                    throw new Error('Failed to get web URL');
                }
                
                debugLog(`🌐 Show QR - Display URL: ${webUrl}`);
                
                // Show QR code in webview
                const panel = vscode.window.createWebviewPanel(
                    'claudeWebQR',
                    'Claude Web Interface QR Code',
                    vscode.ViewColumn.Two,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        enableCommandUris: true
                    }
                );

                panel.webview.html = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Claude Web Interface QR Code</title>
                        <style>
                            body {
                                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                                margin: 0;
                                padding: 20px;
                                background-color: var(--vscode-editor-background);
                                color: var(--vscode-editor-foreground);
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                min-height: 100vh;
                                box-sizing: border-box;
                            }
                            .container {
                                max-width: 500px;
                                text-align: center;
                                background: var(--vscode-panel-background);
                                border: 1px solid var(--vscode-panel-border);
                                border-radius: 8px;
                                padding: 30px;
                                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                            }
                            h1 {
                                color: var(--vscode-foreground);
                                margin-bottom: 10px;
                                font-size: 24px;
                                font-weight: 600;
                            }
                            .subtitle {
                                color: var(--vscode-descriptionForeground);
                                margin-bottom: 30px;
                                font-size: 14px;
                                line-height: 1.5;
                            }
                            .qr-container {
                                background: white;
                                padding: 20px;
                                border-radius: 8px;
                                margin: 20px 0;
                                display: inline-block;
                                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                            }
                            .qr-code {
                                max-width: 100%;
                                height: auto;
                            }
                            .url-container {
                                margin: 20px 0;
                                padding: 10px;
                                background: var(--vscode-textBlockQuote-background);
                                border-left: 4px solid var(--vscode-textBlockQuote-border);
                                border-radius: 4px;
                            }
                            .url {
                                font-family: 'Courier New', monospace;
                                font-size: 12px;
                                word-break: break-all;
                                color: var(--vscode-textLink-foreground);
                            }
                            .status {
                                margin: 20px 0;
                                padding: 10px;
                                border-radius: 4px;
                                font-size: 13px;
                                background: var(--vscode-badge-background);
                                color: var(--vscode-badge-foreground);
                            }
                            .button {
                                background: var(--vscode-button-background);
                                color: var(--vscode-button-foreground);
                                border: none;
                                padding: 8px 16px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 13px;
                                margin: 5px;
                            }
                            .button:hover {
                                background: var(--vscode-button-hoverBackground);
                            }
                            .button-group {
                                margin-top: 20px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>🌐 Claude Web Interface</h1>
                            <p class="subtitle">
                                Scan the QR code or visit the URL to access Claude Autopilot from your web browser
                            </p>
                            
                            <div class="qr-container">
                                <img src="${qrCodeDataUrl}" alt="QR Code for Web Interface" class="qr-code" />
                            </div>
                            
                            <div class="url-container">
                                <strong>Web URL:</strong><br>
                                <div class="url">${webUrl}</div>
                            </div>
                            
                            <div class="status">
                                ✅ Web server is running<br>
                                🌍 ${serverStatus.isExternal ? 'External server (ngrok)' : 'Local network'}<br>
                                ${serverStatus.hasPassword ? '🔒 Password protected (external tunnel)' : '🔓 No password (local network only)'}<br>
                                ${serverStatus.blockedIPs && serverStatus.blockedIPs > 0 ? `🚫 ${serverStatus.blockedIPs} blocked IPs` : ''}
                            </div>
                            
                            <div class="button-group">
                                <button class="button" onclick="copyUrl()">📋 Copy URL</button>
                                <button class="button" onclick="openUrl()">🔗 Open in Browser</button>
                                <button class="button" onclick="stopServer()">⏹️ Stop Server</button>
                            </div>
                        </div>
                        
                        <script>
                            const vscode = acquireVsCodeApi();
                            
                            function copyUrl() {
                                navigator.clipboard.writeText('${webUrl}').then(() => {
                                    vscode.postMessage({ command: 'showMessage', text: 'URL copied to clipboard!' });
                                });
                            }
                            
                            function openUrl() {
                                vscode.postMessage({ command: 'openUrl', url: '${webUrl}' });
                            }
                            
                            function stopServer() {
                                vscode.postMessage({ command: 'stopWebServer' });
                            }
                        </script>
                    </body>
                    </html>
                `;

                panel.webview.onDidReceiveMessage(
                    (message) => {
                        switch (message.command) {
                            case 'showMessage':
                                showInfo(message.text);
                                break;
                            case 'openUrl':
                                vscode.env.openExternal(vscode.Uri.parse(message.url));
                                break;
                            case 'stopWebServer':
                                vscode.commands.executeCommand('claude-autopilot.stopWebInterface');
                                panel.dispose();
                                break;
                        }
                    },
                    undefined,
                    context.subscriptions
                );
                
            } catch (error) {
                debugLog(`❌ Failed to show web interface QR: ${error}`);
                showErrorFromException(error, Messages.FAILED_TO_SHOW_QR);
            }
        })
    ];

    // Watch for external server setting changes specifically
    const externalServerWatcher = vscode.workspace.onDidChangeConfiguration(async event => {
        debugLog(`🔧 Configuration change detected, affects external server: ${event.affectsConfiguration('claudeAutopilot.webInterface.useExternalServer')}`);
        
        if (event.affectsConfiguration('claudeAutopilot.webInterface.useExternalServer')) {
            debugLog('🌐 External server setting changed, validating ngrok...');
            const { validateExternalServerSetting } = await import('./services/dependency-check/main');
            await validateExternalServerSetting();
        }
    });

    // Add all commands and watchers to subscriptions
    context.subscriptions.push(...commands, configWatcher!, externalServerWatcher);

    debugLog(' Claude Autopilot Extension activated successfully');
}

export function deactivate() {
    debugLog('🚀 Deactivating Claude Autopilot Extension');
    
    try {
        // Stop scheduled sessions
        stopScheduledSession();
        
        // Save workspace history
        saveWorkspaceHistory();
        
        // End current history run
        endCurrentHistoryRun();
        
        // Stop automatic maintenance
        stopAutomaticMaintenance();
        
        // Stop sleep prevention
        stopSleepPrevention();
        
        // Stop health check
        stopHealthCheck();
        
        // Note: configWatcher is now managed by context.subscriptions
        
        // Stop web server
        const webServer = getMobileServer();
        if (webServer) {
            webServer.stop().catch(error => {
                debugLog(`Error stopping web server during deactivation: ${error}`);
            });
        }
        
        debugLog(' Claude Autopilot Extension deactivated successfully');
    } catch (error) {
        debugLog(`L Error during extension deactivation: ${error}`);
    }
}

async function handleWorkspaceFilesRequest(query: string, page: number = 1, pageSize: number = 50): Promise<void> {
    if (!claudePanel) {
        return;
    }

    try {
        const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/.next/**,**/.vscode/**,**/coverage/**,**/.nyc_output/**,**/logs/**,**/*.log,**/tmp/**,**/temp/**,**/.env*,**/.DS_Store,**/Thumbs.db,**/*.min.js,**/*.bundle.js,**/*.chunk.js,**/package-lock.json,**/yarn.lock,**/pnpm-lock.yaml}';
        
        let files: vscode.Uri[] = [];
        
        if (query && query.trim()) {
            // Search for both files containing query AND files inside folders containing query
            const [fileMatches, folderMatches] = await Promise.all([
                vscode.workspace.findFiles(`**/*${query}*`, excludePattern, 500),
                vscode.workspace.findFiles(`**/*${query}*/**`, excludePattern, 500)
            ]);
            files = [...fileMatches, ...folderMatches];
        } else {
            files = await vscode.workspace.findFiles('**/*', excludePattern, 1000);
        }
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) {
            claudePanel.webview.postMessage({
                command: 'workspaceFilesResult',
                files: [],
                query: query
            });
            return;
        }

        let results = files
            .map(file => ({
                path: vscode.workspace.asRelativePath(file, false),
                name: vscode.workspace.asRelativePath(file, false).split('/').pop() || ''
            }))
            .filter((file, index, self) => index === self.findIndex(f => f.path === file.path))
            .sort((a, b) => {
                // Sort by relevance: exact matches first, then by name length, then alphabetically
                if (query) {
                    const aExact = a.name.toLowerCase() === query.toLowerCase();
                    const bExact = b.name.toLowerCase() === query.toLowerCase();
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;
                    
                    const aIncludes = a.name.toLowerCase().includes(query.toLowerCase());
                    const bIncludes = b.name.toLowerCase().includes(query.toLowerCase());
                    if (aIncludes && !bIncludes) return -1;
                    if (!aIncludes && bIncludes) return 1;
                }
                return a.path.localeCompare(b.path);
            });

        // Implement pagination
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedFiles = results.slice(startIndex, endIndex);

        claudePanel.webview.postMessage({
            command: 'workspaceFilesResult',
            files: paginatedFiles,
            query: query,
            pagination: {
                page: page,
                pageSize: pageSize,
                totalResults: results.length,
                totalPages: Math.ceil(results.length / pageSize),
                hasNextPage: endIndex < results.length
            }
        });

    } catch (error) {
        debugLog(`Error getting workspace files: ${error}`);
        if (claudePanel) {
            claudePanel.webview.postMessage({
                command: 'workspaceFilesResult',
                files: [],
                query: query,
                error: (error as Error).message
            });
        }
    }
}