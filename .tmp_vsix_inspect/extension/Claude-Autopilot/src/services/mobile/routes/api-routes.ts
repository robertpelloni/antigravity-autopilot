/**
 * API routes for the mobile server
 */
import { Request, Response, Application } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { 
    addMessageToQueueFromWebview,
    removeMessageFromQueue,
    editMessageInQueue,
    duplicateMessageInQueue,
    clearMessageQueue
} from '../../../queue/manager';
import { 
    startProcessingQueue, 
    stopProcessingQueue 
} from '../../../claude/communication';
import { startClaudeSession, handleClaudeKeypress } from '../../../claude/session';
import { 
    messageQueue, 
    isRunning, 
    claudeOutputBuffer, 
    processingQueue,
    sessionReady,
    currentMessage,
    setProcessingQueue,
    setIsRunning
} from '../../../core/state';
import { AuthManager, AuthConfig } from '../auth/';
import { FileUtils } from '../utils';
import { getErrorMessage } from '../../../utils/error-handler';
import { FileSearchService } from '../search';
import { MESSAGE_TYPES } from '../types';

export class APIRoutes {
    private fileUtils: FileUtils;
    private fileSearchService: FileSearchService;
    private authManager: AuthManager;
    private authConfig: AuthConfig;
    private notifyCallback?: (type: string) => void;

    constructor(authManager: AuthManager, authConfig: AuthConfig, fileSearchService: FileSearchService) {
        this.authManager = authManager;
        this.authConfig = authConfig;
        this.fileUtils = new FileUtils();
        this.fileSearchService = fileSearchService;
    }

    public setNotificationCallback(callback: (type: string) => void): void {
        this.notifyCallback = callback;
    }

    setupRoutes(app: Application): void {
        // Status API
        app.get('/api/status', (req: Request, res: Response) => {
            const workspace = this.fileUtils.getWorkspaceInfo();
            res.json({
                isRunning,
                sessionReady,
                processingQueue,
                queueLength: messageQueue.length,
                currentMessage: currentMessage?.text?.substring(0, 100) || null,
                workspace: workspace
            });
        });

        // Queue management APIs
        app.get('/api/queue', (req: Request, res: Response) => {
            res.json(messageQueue.map(msg => ({
                id: msg.id,
                text: msg.text.substring(0, 200) + (msg.text.length > 200 ? '...' : ''),
                status: msg.status,
                timestamp: msg.timestamp,
                output: msg.output?.substring(0, 500) || null
            })));
        });

        app.post('/api/queue/add', (req: Request, res: Response) => {
            const { message } = req.body;
            if (!message || typeof message !== 'string') {
                return res.status(400).json({ error: 'Message is required' });
            }
            
            try {
                addMessageToQueueFromWebview(message);
                this.notifyCallback?.(MESSAGE_TYPES.QUEUE_UPDATE);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to add message' });
            }
        });

        app.put('/api/queue/:id', (req: Request, res: Response) => {
            const { id } = req.params;
            const { text } = req.body;
            
            if (!text || typeof text !== 'string') {
                return res.status(400).json({ error: 'Text is required' });
            }
            
            try {
                editMessageInQueue(id, text);
                this.notifyCallback?.(MESSAGE_TYPES.QUEUE_UPDATE);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to edit message' });
            }
        });

        app.delete('/api/queue/:id', (req: Request, res: Response) => {
            const { id } = req.params;
            
            try {
                removeMessageFromQueue(id);
                this.notifyCallback?.(MESSAGE_TYPES.QUEUE_UPDATE);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to remove message' });
            }
        });

        app.post('/api/queue/:id/duplicate', (req: Request, res: Response) => {
            const { id } = req.params;
            
            try {
                duplicateMessageInQueue(id);
                this.notifyCallback?.(MESSAGE_TYPES.QUEUE_UPDATE);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to duplicate message' });
            }
        });

        // Control APIs
        app.post('/api/control/start', async (req: Request, res: Response) => {
            try {
                if (!sessionReady) {
                    await startClaudeSession(true);
                }
                await startProcessingQueue(true);
                this.notifyCallback?.(MESSAGE_TYPES.STATUS_UPDATE);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to start Claude' });
            }
        });

        app.post('/api/control/stop', async (req: Request, res: Response) => {
            try {
                stopProcessingQueue();
                setProcessingQueue(false);
                setIsRunning(false);
                this.notifyCallback?.(MESSAGE_TYPES.STATUS_UPDATE);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to stop Claude' });
            }
        });

        app.post('/api/control/reset', async (req: Request, res: Response) => {
            try {
                stopProcessingQueue();
                clearMessageQueue();
                setProcessingQueue(false);
                setIsRunning(false);
                this.notifyCallback?.(MESSAGE_TYPES.STATUS_UPDATE);
                this.notifyCallback?.('queueUpdate');
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: 'Failed to reset' });
            }
        });

        app.post('/api/control/interrupt', (req: Request, res: Response) => {
            try {
                handleClaudeKeypress('escape');
                res.json({ success: true });
            } catch (error) {
                console.error('Error interrupting Claude:', error);
                res.status(500).json({ error: 'Failed to interrupt Claude' });
            }
        });

        // Output API
        app.get('/api/output', (req: Request, res: Response) => {
            res.json({
                output: claudeOutputBuffer,
                timestamp: Date.now()
            });
        });

        // File Explorer APIs
        app.get('/api/files/tree', (req: Request, res: Response) => {
            try {
                const requestPath = req.query.path as string || '';
                const maxDepth = Math.min(parseInt(req.query.maxDepth as string) || 3, 5);
                
                const workspaceRoot = this.fileUtils.getWorkspaceRoot();
                if (!workspaceRoot) {
                    return res.status(400).json({ error: 'No workspace available' });
                }
                
                const resolvedPath = this.fileUtils.validateAndResolvePath(workspaceRoot, requestPath);
                if (!resolvedPath) {
                    return res.status(403).json({ error: 'Invalid path or access denied' });
                }
                
                const items = this.fileUtils.buildFileTree(resolvedPath, maxDepth, 0);
                
                res.json({
                    items,
                    path: requestPath,
                    total: this.fileUtils.countItems(items)
                });
                
            } catch (error) {
                console.error('Error building file tree:', error);
                res.status(500).json({ error: 'Failed to load file tree' });
            }
        });

        app.get('/api/files/content', (req: Request, res: Response) => {
            try {
                const filePath = decodeURIComponent(req.query.path as string || '');
                if (!filePath) {
                    return res.status(400).json({ error: 'File path is required' });
                }
                
                const workspaceRoot = this.fileUtils.getWorkspaceRoot();
                if (!workspaceRoot) {
                    return res.status(400).json({ error: 'No workspace available' });
                }
                
                const resolvedPath = this.fileUtils.validateAndResolvePath(workspaceRoot, filePath);
                if (!resolvedPath) {
                    return res.status(403).json({ error: 'Invalid path or access denied' });
                }
                
                if (!fs.existsSync(resolvedPath)) {
                    return res.status(404).json({ error: 'File not found' });
                }
                
                const stats = fs.statSync(resolvedPath);
                if (!stats.isFile()) {
                    return res.status(400).json({ error: 'Path is not a file' });
                }
                
                const maxFileSize = 100 * 1024;
                if (stats.size > maxFileSize) {
                    return res.status(413).json({ 
                        error: 'File too large for preview',
                        maxSize: maxFileSize,
                        actualSize: stats.size
                    });
                }
                
                if (this.fileUtils.isBinaryFile(resolvedPath)) {
                    return res.status(415).json({ error: 'Binary files are not supported for preview' });
                }
                
                let content = fs.readFileSync(resolvedPath, 'utf8');
                const lines = content.split('\n');
                const maxLines = 1000;
                let truncated = false;
                
                if (lines.length > maxLines) {
                    content = lines.slice(0, maxLines).join('\n');
                    truncated = true;
                }
                
                const extension = path.extname(resolvedPath).toLowerCase();
                const language = this.fileUtils.getLanguageFromExtension(extension);
                
                res.json({
                    content,
                    language,
                    size: stats.size,
                    lines: lines.length,
                    truncated,
                    modified: stats.mtime.toISOString(),
                    extension
                });
                
            } catch (error) {
                console.error('Error reading file content:', error);
                res.status(500).json({ error: 'Failed to read file content' });
            }
        });

        // Workspace files search API
        app.get('/api/files/search', async (req: Request, res: Response) => {
            try {
                const query = req.query.query as string || '';
                const page = parseInt(req.query.page as string) || 1;
                const pageSize = parseInt(req.query.pageSize as string) || 50;
                
                const result = await this.fileSearchService.searchWorkspaceFiles(query, page, pageSize);
                res.json(result);
            } catch (error) {
                console.error('Error searching workspace files:', error);
                res.status(500).json({ error: 'Failed to search workspace files' });
            }
        });

        // Git APIs
        app.get('/api/git/status', async (req: Request, res: Response) => {
            try {
                const { getGitStatus } = await import('../../git');
                const status = await getGitStatus();
                res.json(status);
            } catch (error) {
                console.error('Error getting git status:', error);
                const message = getErrorMessage(error) || 'Failed to get git status';
                res.status(500).json({ error: message });
            }
        });

        app.get('/api/git/file-diff', async (req: Request, res: Response) => {
            try {
                const filePath = req.query.path as string;
                console.log('Getting diff for file:', filePath);
                
                if (!filePath) {
                    return res.status(400).json({ error: 'File path is required' });
                }

                const { getFileDiff } = await import('../../git');
                const diff = await getFileDiff(filePath, 'working');
                console.log('Diff result:', { 
                    filePath: diff.filePath, 
                    additions: diff.additions, 
                    deletions: diff.deletions, 
                    linesCount: diff.lines.length 
                });
                res.json(diff);
            } catch (error) {
                console.error('Error getting file diff:', error);
                const message = getErrorMessage(error) || 'Failed to get file diff';
                res.status(500).json({ error: message });
            }
        });

        // Authentication API
        app.post('/api/auth/login', (req: Request, res: Response) => {
            const token = req.headers.authorization?.replace('Bearer ', '');
            if (token !== this.authConfig.authToken) {
                return res.status(401).json({ error: 'Unauthorized: Invalid token' });
            }
            
            const { password } = req.body;
            const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
            
            if (!password) {
                return res.status(400).json({ error: 'Password is required' });
            }

            try {
                const result = this.authManager.validateLogin(password, clientIP);

                if (result.success && result.sessionToken) {
                    res.cookie('sessionToken', result.sessionToken, { 
                        httpOnly: true, 
                        secure: this.authConfig.useExternalServer,
                        maxAge: 24 * 60 * 60 * 1000
                    });
                    
                    res.json({ success: true, sessionToken: result.sessionToken });
                } else {
                    const status = result.error?.includes('Too many attempts') ? 403 : 401;
                    res.status(status).json({ 
                        error: result.error || 'Invalid password',
                        attemptsLeft: result.attemptsLeft 
                    });
                }
            } catch (error) {
                console.error('Error during login:', error);
                res.status(500).json({ error: 'Login failed' });
            }
        });
    }
}