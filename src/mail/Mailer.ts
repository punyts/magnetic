import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/** An invite to an org, as an email says it */
export interface InviteMail {
    readonly to: string;
    readonly orgName: string;
    readonly inviterName: string;
    /** The role, in words: "a builder" */
    readonly role: string;
    readonly link: string;
    readonly expiresAt: string;
}

/** A bug, comment or feature request someone sent from the editor, as the operator gets it */
export interface FeedbackMail {
    /** The operator's contact address */
    readonly to: string;
    readonly kind: 'bug' | 'comment' | 'feature';
    readonly text: string;
    readonly fromName: string;
    /** The sender's address, for a reply; when they have one */
    readonly fromEmail?: string;
    readonly appName?: string;
    /** Where it was sent from: the frame size, the screen, the browser */
    readonly context: Readonly<Record<string, string>>;
}

/** Sends Magnetic's emails: invites, and feedback to the operator */
export interface Mailer {
    /** Sends an invite; throws when the mail service refused it */
    invite(mail: InviteMail): Promise<void>;
    /** Sends feedback to the operator; throws when the mail service refused it */
    feedback?(mail: FeedbackMail): Promise<void>;
}

const KIND_WORDS = { bug: 'Bug', comment: 'Comment', feature: 'Feature request' } as const;

/** The words of a feedback email, as plain text */
export function feedbackMessage(mail: FeedbackMail): { readonly subject: string; readonly text: string } {
    const first = mail.text.split(/\r?\n/)[0]?.trim() ?? '';
    const subject = `Magnetic ${KIND_WORDS[mail.kind].toLowerCase()}: ${first.length > 60 ? `${first.slice(0, 59)}…` : first}`;
    const text = [
        `${KIND_WORDS[mail.kind]} from ${mail.fromName}${mail.fromEmail === undefined ? '' : ` <${mail.fromEmail}>`}${mail.appName === undefined ? '' : `, in the app ${mail.appName}`}:`,
        '',
        mail.text,
        '',
        ...Object.entries(mail.context).map(([key, value]) => `${key}: ${value}`)
    ].join('\n');
    return { subject, text };
}

/** The words of an invite email, as plain text and as simple HTML */
export function inviteMessage(mail: InviteMail): { readonly subject: string; readonly text: string; readonly html: string } {
    const until = new Date(mail.expiresAt).toUTCString().replace(/ \d\d:\d\d:\d\d GMT$/, '');
    const subject = `${mail.inviterName} invited you to ${mail.orgName} on Magnetic`;
    const text = [
        `${mail.inviterName} invited you to join ${mail.orgName} on Magnetic as ${mail.role}.`,
        '',
        `Join: ${mail.link}`,
        '',
        `The link works once, until ${until}, when you are signed in with this email address (${mail.to}). If you already use Magnetic, the invite also waits on Your apps.`,
        '',
        'If you did not expect this, you can ignore it.'
    ].join('\n');
    const e = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const html = [
        `<p>${e(mail.inviterName)} invited you to join <strong>${e(mail.orgName)}</strong> on Magnetic as ${e(mail.role)}.</p>`,
        `<p><a href="${e(mail.link)}">Join ${e(mail.orgName)}</a></p>`,
        `<p>The link works once, until ${e(until)}, when you are signed in with this email address (${e(mail.to)}). If you already use Magnetic, the invite also waits on Your apps.</p>`,
        '<p>If you did not expect this, you can ignore it.</p>'
    ].join('\n');
    return { subject, text, html };
}

/**
 * Sends through Amazon SES (v2), from a verified identity, with the credentials of the machine (the instance role on
 * the Magnetic host). The account must be out of the SES sandbox to send to anyone; in it, only to verified addresses
 */
export function sesMailer(options: { readonly from: string; readonly region: string }): Mailer {
    const client = new SESv2Client({ region: options.region });
    return {
        async invite(mail) {
            const message = inviteMessage(mail);
            await client.send(
                new SendEmailCommand({
                    FromEmailAddress: options.from,
                    Destination: { ToAddresses: [mail.to] },
                    Content: {
                        Simple: {
                            Subject: { Data: message.subject, Charset: 'UTF-8' },
                            Body: { Text: { Data: message.text, Charset: 'UTF-8' }, Html: { Data: message.html, Charset: 'UTF-8' } }
                        }
                    }
                })
            );
        },
        async feedback(mail) {
            const message = feedbackMessage(mail);
            await client.send(
                new SendEmailCommand({
                    FromEmailAddress: options.from,
                    Destination: { ToAddresses: [mail.to] },
                    ...(mail.fromEmail !== undefined && { ReplyToAddresses: [mail.fromEmail] }),
                    Content: { Simple: { Subject: { Data: message.subject, Charset: 'UTF-8' }, Body: { Text: { Data: message.text, Charset: 'UTF-8' } } } }
                })
            );
        }
    };
}

/** A mailer that keeps what it was given, for tests */
export function memoryMailer(): Mailer & { readonly sent: InviteMail[]; readonly feedbackSent: FeedbackMail[] } {
    const sent: InviteMail[] = [];
    const feedbackSent: FeedbackMail[] = [];
    return {
        sent,
        feedbackSent,
        async invite(mail) {
            sent.push(mail);
        },
        async feedback(mail) {
            feedbackSent.push(mail);
        }
    };
}
