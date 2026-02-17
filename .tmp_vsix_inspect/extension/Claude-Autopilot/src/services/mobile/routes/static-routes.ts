import { Application, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { AuthManager, AuthConfig } from '../auth/';

export class StaticRoutes {
    private authManager: AuthManager;
    private config: AuthConfig;

    constructor(authManager: AuthManager, config: AuthConfig) {
        this.authManager = authManager;
        this.config = config;
    }

    public updateConfig(config: AuthConfig): void {
        this.config = config;
        this.authManager.updateConfig(config);
    }

    public setupRoutes(app: Application): void {
        app.get('/', (req: Request, res: Response) => {
            const token = req.query.token;
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication token' });
            }
            
            if (this.config.useExternalServer && this.config.webPassword) {
                const sessionToken = (req as any).cookies?.sessionToken;
                if (!sessionToken || !this.authManager.hasActiveSession(sessionToken)) {
                    return res.redirect(`/password?token=${this.config.authToken}`);
                }
            }
            
            const htmlPath = path.join(__dirname, '../../../webview/web/index.html');
            let html = fs.readFileSync(htmlPath, 'utf8');
            
            html = html.replace('href="styles.css"', `href="styles.css?token=${this.config.authToken}"`);
            html = html.replace('src="js/app.js"', `src="js/app.js?token=${this.config.authToken}"`);
            html = html.replace('href="manifest.json"', `href="manifest.json?token=${this.config.authToken}"`);
            
            html = html.replace('</head>', `
                <script>
                    window.CLAUDE_AUTH_TOKEN = '${this.config.authToken}';
                </script>
                </head>
            `);
            
            res.send(html);
        });

        app.get('/password', (req: Request, res: Response) => {
            const token = req.query.token;
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication token' });
            }
            
            const htmlPath = path.join(__dirname, '../../../webview/web/password.html');
            const html = fs.readFileSync(htmlPath, 'utf8');
            res.send(html);
        });

        app.get('/manifest.json', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            if (!this.authManager.checkPasswordForStaticFiles(req, res)) {
                return;
            }
            
            res.sendFile(path.join(__dirname, '../../../webview/web/manifest.json'));
        });


        app.get('/styles.css', (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            if (!this.authManager.checkPasswordForStaticFiles(req, res)) {
                return;
            }
            
            const filePath = path.join(__dirname, '../../../webview/web/styles.css');
            
            if (!fs.existsSync(filePath)) {
                console.error('styles.css not found at expected path:', filePath);
                return res.status(404).send('styles.css not found');
            }
            
            res.setHeader('Content-Type', 'text/css');
            
            try {
                const cssContent = fs.readFileSync(filePath, 'utf8');
                res.send(cssContent);
            } catch (error) {
                console.error('Error reading styles.css:', error);
                res.status(500).send('Error loading stylesheet');
            }
        });


        // Serve modular JavaScript files from /js/ directory
        app.get(/\/js\/.*/, (req: Request, res: Response) => {
            const token = req.query.token || req.headers['x-auth-token'];
            const referer = (req.headers.referer || req.headers.referrer) as string;
            
            // Allow ES6 module imports if:
            // 1. They have a direct token, OR
            // 2. They come from an authenticated page (Referer with token), OR  
            // 3. They come from the same origin (for module import chains)
            const hasDirectToken = token === this.config.authToken;
            const fromAuthenticatedPage = referer && referer.includes(`token=${this.config.authToken}`);
            const fromSameOrigin = referer && (
                referer.startsWith(`http://${req.headers.host}`) || 
                referer.startsWith(`https://${req.headers.host}`) ||
                (req.headers.host && referer.includes(req.headers.host as string))
            );
            
            if (!hasDirectToken && !fromAuthenticatedPage && !fromSameOrigin) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            if (!this.authManager.checkPasswordForStaticFiles(req, res)) {
                return;
            }
            
            // Extract the file path from the URL
            const requestedPath = req.path; // e.g., "/js/app.js" or "/js/core/MobileInterface.js"
            const filePath = path.join(__dirname, '../../../webview/web', requestedPath);
            
            // Security check: ensure the path stays within the webview/web directory
            const normalizedPath = path.normalize(filePath);
            const basePath = path.join(__dirname, '../../../webview/web');
            if (!normalizedPath.startsWith(basePath)) {
                return res.status(403).send('Forbidden: Path traversal detected');
            }
            
            if (!fs.existsSync(filePath)) {
                console.error(`JS file not found at path: ${filePath}`);
                return res.status(404).send(`JS file not found: ${requestedPath}`);
            }
            
            res.setHeader('Content-Type', 'application/javascript');
            
            try {
                const jsContent = fs.readFileSync(filePath, 'utf8');
                res.send(jsContent);
            } catch (error) {
                console.error(`Error reading JS file ${filePath}:`, error);
                res.status(500).send('Error loading JavaScript file');
            }
        });
    }
}