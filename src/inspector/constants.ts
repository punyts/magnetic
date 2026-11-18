/**
 * The workspace of Magnetic's own page-driven apps (the default editor, the sign-in and link pages). No account has
 * this id (accounts get random ones), so no person signs in to it and none of its apps is served at `/apps`
 */
export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000000';

/**
 * The workspace of the admins' drafts of Magnetic's own pages (docs/design/magnetic-editable.md): only admins reach its
 * apps, in the editor. No account has this id either
 */
export const PAGES_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

/** The categories of the component library, as the editor's Add tab offers them */
export const COMPONENT_CATEGORIES = ['layout', 'navigation', 'forms', 'data', 'feedback', 'overlays', 'content', 'conversation', 'graphics'] as const;
