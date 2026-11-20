import { parseFilter } from './filter.js';
import { ScimError } from './schemas.js';

describe('parseFilter', () => {
    it('should read eq comparisons joined by and, with attribute names in lower case', () => {
        // Act
        const terms = parseFilter('userName eq "Judy@Acme.test" and active EQ true');

        // Assert
        expect(terms).toEqual([
            { attribute: 'username', value: 'Judy@Acme.test' },
            { attribute: 'active', value: true }
        ]);
    });

    it('should strip the core schema from an attribute and read escaped quotes', () => {
        // Act
        const terms = parseFilter('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "a\\"b"');

        // Assert
        expect(terms).toEqual([{ attribute: 'username', value: 'a"b' }]);
    });

    it('should read a bracketed test with a sub-attribute, and a bracketed member test alone', () => {
        // Act
        const email = parseFilter('emails[type eq "work"].value eq "judy@acme.test"');
        const member = parseFilter('members[value eq "u1"]');
        const dotted = parseFilter('emails.value eq "judy@acme.test"');

        // Assert
        expect(email).toEqual([{ attribute: 'emails.value', value: 'judy@acme.test', within: { attribute: 'type', value: 'work' } }]);
        expect(member).toEqual([{ attribute: 'members.value', value: 'u1' }]);
        expect(dotted).toEqual([{ attribute: 'emails.value', value: 'judy@acme.test' }]);
    });

    it.each(['userName co "a"', 'userName sw "a"', 'title pr', 'userName eq "a" or userName eq "b"', 'not (userName eq "a")', 'userName eq "a', 'userName eq a', '', 'userName eq "a" and'])('should refuse %j as invalidFilter', (filter) => {
        // Act
        const parse = (): unknown => parseFilter(filter);

        // Assert
        expect(parse).toThrow(ScimError);
        try {
            parse();
        } catch (error) {
            expect((error as ScimError).status).toBe(400);
            expect((error as ScimError).body).toMatchObject({ scimType: 'invalidFilter' });
        }
    });

    it('should refuse a filter longer than it takes', () => {
        // Act
        const parse = (): unknown => parseFilter(`userName eq "${'a'.repeat(1000)}"`);

        // Assert
        expect(parse).toThrow(ScimError);
    });
});
