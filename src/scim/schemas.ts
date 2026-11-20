/*
 * The SCIM 2.0 resources Magnetic takes (RFC 7643): a User and a Group, what is kept of them, and the three discovery
 * documents. docs/design/magnetic-scim.md
 */

export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const CONFIG_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
const RESOURCE_TYPE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType';
const SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema';

/** The most resources one list answers */
export const MAX_RESULTS = 100;

/** A SCIM refusal: its status, its `scimType` when it has one, and a detail that names attributes, never values */
export class ScimError extends Error {
    constructor(
        readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 501,
        message: string,
        readonly scimType?: 'invalidFilter' | 'invalidValue' | 'invalidSyntax' | 'invalidPath' | 'noTarget' | 'uniqueness' | 'mutability' | 'tooMany'
    ) {
        super(message);
    }

    get body(): Record<string, unknown> {
        return { schemas: [ERROR_SCHEMA], status: String(this.status), ...(this.scimType !== undefined && { scimType: this.scimType }), detail: this.message };
    }
}

/** What Magnetic keeps of a pushed User */
export interface ScimUserInput {
    readonly userName: string;
    readonly email: string;
    readonly externalId?: string;
    readonly displayName?: string;
    readonly givenName?: string;
    readonly familyName?: string;
    readonly active: boolean;
}

/** What Magnetic keeps of a pushed Group: its name, and its members' SCIM ids */
export interface ScimGroupInput {
    readonly displayName: string;
    readonly externalId?: string;
    readonly members: readonly string[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** An attribute of a resource by name, in any case, as SCIM names are */
export function attributeOf(resource: Json, name: string): unknown {
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(resource)) if (key.toLowerCase() === lower) return value;
    return undefined;
}

function textOf(resource: Json, name: string, max: number, required = false): string | undefined {
    const value = attributeOf(resource, name);
    if (value === undefined || value === null || value === '') {
        if (required) throw new ScimError(400, `${name} is required.`, 'invalidValue');
        return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new ScimError(400, `${name} is not text of at most ${max} characters.`, 'invalidValue');
    return value.trim();
}

/** `active` as a boolean; Entra ID sends `"True"` and `"False"` */
export function booleanOf(value: unknown, name: string): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && /^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
    throw new ScimError(400, `${name} is not true or false.`, 'invalidValue');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The email of a User: the primary of `emails`, else the first, else `userName` when it is an address */
function emailOf(resource: Json, userName: string): string {
    const emails = attributeOf(resource, 'emails');
    const list = Array.isArray(emails) ? emails.filter(isObject) : [];
    const chosen = list.find((email) => attributeOf(email, 'primary') === true || attributeOf(email, 'primary') === 'True' || attributeOf(email, 'primary') === 'true') ?? list[0];
    const value = chosen === undefined ? userName : attributeOf(chosen, 'value');
    if (typeof value !== 'string' || !EMAIL.test(value.trim()) || value.length > 320) throw new ScimError(400, 'The user has no email: give emails or a userName that is an address.', 'invalidValue');
    return value.trim().toLowerCase();
}

/** What is kept of a User resource as a client sent it, or why it is refused */
export function userInputOf(resource: unknown): ScimUserInput {
    if (!isObject(resource)) throw new ScimError(400, 'The body is not a User.', 'invalidSyntax');
    const userName = textOf(resource, 'userName', 320, true) as string;
    const name = attributeOf(resource, 'name');
    const names = isObject(name) ? name : {};
    const active = attributeOf(resource, 'active');
    const externalId = textOf(resource, 'externalId', 1024);
    const displayName = textOf(resource, 'displayName', 200);
    const givenName = textOf(names, 'givenName', 200);
    const familyName = textOf(names, 'familyName', 200);
    return {
        userName,
        email: emailOf(resource, userName),
        active: active === undefined || active === null ? true : booleanOf(active, 'active'),
        ...(externalId !== undefined && { externalId }),
        ...(displayName !== undefined && { displayName }),
        ...(givenName !== undefined && { givenName }),
        ...(familyName !== undefined && { familyName })
    };
}

/** What is kept of a Group resource as a client sent it, or why it is refused */
export function groupInputOf(resource: unknown): ScimGroupInput {
    if (!isObject(resource)) throw new ScimError(400, 'The body is not a Group.', 'invalidSyntax');
    const displayName = textOf(resource, 'displayName', 100, true) as string;
    const externalId = textOf(resource, 'externalId', 1024);
    const members = attributeOf(resource, 'members');
    if (members !== undefined && members !== null && !Array.isArray(members)) throw new ScimError(400, 'members is not a list.', 'invalidValue');
    const ids = new Set<string>();
    for (const member of (members as unknown[] | undefined | null) ?? []) {
        const value = isObject(member) ? attributeOf(member, 'value') : undefined;
        if (typeof value !== 'string' || value === '') throw new ScimError(400, 'A member has no value.', 'invalidValue');
        const type = isObject(member) ? attributeOf(member, 'type') : undefined;
        if (typeof type === 'string' && type.toLowerCase() === 'group') throw new ScimError(400, 'Groups in groups are not supported.', 'invalidValue');
        ids.add(value);
    }
    return { displayName, ...(externalId !== undefined && { externalId }), members: [...ids] };
}

/** A pushed User as a client reads it */
export interface ScimUserRow {
    readonly id: string;
    readonly external_id: string | null;
    readonly user_name: string;
    readonly email: string;
    readonly display_name: string | null;
    readonly given_name: string | null;
    readonly family_name: string | null;
    readonly active: boolean;
    readonly created_at: Date;
    readonly updated_at: Date;
}

export function userResourceOf(row: ScimUserRow, base: string): Json {
    const name = { ...(row.given_name !== null && { givenName: row.given_name }), ...(row.family_name !== null && { familyName: row.family_name }) };
    return {
        schemas: [USER_SCHEMA],
        id: row.id,
        ...(row.external_id !== null && { externalId: row.external_id }),
        userName: row.user_name,
        ...(Object.keys(name).length > 0 && { name }),
        ...(row.display_name !== null && { displayName: row.display_name }),
        emails: [{ value: row.email, type: 'work', primary: true }],
        active: row.active,
        meta: { resourceType: 'User', created: row.created_at.toISOString(), lastModified: row.updated_at.toISOString(), location: `${base}/Users/${row.id}` }
    };
}

export interface ScimGroupRow {
    readonly id: string;
    readonly name: string;
    readonly external_id: string | null;
    readonly created_at: Date;
    readonly updated_at: Date;
}

export function groupResourceOf(row: ScimGroupRow, members: ReadonlyArray<{ readonly id: string; readonly display: string }> | undefined, base: string): Json {
    return {
        schemas: [GROUP_SCHEMA],
        id: row.id,
        ...(row.external_id !== null && { externalId: row.external_id }),
        displayName: row.name,
        ...(members !== undefined && { members: members.map((member) => ({ value: member.id, display: member.display, $ref: `${base}/Users/${member.id}` })) }),
        meta: { resourceType: 'Group', created: row.created_at.toISOString(), lastModified: row.updated_at.toISOString(), location: `${base}/Groups/${row.id}` }
    };
}

export function listOf(resources: readonly Json[], total: number, startIndex: number): Json {
    return { schemas: [LIST_SCHEMA], totalResults: total, startIndex, itemsPerPage: resources.length, Resources: resources };
}

/** `GET /ServiceProviderConfig` */
export function serviceProviderConfig(base: string): Json {
    return {
        schemas: [CONFIG_SCHEMA],
        documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: MAX_RESULTS },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'The token the org owner made on the org settings page', primary: true }],
        meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` }
    };
}

/** `GET /ResourceTypes` */
export function resourceTypes(base: string): Json[] {
    return [
        { schemas: [RESOURCE_TYPE_SCHEMA], id: 'User', name: 'User', endpoint: '/Users', schema: USER_SCHEMA, meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` } },
        { schemas: [RESOURCE_TYPE_SCHEMA], id: 'Group', name: 'Group', endpoint: '/Groups', schema: GROUP_SCHEMA, meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` } }
    ];
}

const attribute = (name: string, extra: Json = {}): Json => ({ name, type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', ...extra });

/** `GET /Schemas`: the attributes Magnetic keeps */
export function schemas(base: string): Json[] {
    return [
        {
            schemas: [SCHEMA_SCHEMA],
            id: USER_SCHEMA,
            name: 'User',
            attributes: [
                attribute('userName', { required: true, uniqueness: 'server' }),
                attribute('externalId', { caseExact: true }),
                attribute('displayName'),
                attribute('name', { type: 'complex', subAttributes: [attribute('givenName'), attribute('familyName')] }),
                attribute('emails', { type: 'complex', multiValued: true, subAttributes: [attribute('value'), attribute('type'), attribute('primary', { type: 'boolean' })] }),
                attribute('active', { type: 'boolean' })
            ],
            meta: { resourceType: 'Schema', location: `${base}/Schemas/${USER_SCHEMA}` }
        },
        {
            schemas: [SCHEMA_SCHEMA],
            id: GROUP_SCHEMA,
            name: 'Group',
            attributes: [
                attribute('displayName', { required: true, uniqueness: 'server' }),
                attribute('externalId', { caseExact: true }),
                attribute('members', { type: 'complex', multiValued: true, subAttributes: [attribute('value', { mutability: 'immutable' }), attribute('display', { mutability: 'readOnly' })] })
            ],
            meta: { resourceType: 'Schema', location: `${base}/Schemas/${GROUP_SCHEMA}` }
        }
    ];
}
