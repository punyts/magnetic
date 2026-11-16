import { describe, expect, it } from 'vitest';
import { busyPage, isInstanceBusy } from './busyPage.js';

describe('The page for an instance still on another server', () => {
    it('should know the errors of an instance on another server, and no others', () => {
        expect(isInstanceBusy(new Error("The app's instance is busy on another server; try again"))).toBe(true);
        expect(isInstanceBusy(new Error("The app's instance runs on another server"))).toBe(true);
        expect(isInstanceBusy(new Error('No app at alice/x/user'))).toBe(false);
        expect(isInstanceBusy('busy')).toBe(false);
    });

    it('should say to wait in the language asked for, and load again by itself', () => {
        const page = busyPage('de');
        expect(page).toContain('<meta http-equiv="refresh" content="3">');
        expect(page).toContain('Magnetic startet gerade.');
        expect(busyPage('en')).toContain('Magnetic is starting up.');
    });
});
