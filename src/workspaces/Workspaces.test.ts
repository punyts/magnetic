import type { Services } from '@punyts/stateui-mcp';
import { describe, expect, it } from 'vitest';
import { Workspaces } from './Workspaces.js';

/** A factory whose services are stand-ins that record which users were opened and closed */
function factory() {
    const opened: string[] = [];
    const closed: string[] = [];
    return {
        opened,
        closed,
        open: async (userId: string) => {
            opened.push(userId);
            return { userId } as unknown as Services;
        },
        close: async (services: Services) => {
            closed.push((services as unknown as { userId: string }).userId);
        }
    };
}

describe('Workspaces', () => {
    it('should open one workspace per user and give the same one again', async () => {
        // Arrange
        const made = factory();
        const workspaces = new Workspaces(made);

        // Act
        const [a, again, b] = await Promise.all([workspaces.get('a'), workspaces.get('a'), workspaces.get('b')]);

        // Assert
        expect(again).toBe(a);
        expect(b).not.toBe(a);
        expect(made.opened).toEqual(['a', 'b']);
    });

    it('should close a workspace idle past the limit, but not one with an open view', async () => {
        // Arrange
        let now = 0;
        const made = factory();
        const workspaces = new Workspaces(made, { idleMs: 1000, now: () => now });
        await workspaces.get('idle');
        await workspaces.get('viewing');
        const release = workspaces.retain('viewing');

        // Act
        now = 5000;
        await workspaces.sweep();

        // Assert
        expect(made.closed).toEqual(['idle']);
        expect(workspaces.size).toBe(1);

        // Act: the view closes, and the workspace idles past the limit
        release();
        now = 7000;
        await workspaces.sweep();

        // Assert
        expect(made.closed).toEqual(['idle', 'viewing']);
    });

    it('should close the least recently used workspaces without views when more than the most are open', async () => {
        // Arrange
        let now = 0;
        const made = factory();
        const workspaces = new Workspaces(made, { max: 2, now: () => now });
        await workspaces.get('oldest');
        workspaces.retain('oldest');
        now = 1;
        await workspaces.get('older');
        now = 2;

        // Act
        await workspaces.get('new');
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Assert
        expect(made.closed).toEqual(['older']);
        expect(workspaces.size).toBe(2);
    });

    it('should try again to open a workspace that failed', async () => {
        // Arrange
        let fail = true;
        const workspaces = new Workspaces({
            open: async () => {
                if (fail) throw new Error('disk full');
                return {} as Services;
            },
            close: async () => undefined
        });

        // Act
        await expect(workspaces.get('a')).rejects.toThrow('disk full');
        fail = false;

        // Assert
        await expect(workspaces.get('a')).resolves.toBeDefined();
    });
});
