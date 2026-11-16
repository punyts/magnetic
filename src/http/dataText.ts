import type { Language } from '../prefs/Preferences.js';

/**
 * The words of the Data page, in each language Magnetic speaks. English is the source; every other language must have
 * every key (the type checks it). `{name}` marks a value filled in where the text is used (`fill`). The reasons a
 * change was refused by the grants come from the server in English, as on the org pages
 */
const EN = {
    'data.pageTitle': 'Data · Magnetic',
    'data.title': 'Data',
    'data.back': 'Your apps',
    'data.intro': "Share a dataset with another person or org: their apps can read it, live, but never change it. You can stop sharing it at any time.",
    'data.own': 'Yours',
    'data.ours': "This workspace's datasets",
    'data.none': '{workspace} has no datasets yet. Ask the agent to make one for an app.',
    'data.summary': '{count} records · model {model}',
    'data.sharedWith': 'Shared with',
    'data.notShared': 'Not shared with anyone.',
    'data.stop': 'Stop sharing',
    'data.stopOf': 'Stop sharing {dataset} with {name}',
    'data.shareWith': "Share with (an email, or an org's short name)",
    'data.share': 'Share',
    'data.theirs': 'Shared with this workspace',
    'data.theirsNone': 'No one has shared a dataset with {workspace}.',
    'data.theirsIntro': 'Ask the agent to use one in an app: it reads the records, and sees each change.',
    'data.column.dataset': 'Dataset',
    'data.column.owner': 'Shared by',
    'data.column.read': 'How an app reads it',
    'data.person': '{name} ({email})',
    'data.org': '{name} (org)',
    'data.shared': '{dataset} is shared with {name}. Their apps can read it now.',
    'data.already': '{dataset} is already shared with {name}.',
    'data.stopped': '{dataset} is no longer shared with {name}.',
    'data.noPerson': 'No one in Magnetic has the verified email {to}.',
    'data.noOrg': 'No org has the short name {to}.',
    'data.self': 'That is this workspace: its datasets are its own already.',
    'data.noDataset': 'This workspace has no dataset {dataset}.',
    'data.notManaged': 'You do not manage the data of that workspace.',
    'data.noShare': 'That share is not there any more.',
    'data.unavailable': 'This server cannot share data: it has no signing key.',
    'data.unknown': 'Unknown change.'
};

export type DataTextKey = keyof typeof EN;
export type DataTexts = Record<DataTextKey, string>;

const DE: DataTexts = {
    'data.pageTitle': 'Daten · Magnetic',
    'data.title': 'Daten',
    'data.back': 'Deine Apps',
    'data.intro': 'Teile einen Datensatz mit einer anderen Person oder Organisation: Ihre Apps können ihn live lesen, aber nie ändern. Du kannst das Teilen jederzeit beenden.',
    'data.own': 'Deiner',
    'data.ours': 'Die Datensätze dieses Arbeitsbereichs',
    'data.none': '{workspace} hat noch keine Datensätze. Bitte den Agenten, einen für eine App anzulegen.',
    'data.summary': '{count} Einträge · Modell {model}',
    'data.sharedWith': 'Geteilt mit',
    'data.notShared': 'Mit niemandem geteilt.',
    'data.stop': 'Nicht mehr teilen',
    'data.stopOf': '{dataset} nicht mehr mit {name} teilen',
    'data.shareWith': 'Teilen mit (einer E-Mail oder dem Kurznamen einer Organisation)',
    'data.share': 'Teilen',
    'data.theirs': 'Mit diesem Arbeitsbereich geteilt',
    'data.theirsNone': 'Niemand hat einen Datensatz mit {workspace} geteilt.',
    'data.theirsIntro': 'Bitte den Agenten, einen davon in einer App zu verwenden: Sie liest die Einträge und sieht jede Änderung.',
    'data.column.dataset': 'Datensatz',
    'data.column.owner': 'Geteilt von',
    'data.column.read': 'So liest eine App ihn',
    'data.person': '{name} ({email})',
    'data.org': '{name} (Organisation)',
    'data.shared': '{dataset} ist mit {name} geteilt. Ihre Apps können ihn jetzt lesen.',
    'data.already': '{dataset} ist schon mit {name} geteilt.',
    'data.stopped': '{dataset} ist nicht mehr mit {name} geteilt.',
    'data.noPerson': 'Niemand in Magnetic hat die bestätigte E-Mail {to}.',
    'data.noOrg': 'Keine Organisation hat den Kurznamen {to}.',
    'data.self': 'Das ist dieser Arbeitsbereich: Seine Datensätze gehören ihm schon.',
    'data.noDataset': 'Dieser Arbeitsbereich hat keinen Datensatz {dataset}.',
    'data.notManaged': 'Du verwaltest die Daten dieses Arbeitsbereichs nicht.',
    'data.noShare': 'Diese Freigabe gibt es nicht mehr.',
    'data.unavailable': 'Dieser Server kann keine Daten teilen: Er hat keinen Signaturschlüssel.',
    'data.unknown': 'Unbekannte Änderung.'
};

const FR: DataTexts = {
    'data.pageTitle': 'Données · Magnetic',
    'data.title': 'Données',
    'data.back': 'Vos apps',
    'data.intro': 'Partagez un jeu de données avec une autre personne ou organisation : ses apps peuvent le lire, en direct, mais jamais le modifier. Vous pouvez arrêter de le partager à tout moment.',
    'data.own': 'Le vôtre',
    'data.ours': 'Les jeux de données de cet espace',
    'data.none': '{workspace} n’a pas encore de jeu de données. Demandez à l’agent d’en créer un pour une app.',
    'data.summary': '{count} enregistrements · modèle {model}',
    'data.sharedWith': 'Partagé avec',
    'data.notShared': 'Partagé avec personne.',
    'data.stop': 'Arrêter le partage',
    'data.stopOf': 'Arrêter de partager {dataset} avec {name}',
    'data.shareWith': 'Partager avec (un e-mail, ou le nom court d’une organisation)',
    'data.share': 'Partager',
    'data.theirs': 'Partagé avec cet espace',
    'data.theirsNone': 'Personne n’a partagé de jeu de données avec {workspace}.',
    'data.theirsIntro': 'Demandez à l’agent d’en utiliser un dans une app : elle lit les enregistrements et voit chaque changement.',
    'data.column.dataset': 'Jeu de données',
    'data.column.owner': 'Partagé par',
    'data.column.read': 'Comment une app le lit',
    'data.person': '{name} ({email})',
    'data.org': '{name} (organisation)',
    'data.shared': '{dataset} est partagé avec {name}. Ses apps peuvent le lire dès maintenant.',
    'data.already': '{dataset} est déjà partagé avec {name}.',
    'data.stopped': '{dataset} n’est plus partagé avec {name}.',
    'data.noPerson': 'Personne dans Magnetic n’a l’e-mail vérifié {to}.',
    'data.noOrg': 'Aucune organisation n’a le nom court {to}.',
    'data.self': 'C’est cet espace : ses jeux de données sont déjà les siens.',
    'data.noDataset': 'Cet espace n’a pas de jeu de données {dataset}.',
    'data.notManaged': 'Vous ne gérez pas les données de cet espace.',
    'data.noShare': 'Ce partage n’existe plus.',
    'data.unavailable': 'Ce serveur ne peut pas partager de données : il n’a pas de clé de signature.',
    'data.unknown': 'Changement inconnu.'
};

const ES: DataTexts = {
    'data.pageTitle': 'Datos · Magnetic',
    'data.title': 'Datos',
    'data.back': 'Tus apps',
    'data.intro': 'Comparte un conjunto de datos con otra persona u organización: sus apps pueden leerlo, en vivo, pero nunca cambiarlo. Puedes dejar de compartirlo en cualquier momento.',
    'data.own': 'El tuyo',
    'data.ours': 'Los conjuntos de datos de este espacio',
    'data.none': '{workspace} aún no tiene conjuntos de datos. Pide al agente que cree uno para una app.',
    'data.summary': '{count} registros · modelo {model}',
    'data.sharedWith': 'Compartido con',
    'data.notShared': 'No compartido con nadie.',
    'data.stop': 'Dejar de compartir',
    'data.stopOf': 'Dejar de compartir {dataset} con {name}',
    'data.shareWith': 'Compartir con (un correo, o el nombre corto de una organización)',
    'data.share': 'Compartir',
    'data.theirs': 'Compartido con este espacio',
    'data.theirsNone': 'Nadie ha compartido un conjunto de datos con {workspace}.',
    'data.theirsIntro': 'Pide al agente que use uno en una app: lee los registros y ve cada cambio.',
    'data.column.dataset': 'Conjunto de datos',
    'data.column.owner': 'Compartido por',
    'data.column.read': 'Cómo lo lee una app',
    'data.person': '{name} ({email})',
    'data.org': '{name} (organización)',
    'data.shared': '{dataset} está compartido con {name}. Sus apps ya pueden leerlo.',
    'data.already': '{dataset} ya está compartido con {name}.',
    'data.stopped': '{dataset} ya no está compartido con {name}.',
    'data.noPerson': 'Nadie en Magnetic tiene el correo verificado {to}.',
    'data.noOrg': 'Ninguna organización tiene el nombre corto {to}.',
    'data.self': 'Ese es este espacio: sus conjuntos de datos ya son suyos.',
    'data.noDataset': 'Este espacio no tiene el conjunto de datos {dataset}.',
    'data.notManaged': 'No gestionas los datos de ese espacio.',
    'data.noShare': 'Ese permiso ya no existe.',
    'data.unavailable': 'Este servidor no puede compartir datos: no tiene clave de firma.',
    'data.unknown': 'Cambio desconocido.'
};

const ALL: Record<Language, DataTexts> = { en: EN, de: DE, fr: FR, es: ES };

/** Every text of the Data page in a language */
export function dataTextsOf(language: Language): DataTexts {
    return ALL[language];
}

/** What the page says after a change: a text of its own with its values, or a reason from the server (in English) */
export type DataSaid = { readonly key: DataTextKey; readonly values?: Readonly<Record<string, string>> } | string;
