import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockSamlProvider } from '../testing/mockSamlProvider.js';
import type { MockSamlProvider } from '../testing/mockSamlProvider.js';
import { fetchIdpMetadata, isProviderUrl, MAX_METADATA_BYTES, MetadataError, parseIdpMetadata } from './samlMetadata.js';

describe('parseIdpMetadata', () => {
    let idp: MockSamlProvider;

    beforeAll(async () => {
        idp = await startMockSamlProvider();
    });

    afterAll(async () => {
        await idp.stop();
    });

    it('should read the entity id, the HTTP-Redirect sign-in URL and only the signing certificates', () => {
        // Act
        const metadata = parseIdpMetadata(idp.metadata());

        // Assert
        expect(metadata.entityId).toBe(idp.entityId);
        expect(metadata.ssoUrl).toBe(idp.metadataUrl.replace('/metadata', '/sso'));
        expect(metadata.certificates).toHaveLength(1);
        expect(metadata.certificates[0]).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
    });

    it('should take the identity provider out of an EntitiesDescriptor', () => {
        // Arrange
        const inner = idp.metadata().replace('<?xml version="1.0"?>', '');
        const xml = `<md:EntitiesDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"><md:EntityDescriptor entityID="https://sp.example/"><md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"/></md:EntityDescriptor>${inner}</md:EntitiesDescriptor>`;

        // Act
        const metadata = parseIdpMetadata(xml);

        // Assert
        expect(metadata.entityId).toBe(idp.entityId);
    });

    it('should refuse a document type declaration, XML that is not well-formed, and metadata missing what sign-in needs', () => {
        // Arrange
        const good = idp.metadata();
        const cases = {
            doctype: `<?xml version="1.0"?><!DOCTYPE md [<!ENTITY x "y">]>${good.replace('<?xml version="1.0"?>', '')}`,
            broken: good.slice(0, good.length - 20),
            noIdp: '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="x"/>',
            noRedirect: good.replace(/<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"[^>]*\/>/, ''),
            noSigning: good.replace(/<md:KeyDescriptor use="signing">.*?<\/md:KeyDescriptor>/s, ''),
            badCertificate: good.replace(/(<md:KeyDescriptor use="signing">.*?<ds:X509Certificate>)[^<]+/s, '$1bm90IGEgY2VydGlmaWNhdGU='),
            plainHttp: good.replaceAll('http://127.0.0.1', 'http://idp.example.com'),
            tooLarge: `${good}<!--${'x'.repeat(MAX_METADATA_BYTES)}-->`
        };

        // Act
        const errors = Object.fromEntries(
            Object.entries(cases).map(([name, xml]) => {
                try {
                    parseIdpMetadata(xml);
                    return [name, undefined];
                } catch (error) {
                    return [name, error];
                }
            })
        );

        // Assert
        for (const [name, error] of Object.entries(errors)) expect(error, name).toBeInstanceOf(MetadataError);
        expect((errors['doctype'] as Error).message).toMatch(/document type declaration/);
        expect((errors['noRedirect'] as Error).message).toMatch(/HTTP-Redirect/);
        expect((errors['noSigning'] as Error).message).toMatch(/no signing certificate/);
    });

    it('should accept https addresses, and http only on this machine', () => {
        // Assert
        expect(isProviderUrl('https://idp.example.com/metadata')).toBe(true);
        expect(isProviderUrl('http://127.0.0.1:8080/metadata')).toBe(true);
        expect(isProviderUrl('http://idp.example.com/metadata')).toBe(false);
        expect(isProviderUrl('file:///etc/passwd')).toBe(false);
        expect(isProviderUrl('not a url')).toBe(false);
    });

    it('should fetch metadata from its URL, and say why a failed read failed', async () => {
        // Act
        const read = await fetchIdpMetadata(idp.metadataUrl);
        idp.failing = true;
        const failed = await fetchIdpMetadata(idp.metadataUrl).catch((error: unknown) => error);
        idp.failing = false;

        // Assert
        expect(read.metadata.entityId).toBe(idp.entityId);
        expect(failed).toBeInstanceOf(MetadataError);
        expect((failed as Error).message).toBe('The metadata URL answered 500.');
    });
});
