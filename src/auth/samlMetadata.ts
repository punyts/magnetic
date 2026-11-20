import { X509Certificate } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';

/** The most a provider's metadata may hold */
export const MAX_METADATA_BYTES = 1024 * 1024;
/** How long a metadata URL may take to answer */
const FETCH_MS = 10_000;

const MD = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

/** What Magnetic takes from an identity provider's metadata */
export interface IdpMetadata {
    /** The provider's entity id, which its assertions name as their issuer */
    readonly entityId: string;
    /** Where the browser is sent with the request (the HTTP-Redirect binding) */
    readonly ssoUrl: string;
    /** The provider's signing certificates, PEM */
    readonly certificates: readonly string[];
}

/** Why metadata was refused; its message can be shown to the org's owner */
export class MetadataError extends Error {}

/** Whether a URL is one Magnetic sends people or requests to: https, or http on this machine */
export function isProviderUrl(text: string): boolean {
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return false;
    }
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
}

const childrenOf = (parent: Element, namespace: string, name: string): Element[] => Array.from(parent.getElementsByTagNameNS(namespace, name)) as Element[];

/**
 * Reads an identity provider's metadata (SAML 2.0 metadata, an `EntityDescriptor`, or the first with an
 * `IDPSSODescriptor` of an `EntitiesDescriptor`): its entity id, its single sign-on URL for the HTTP-Redirect binding,
 * and its signing certificates. A document type declaration is refused, so no entity is ever expanded
 */
export function parseIdpMetadata(xml: string): IdpMetadata {
    if (Buffer.byteLength(xml, 'utf8') > MAX_METADATA_BYTES) throw new MetadataError('The metadata is larger than 1 MB.');
    if (/<!DOCTYPE/i.test(xml)) throw new MetadataError('The metadata has a document type declaration, which is not accepted.');
    let root: Element | null;
    try {
        const refuse = (message: string): never => {
            throw new MetadataError(message);
        };
        const document = new DOMParser({ errorHandler: { warning: () => undefined, error: refuse, fatalError: refuse } }).parseFromString(xml, 'text/xml');
        root = document.documentElement;
    } catch {
        throw new MetadataError('The metadata is not well-formed XML.');
    }
    if (root === null) throw new MetadataError('The metadata is empty.');
    const entities = root.localName === 'EntityDescriptor' && root.namespaceURI === MD ? [root] : childrenOf(root, MD, 'EntityDescriptor');
    const entity = entities.find((candidate) => childrenOf(candidate, MD, 'IDPSSODescriptor').length > 0);
    if (entity === undefined) throw new MetadataError('The metadata describes no identity provider (no IDPSSODescriptor).');
    const entityId = entity.getAttribute('entityID')?.trim() ?? '';
    if (entityId === '' || entityId.length > 1024) throw new MetadataError('The identity provider has no entity id.');
    const descriptor = childrenOf(entity, MD, 'IDPSSODescriptor')[0] as Element;
    const service = childrenOf(descriptor, MD, 'SingleSignOnService').find((candidate) => candidate.getAttribute('Binding') === REDIRECT_BINDING);
    const ssoUrl = service?.getAttribute('Location')?.trim() ?? '';
    if (ssoUrl === '') throw new MetadataError('The identity provider takes no sign-in by the HTTP-Redirect binding.');
    if (!isProviderUrl(ssoUrl) || ssoUrl.length > 2048) throw new MetadataError('The identity provider\'s sign-in address is not an https:// address.');
    const certificates: string[] = [];
    for (const key of childrenOf(descriptor, MD, 'KeyDescriptor')) {
        const use = key.getAttribute('use');
        if (use !== null && use !== '' && use !== 'signing') continue;
        for (const data of childrenOf(key, DS, 'X509Certificate')) {
            const body = (data.textContent ?? '').replace(/\s+/g, '');
            const pem = `-----BEGIN CERTIFICATE-----\n${body.replace(/.{1,64}/g, '$&\n')}-----END CERTIFICATE-----\n`;
            try {
                new X509Certificate(pem);
            } catch {
                throw new MetadataError('A signing certificate in the metadata cannot be read.');
            }
            if (!certificates.includes(pem)) certificates.push(pem);
        }
    }
    if (certificates.length === 0) throw new MetadataError('The metadata names no signing certificate.');
    return { entityId, ssoUrl, certificates };
}

/** Reads a provider's metadata from its URL: https (http on this machine), within ten seconds and 1 MB */
export async function fetchIdpMetadata(url: string): Promise<{ readonly xml: string; readonly metadata: IdpMetadata }> {
    if (!isProviderUrl(url)) throw new MetadataError('The metadata URL is an https:// address.');
    let answer: Response;
    try {
        answer = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_MS), headers: { Accept: 'application/samlmetadata+xml, application/xml, text/xml' } });
    } catch {
        throw new MetadataError('The metadata URL could not be reached.');
    }
    if (!answer.ok) throw new MetadataError(`The metadata URL answered ${answer.status}.`);
    if (!isProviderUrl(answer.url)) throw new MetadataError('The metadata URL redirected away from https.');
    const length = Number(answer.headers.get('content-length') ?? '0');
    if (length > MAX_METADATA_BYTES) throw new MetadataError('The metadata is larger than 1 MB.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = answer.body?.getReader();
    for (;;) {
        const read = reader === undefined ? { done: true as const, value: undefined } : await reader.read();
        if (read.done) break;
        size += read.value.length;
        if (size > MAX_METADATA_BYTES) {
            await reader?.cancel();
            throw new MetadataError('The metadata is larger than 1 MB.');
        }
        chunks.push(read.value);
    }
    const xml = Buffer.concat(chunks).toString('utf8');
    return { xml, metadata: parseIdpMetadata(xml) };
}
