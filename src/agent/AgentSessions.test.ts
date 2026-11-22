import { describe, expect, it } from 'vitest';
import { AgentSessions } from './AgentSessions.js';
import { BROWSER_TOOLS, withheldTools } from './AgentTurns.js';
import { magneticInstructions } from './instructions.js';

describe('AgentSessions', () => {
    it('should keep one session per workspace, ending the one before', () => {
        // Arrange
        const sessions = new AgentSessions();
        const first = sessions.mint('ws-a');

        // Act
        const second = sessions.mint('ws-a');
        const other = sessions.mint('ws-b');

        // Assert
        expect(sessions.workspaceOf(first)).toBeUndefined();
        expect(sessions.workspaceOf(second)).toBe('ws-a');
        expect(sessions.workspaceOf(other)).toBe('ws-b');
        expect(sessions.size).toBe(2);
    });

    it('should know no workspace for a token it did not make, or one that ended', () => {
        // Arrange
        const sessions = new AgentSessions();
        const token = sessions.mint('ws-a');

        // Act
        sessions.end('ws-a');

        // Assert
        expect(sessions.workspaceOf(token)).toBeUndefined();
        expect(sessions.workspaceOf('made-up')).toBeUndefined();
        expect(sessions.workspaceOf(undefined)).toBeUndefined();
    });
});

describe("The agent's browser tools", () => {
    it('should withhold them, and the answer tools, from an agent without a browser', () => {
        // Act
        const without = withheldTools(false);
        const withBrowser = withheldTools(true);

        // Assert
        for (const name of BROWSER_TOOLS) expect(without.has(name)).toBe(true);
        for (const name of BROWSER_TOOLS) expect(withBrowser.has(name)).toBe(false);
        expect(withBrowser.has('ui_call_answer')).toBe(true);
        expect(withBrowser.has('ui_effect_answer')).toBe(true);
    });

    it('should tell an agent with a browser to look at what it built, and one without that it cannot', () => {
        // Act
        const withBrowser = magneticInstructions(true);
        const without = magneticInstructions(false);

        // Assert
        expect(withBrowser).toContain('then ui_screenshot each screen you changed');
        expect(withBrowser).not.toContain('are not available here');
        expect(without).toContain('ui_preview, ui_screenshot and ui_interact are not available here');
    });
});
