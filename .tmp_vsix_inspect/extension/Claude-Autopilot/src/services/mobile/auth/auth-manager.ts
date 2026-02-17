import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { debugLog } from '../../../utils/logging';

export interface AuthConfig {
    authToken: string;
    useExternalServer: boolean;
    webPassword: string;
    passwordAttempts?: Map<string, number>;
    blockedIPs?: Set<string>;
    activeSessions?: Set<string>;
}

export class AuthManager {
    private passwordAttempts = new Map<string, number>();
    private blockedIPs = new Set<string>();
    private activeSessions = new Set<string>();
    private config: AuthConfig;
    private onShutdown?: () => void;

    constructor(config: AuthConfig, onShutdown?: () => void) {
        this.config = config;
        this.onShutdown = onShutdown;
    }

    public updateConfig(config: AuthConfig): void {
        this.config = config;
    }

    public getApiAuthMiddleware() {
        return (req: Request, res: Response, next: NextFunction) => {
            const token = req.headers.authorization?.replace('Bearer ', '');
            if (token !== this.config.authToken) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            next();
        };
    }

    public getPasswordAuthMiddleware() {
        return (req: Request, res: Response, next: NextFunction) => {
            const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
            
            if (this.blockedIPs.has(clientIP)) {
                res.status(403).json({ error: 'IP blocked due to too many failed attempts' });
                return;
            }

            if (req.path === '/auth/login') {
                return next();
            }

            const sessionToken = (req as any).cookies?.sessionToken;
            
            if (!sessionToken || !this.activeSessions.has(sessionToken)) {
                const attempts = this.passwordAttempts.get(clientIP) || 0;
                this.passwordAttempts.set(clientIP, attempts + 1);
                
                if (attempts + 1 >= 5) {
                    this.blockedIPs.add(clientIP);
                    debugLog(`🚫 IP ${clientIP} blocked after 5 failed password attempts`);
                    
                    setTimeout(() => {
                        debugLog('🛑 Shutting down server due to security breach');
                        this.onShutdown?.();
                    }, 1000);
                    
                    res.status(403).json({ error: 'Too many failed attempts. Server shutting down.' });
                    return;
                }
                
                res.status(401).json({ 
                    error: 'Session expired. Please login again.', 
                    attemptsLeft: 5 - (attempts + 1) 
                });
                return;
            }

            this.passwordAttempts.delete(clientIP);
            next();
        };
    }

    public checkPasswordForStaticFiles(req: Request, res: Response): boolean {
        if (this.config.useExternalServer && this.config.webPassword) {
            const sessionToken = (req as any).cookies?.sessionToken;
            const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
            
            if (!sessionToken || !this.activeSessions.has(sessionToken)) {
                if (this.blockedIPs.has(clientIP)) {
                    res.status(403).json({ error: 'IP blocked due to too many failed attempts' });
                    return false;
                }

                const attempts = this.passwordAttempts.get(clientIP) || 0;
                this.passwordAttempts.set(clientIP, attempts + 1);
                
                if (attempts + 1 >= 5) {
                    this.blockedIPs.add(clientIP);
                    debugLog(`🚫 IP ${clientIP} blocked after 5 failed password attempts`);
                    
                    setTimeout(() => {
                        debugLog('🛑 Shutting down server due to security breach');
                        this.onShutdown?.();
                    }, 1000);
                    
                    res.status(403).json({ error: 'Too many failed attempts. Server shutting down.' });
                    return false;
                }
                
                res.status(401).json({ 
                    error: 'Session expired. Please login again.', 
                    attemptsLeft: 5 - (attempts + 1) 
                });
                return false;
            }

            this.passwordAttempts.delete(clientIP);
        }
        
        return true;
    }

    public validateLogin(password: string, clientIP: string): { success: boolean; sessionToken?: string; error?: string; attemptsLeft?: number } {
        if (this.blockedIPs.has(clientIP)) {
            return { success: false, error: 'IP blocked' };
        }
        
        if (!this.config.webPassword || password === this.config.webPassword) {
            this.passwordAttempts.delete(clientIP);
            
            const sessionToken = randomBytes(32).toString('hex');
            this.activeSessions.add(sessionToken);
            
            return { success: true, sessionToken };
        } else {
            const attempts = this.passwordAttempts.get(clientIP) || 0;
            this.passwordAttempts.set(clientIP, attempts + 1);
            
            if (attempts + 1 >= 5) {
                this.blockedIPs.add(clientIP);
                setTimeout(() => this.onShutdown?.(), 1000);
                return { success: false, error: 'Too many attempts. Server shutting down.' };
            }
            
            return { 
                success: false, 
                error: 'Invalid password', 
                attemptsLeft: 5 - (attempts + 1) 
            };
        }
    }

    public getBlockedIPsCount(): number {
        return this.blockedIPs.size;
    }

    public hasActiveSession(sessionToken: string): boolean {
        return this.activeSessions.has(sessionToken);
    }

    public clearSessions(): void {
        this.activeSessions.clear();
        this.passwordAttempts.clear();
        this.blockedIPs.clear();
    }
}