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

/** Sends Magnetic's emails. Only invites so far */
export interface Mailer {
    /** Sends an invite; throws when the mail service refused it */
    invite(mail: InviteMail): Promise<void>;
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
        }
    };
}

/** A mailer that keeps what it was given, for tests */
export function memoryMailer(): Mailer & { readonly sent: InviteMail[] } {
    const sent: InviteMail[] = [];
    return {
        sent,
        async invite(mail) {
            sent.push(mail);
        }
    };
}
