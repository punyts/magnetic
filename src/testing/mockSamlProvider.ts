import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { issueSigningCertificate, makeCertificateAuthority } from '../server/localTls.js';

/** The person the mock provider signs in next */
export interface MockSamlPerson {
    readonly nameId: string;
    /** Default persistent */
    readonly nameIdFormat?: string;
    readonly attributes?: Readonly<Record<string, string>>;
}

/** Ways the mock provider's answer can be wrong, to check that Magnetic refuses it */
export type MockSamlTamper = 'unsigned' | 'expired' | 'audience' | 'otherKey' | 'issuer';

/** A request the provider was sent, as it read it */
export interface MockSamlRequest {
    readonly id: string;
    readonly acs: string;
    readonly issuer: string;
}

export interface MockSamlProvider {
    readonly entityId: string;
    readonly metadataUrl: string;
    /** The metadata as its URL serves it now */
    metadata(): string;
    /** Who the next answer signs in */
    person: MockSamlPerson;
    /** The request last sent to the provider's sign-in URL */
    readonly lastRequest: MockSamlRequest | undefined;
    /** The provider's answer to the last request, base64 as its page posts it to the request's ACS URL */
    answer(tamper?: MockSamlTamper): { readonly acs: string; readonly samlResponse: string };
    /** A new signing key and certificate, which the metadata serves from now on */
    rotate(): void;
    /** Makes the metadata URL answer 500, or serve again */
    failing: boolean;
    stop(): Promise<void>;
}

const C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';

interface Signer {
    readonly key: string;
    readonly cert: string;
}

function signer(): Signer {
    const authority = makeCertificateAuthority('mock-saml-authority');
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return { key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, cert: issueSigningCertificate(authority, 'mock-saml-idp', pair.publicKey.export({ type: 'spki', format: 'der' })) };
}

const body = (pem: string): string => pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A SAML 2.0 identity provider on loopback HTTP for tests: metadata at `/metadata`, a sign-in URL (`/sso`, the
 * HTTP-Redirect binding) that reads the request it is sent, and answers signed with an RSA key, which a test posts to
 * the request's ACS URL as the provider's page would. It signs the assertion, not the response
 */
export async function startMockSamlProvider(): Promise<MockSamlProvider> {
    let current = signer();
    let lastRequest: MockSamlRequest | undefined;
    let failing = false;
    let origin = '';
    const metadata = (): string => `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${origin}/idp">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" WantAuthnRequestsSigned="false">
    <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${body(current.cert)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:KeyDescriptor use="encryption"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${body(signer().cert)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${origin}/sso-post"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${origin}/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/metadata') {
            response.writeHead(failing ? 500 : 200, { 'Content-Type': 'application/samlmetadata+xml' });
            response.end(failing ? 'down' : metadata());
            return;
        }
        if (url.pathname === '/sso') {
            const xml = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64')).toString('utf8');
            const root = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
            const issuer = root?.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion', 'Issuer')[0]?.textContent ?? '';
            lastRequest = { id: root?.getAttribute('ID') ?? '', acs: root?.getAttribute('AssertionConsumerServiceURL') ?? '', issuer };
            response.writeHead(200, { 'Content-Type': 'text/plain' });
            response.end('The mock provider would sign you in here.');
            return;
        }
        response.writeHead(404);
        response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const provider: MockSamlProvider = {
        entityId: `${origin}/idp`,
        metadataUrl: `${origin}/metadata`,
        metadata,
        person: { nameId: 'person-1' },
        get lastRequest() {
            return lastRequest;
        },
        get failing() {
            return failing;
        },
        set failing(value: boolean) {
            failing = value;
        },
        answer(tamper) {
            const request = lastRequest;
            if (request === undefined) throw new Error('No request was sent to the mock provider');
            const now = Date.now();
            const at = (ms: number): string => new Date(now + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
            const shift = tamper === 'expired' ? -20 * 60_000 : 0;
            const audience = tamper === 'audience' ? 'https://another.example/sp' : request.issuer;
            const issuer = tamper === 'issuer' ? 'https://another.example/idp' : provider.entityId;
            const person = provider.person;
            const attributes = Object.entries(person.attributes ?? {})
                .map(([name, value]) => `<saml:Attribute Name="${escape(name)}"><saml:AttributeValue>${escape(value)}</saml:AttributeValue></saml:Attribute>`)
                .join('');
            const assertionId = `_a${randomBytes(16).toString('hex')}`;
            const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomBytes(16).toString('hex')}" Version="2.0" IssueInstant="${at(shift)}" Destination="${escape(request.acs)}" InResponseTo="${escape(request.id)}"><saml:Issuer>${escape(issuer)}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${at(shift)}"><saml:Issuer>${escape(issuer)}</saml:Issuer><saml:Subject><saml:NameID Format="${escape(person.nameIdFormat ?? 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent')}">${escape(person.nameId)}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${escape(request.id)}" NotOnOrAfter="${at(shift + 5 * 60_000)}" Recipient="${escape(request.acs)}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${at(shift - 60_000)}" NotOnOrAfter="${at(shift + 5 * 60_000)}"><saml:AudienceRestriction><saml:Audience>${escape(audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${at(shift)}" SessionIndex="_s${randomBytes(8).toString('hex')}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>${attributes === '' ? '' : `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>`}</saml:Assertion></samlp:Response>`;
            let signed = xml;
            if (tamper !== 'unsigned') {
                const signature = new SignedXml({ privateKey: tamper === 'otherKey' ? signer().key : current.key, canonicalizationAlgorithm: C14N, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' });
                signature.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', C14N] });
                signature.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } });
                signed = signature.getSignedXml();
            }
            return { acs: request.acs, samlResponse: Buffer.from(signed, 'utf8').toString('base64') };
        },
        rotate() {
            current = signer();
        },
        stop: () => new Promise<void>((resolve) => server.close(() => resolve()))
    };
    return provider;
}
