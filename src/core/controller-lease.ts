import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ControllerLeasePayload {
    ownerId: string;
    pid: number;
    workspace: string;
    updatedAt: number;
    createdAt: number;
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
        this.leasePath = options?.leasePath || path.join(os.homedir() || os.tmpdir(), '.antigravity-controller-lease.json');
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
        return lease.ownerId === this.ownerId;
    }

    getLeaderInfo(): ControllerLeasePayload | null {
        const lease = this.readLease();
        if (!lease) return null;
        if (this.isStale(lease)) return null;
        return lease;
    }

    tryAcquire(force: boolean = false): boolean {
        const existing = this.readLease();
        if (!force && existing && !this.isStale(existing) && existing.ownerId !== this.ownerId) {
            let isAlive = true;
            try {
                process.kill(existing.pid, 0);
            } catch (e) {
                isAlive = false;
            }
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

        this.writeLease(next);
        return true;
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

    private writeLease(payload: ControllerLeasePayload): void {
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
        } catch (e: any) {
            console.error('[ControllerLease] Failed to write lease file:', e);
            // Best-effort write; non-critical.
        }
    }

    private isStale(lease: ControllerLeasePayload): boolean {
        return (Date.now() - lease.updatedAt) > this.staleMs;
    }
}
