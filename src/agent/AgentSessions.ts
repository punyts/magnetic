import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** The cookie of the agent's headless browser; no other route reads it (docs/design/magnetic-agent-browser.md) */
export const AGENT_COOKIE = 'magnetic_agent';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Whether a request came from this machine: a loopback address, or the address it was sent to */
export function fromThisMachine(request: IncomingMessage): boolean {
    const remote = request.socket.remoteAddress;
    if (remote === undefined) return false;
    return LOOPBACK.has(remote) || remote === request.socket.localAddress;
}

/**
 * The sessions of the agent's headless browser: one per workspace, kept in this server's memory only, so a session
 * never outlives the server and is never in the `session` table. A session lets its browser load the views of its
 * workspace's apps and nothing else; the token is never logged or shown to the model
 */
export class AgentSessions {
    private readonly byToken = new Map<string, string>();
    private readonly byWorkspace = new Map<string, string>();

    /** A new session for a workspace; the one it had before ends */
    mint(workspaceId: string): string {
        this.end(workspaceId);
        const token = randomBytes(32).toString('base64url');
        this.byToken.set(token, workspaceId);
        this.byWorkspace.set(workspaceId, token);
        return token;
    }

    /** The workspace of a session token, or `undefined` */
    workspaceOf(token: string | undefined): string | undefined {
        return token === undefined ? undefined : this.byToken.get(token);
    }

    /** Ends the session of a workspace, if it has one */
    end(workspaceId: string): void {
        const token = this.byWorkspace.get(workspaceId);
        if (token === undefined) return;
        this.byWorkspace.delete(workspaceId);
        this.byToken.delete(token);
    }

    /** The number of live sessions */
    get size(): number {
        return this.byToken.size;
    }
}
