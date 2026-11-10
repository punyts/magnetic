import { SESSION_COOKIE } from '../http/cookies.js';
import type { HomeData } from '../home/HomeApp.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';

/** What the "Your apps" of the person signed in with `cookie` lists, after they opened `/` */
export async function homeOf(magnetic: RunningMagnetic, cookie: string): Promise<HomeData & { status: number; page: string }> {
    const response = await fetch(`${magnetic.origin}/`, { redirect: 'manual', headers: { Cookie: cookie } });
    const page = await response.text();
    const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie)?.[1];
    const session = await magnetic.sessions.find(token);
    if (session === undefined) throw new Error('Not signed in');
    return { status: response.status, page, ...(await magnetic.homes.read(await magnetic.workspaces.get(session.userId), session.userId)) };
}
