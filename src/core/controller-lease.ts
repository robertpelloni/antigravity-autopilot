import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

export interface ControllerLeasePayload {
    ownerId: string;
    pid: number;
    workspace: string;
    updatedAt: number;
    createdAt: number;
}

export interface ControllerLeaseDebugState {
    leasePath: string;
    ownerId: string;
    workspaceKey: string;
    currentPid: number;
    staleMs: number;
    heartbeatMs: number;
    now: number;
    lease: ControllerLeasePayload | null;
    leaseAgeMs: number | null;
    leaseIsStale: boolean;
    isLeader: boolean;
}

export class ControllerLease {
    private readonly leasePath: string;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private readonly staleMs: number;
    private readonly heartbeatMs: number;

    constructor(
        private readonly ownerId: string,
        private readonly workspace: string,
        options?: { staleMs?: number; heartbeatMs?: number; leasePath?: string }
    ) {
        this.staleMs = Math.max(5000, options?.staleMs ?? 15000);
        this.heartbeatMs = Math.max(1000, options?.heartbeatMs ?? 4000);
        this.leasePath = options?.leasePath || this.getDefaultWorkspaceLeasePath();
    }

    private getDefaultWorkspaceLeasePath(): string {
        const home = os.homedir() || os.tmpdir();
        const appKey = this.normalizeAppKey();
        const workspaceKey = this.normalizeWorkspaceKey(this.workspace);
        const appHash = createHash('sha1').update(appKey).digest('hex').slice(0, 12);
        const workspaceHash = createHash('sha1').update(workspaceKey).digest('hex').slice(0, 12);
        return path.join(home, `.antigravity-controller-lease.${appHash}.${workspaceHash}.json`);
    }

    private normalizeAppKey(): string {
        const execPath = String(process.execPath || '').trim().replace(/\\/g, '/').toLowerCase();
        const appData = String(process.env.APPDATA || '').trim().replace(/\\/g, '/').toLowerCase();
        const userDataDirArg = process.argv.find(arg => String(arg).startsWith('--user-data-dir=')) || '';
        const userDataDir = userDataDirArg.replace(/^--user-data-dir=/, '').replace(/^"|"$/g, '').replace(/\\/g, '/').toLowerCase();
        return `${execPath}|${appData}|${userDataDir}`;
    }

    private isOwnerProcessAlive(pid: number): boolean {
        const normalizedPid = Number(pid || 0);
        if (normalizedPid <= 0) {
            return false;
        }

        try {
            process.kill(normalizedPid, 0);
            return true;
        } catch (e: any) {
            const code = String(e?.code || '').toUpperCase();
            if (code === 'EPERM' || code === 'EACCES') {
                return true;
            }
            return false;
        }
    }

    private normalizeWorkspaceKey(workspace: string): string {
        const raw = String(workspace || '').trim();
        if (!raw) {
            return 'no-workspace';
        }

        const normalizedSeparators = raw.replace(/\\/g, '/').replace(/\/+$/, '');
        const normalizedCase = process.platform === 'win32'
            ? normalizedSeparators.toLowerCase()
            : normalizedSeparators;

        return normalizedCase;
    }

    getDebugState(): ControllerLeaseDebugState {
        const now = Date.now();
        const lease = this.readLease();
        const leaseAgeMs = lease ? Math.max(0, now - lease.updatedAt) : null;
        const leaseIsStale = lease ? this.isStale(lease) : false;

        return {
            leasePath: this.leasePath,
            ownerId: this.ownerId,
            workspaceKey: this.normalizeWorkspaceKey(this.workspace),
            currentPid: process.pid,
            staleMs: this.staleMs,
            heartbeatMs: this.heartbeatMs,
            now,
            lease,
            leaseAgeMs,
            leaseIsStale,
            isLeader: !!lease && !leaseIsStale && lease.ownerId === this.ownerId
        };
    }

    start(): void {
        this.tryAcquire();
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        this.heartbeatTimer = setInterval(() => {
            this.tryAcquire();
        }, this.heartbeatMs);
    }

    stop(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        const existing = this.readLease();
        if (existing?.ownerId === this.ownerId) {
            try {
                fs.unlinkSync(this.leasePath);
            } catch {
                // Best-effort cleanup.
            }
        }
    }

    isLeader(): boolean {
        const lease = this.readLease();
        if (!lease) return false;
        if (this.isStale(lease)) return false;
        if (!this.isOwnerProcessAlive(lease.pid)) return false;
        return lease.ownerId === this.ownerId;
    }

    getLeaderInfo(): ControllerLeasePayload | null {
        const lease = this.readLease();
        if (!lease) return null;
        if (this.isStale(lease)) return null;
        if (!this.isOwnerProcessAlive(lease.pid)) return null;
        return lease;
    }

    tryAcquire(force: boolean = false): boolean {
        const existing = this.readLease();
        if (!force && existing && !this.isStale(existing) && existing.ownerId !== this.ownerId) {
            const isAlive = this.isOwnerProcessAlive(existing.pid);
            if (isAlive) {
                return false;
            }
        }

        const now = Date.now();
        const next: ControllerLeasePayload = {
            ownerId: this.ownerId,
            pid: process.pid,
            workspace: this.workspace,
            createdAt: (!force && existing?.ownerId === this.ownerId) ? existing.createdAt : now,
            updatedAt: now
        };

        let wrote = false;

        if (force || (existing && existing.ownerId === this.ownerId)) {
            wrote = this.writeLease(next);
        } else {
            wrote = this.tryClaimLeaseAtomically(next);
            if (!wrote && existing && existing.ownerId !== this.ownerId) {
                // Dead/stale lease owner: best-effort reclaim with an unlink + atomic claim.
                try {
                    fs.unlinkSync(this.leasePath);
                } catch {
                    // Another process may have already replaced/removed it.
                }
                wrote = this.tryClaimLeaseAtomically(next);
            }
        }

        if (!wrote) {
            return false;
        }

        const readBack = this.readLease();
        return !!readBack && readBack.ownerId === this.ownerId && !this.isStale(readBack);
    }

    forceAcquire(): void {
        this.tryAcquire(true);
    }

    private readLease(): ControllerLeasePayload | null {
        try {
            if (!fs.existsSync(this.leasePath)) return null;
            const raw = fs.readFileSync(this.leasePath, 'utf-8');
            if (!raw.trim()) return null;
            const parsed = JSON.parse(raw) as Partial<ControllerLeasePayload>;
            if (!parsed || typeof parsed.ownerId !== 'string') return null;
            if (typeof parsed.updatedAt !== 'number') return null;

            return {
                ownerId: parsed.ownerId,
                pid: Number(parsed.pid || 0),
                workspace: String(parsed.workspace || ''),
                createdAt: Number(parsed.createdAt || parsed.updatedAt),
                updatedAt: parsed.updatedAt
            };
        } catch {
            return null;
        }
    }

    private writeLease(payload: ControllerLeasePayload): boolean {
        try {
            const tempPath = `${this.leasePath}.tmp.${process.pid}`;
            fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
            try {
                fs.renameSync(tempPath, this.leasePath);
            } catch (err: any) {
                // On Windows, renameSync often throws EPERM if the file is locked by AV/indexing.
                // Fall back to direct write.
                fs.writeFileSync(this.leasePath, JSON.stringify(payload, null, 2), 'utf-8');
                try { fs.unlinkSync(tempPath); } catch { }
            }
            return true;
        } catch (e: any) {
            console.error('[ControllerLease] Failed to write lease file:', e);
            // Best-effort write; non-critical.
            return false;
        }
    }

    private tryClaimLeaseAtomically(payload: ControllerLeasePayload): boolean {
        try {
            fs.writeFileSync(this.leasePath, JSON.stringify(payload, null, 2), {
                encoding: 'utf-8',
                flag: 'wx'
            });
            return true;
        } catch (e: any) {
            const code = String(e?.code || '').toUpperCase();
            if (code === 'EEXIST') {
                return false;
            }
            // EPERM/EBUSY can happen on Windows under AV/indexing contention.
            // Treat as non-claim rather than escalating to leader.
            if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
                return false;
            }
            console.error('[ControllerLease] Atomic claim failed:', e);
            return false;
        }
    }

    private isStale(lease: ControllerLeasePayload): boolean {
        return (Date.now() - lease.updatedAt) > this.staleMs;
    }
}
