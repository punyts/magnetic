import { applyPatch, patchOperationsOf } from './patch.js';
import { GROUP_SCHEMA, PATCH_SCHEMA, ScimError, USER_SCHEMA } from './schemas.js';

const user = (): Record<string, unknown> => ({
    schemas: [USER_SCHEMA],
    id: 'u1',
    userName: 'judy@acme.test',
    name: { givenName: 'Judy', familyName: 'Doe' },
    emails: [{ value: 'judy@acme.test', type: 'work', primary: true }],
    active: true
});

const group = (): Record<string, unknown> => ({ schemas: [GROUP_SCHEMA], id: 'g1', displayName: 'Sales', members: [{ value: 'u1' }, { value: 'u2' }] });

const scimTypeOf = (run: () => unknown): string | undefined => {
    try {
        run();
    } catch (error) {
        return error instanceof ScimError ? (error.body as { scimType?: string }).scimType : 'not a ScimError';
    }
    return undefined;
};

describe('patchOperationsOf', () => {
    it('should take op names in any case', () => {
        // Act
        const operations = patchOperationsOf({ schemas: [PATCH_SCHEMA], Operations: [{ op: 'Replace', path: 'active', value: 'False' }, { op: 'ADD', value: { title: 'x' } }] });

        // Assert
        expect(operations.map((operation) => operation.op)).toEqual(['replace', 'add']);
    });

    it('should refuse a body that is not a PatchOp, an unknown op, and a remove with no path', () => {
        // Act
        const noSchema = scimTypeOf(() => patchOperationsOf({ Operations: [{ op: 'add', path: 'a', value: 1 }] }));
        const unknown = scimTypeOf(() => patchOperationsOf({ schemas: [PATCH_SCHEMA], Operations: [{ op: 'move', path: 'a' }] }));
        const noTarget = scimTypeOf(() => patchOperationsOf({ schemas: [PATCH_SCHEMA], Operations: [{ op: 'remove' }] }));
        const empty = scimTypeOf(() => patchOperationsOf({ schemas: [PATCH_SCHEMA], Operations: [] }));

        // Assert
        expect(noSchema).toBe('invalidSyntax');
        expect(unknown).toBe('invalidSyntax');
        expect(noTarget).toBe('noTarget');
        expect(empty).toBe('invalidSyntax');
    });
});

describe('applyPatch', () => {
    it('should apply an operation with no path attribute by attribute, ignoring id', () => {
        // Arrange
        const resource = user();

        // Act
        const changed = applyPatch(resource, [{ op: 'replace', value: { id: 'other', active: false, 'name.givenName': 'Judith' } }], USER_SCHEMA);

        // Assert
        expect(changed['id']).toBe('u1');
        expect(changed['active']).toBe(false);
        expect(changed['name']).toEqual({ givenName: 'Judith', familyName: 'Doe' });
        expect(resource['active']).toBe(true);
    });

    it("should change the work email by Entra ID's filtered path, and make one when none matches", () => {
        // Act
        const changed = applyPatch(user(), [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'judy.doe@acme.test' }], USER_SCHEMA);
        const made = applyPatch({ ...user(), emails: [] }, [{ op: 'add', path: 'emails[type eq "work"].value', value: 'judy@acme.test' }], USER_SCHEMA);

        // Assert
        expect(changed['emails']).toEqual([{ value: 'judy.doe@acme.test', type: 'work', primary: true }]);
        expect(made['emails']).toEqual([{ type: 'work', value: 'judy@acme.test' }]);
    });

    it('should ignore a path in another schema and take one in its own', () => {
        // Act
        const changed = applyPatch(
            user(),
            [
                { op: 'add', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'Field' },
                { op: 'replace', path: `${USER_SCHEMA}:userName`, value: 'judy2@acme.test' }
            ],
            USER_SCHEMA
        );

        // Assert
        expect(changed['userName']).toBe('judy2@acme.test');
        expect(Object.keys(changed)).not.toContain('department');
    });

    it("should add members without doubling them, and remove them by Okta's filtered path or Entra ID's value list", () => {
        // Act
        const added = applyPatch(group(), [{ op: 'add', path: 'members', value: [{ value: 'u2' }, { value: 'u3' }] }], GROUP_SCHEMA);
        const byPath = applyPatch(group(), [{ op: 'remove', path: 'members[value eq "u1"]' }], GROUP_SCHEMA);
        const byValue = applyPatch(group(), [{ op: 'remove', path: 'members', value: [{ value: 'u2' }] }], GROUP_SCHEMA);
        const all = applyPatch(group(), [{ op: 'remove', path: 'members' }], GROUP_SCHEMA);

        // Assert
        expect(added['members']).toEqual([{ value: 'u1' }, { value: 'u2' }, { value: 'u3' }]);
        expect(byPath['members']).toEqual([{ value: 'u2' }]);
        expect(byValue['members']).toEqual([{ value: 'u1' }]);
        expect(all['members']).toBeUndefined();
    });

    it('should refuse a change to id, meta or schemas, an add with no value, and a path it does not take', () => {
        // Act
        const id = scimTypeOf(() => applyPatch(user(), [{ op: 'replace', path: 'id', value: 'x' }], USER_SCHEMA));
        const noValue = scimTypeOf(() => applyPatch(user(), [{ op: 'add', path: 'title' }], USER_SCHEMA));
        const badPath = scimTypeOf(() => applyPatch(user(), [{ op: 'add', path: 'emails[type co "w"]', value: 1 }], USER_SCHEMA));

        // Assert
        expect(id).toBe('mutability');
        expect(noValue).toBe('invalidValue');
        expect(badPath).toBe('invalidPath');
    });
});
