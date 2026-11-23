import type { Language } from '../prefs/Preferences.js';

/**
 * The words of the Requests page (docs/design/statenet-requests.md, R3c), in each language Magnetic speaks. English is
 * the source; every other language must have every key (the type checks it). `{name}` marks a value filled in where
 * the text is used (`fill`)
 */
const EN = {
    'requests.pageTitle': 'Requests · Magnetic',
    'requests.title': 'Requests',
    'requests.back': 'Your apps',
    'requests.intro': 'Changes people using your apps asked for. Nothing is saved until you approve it.',
    'requests.none': 'No changes wait for your approval.',
    'requests.own': 'Yours',
    'requests.column.dataset': 'Dataset',
    'requests.column.by': 'Asked by',
    'requests.column.at': 'Asked',
    'requests.column.until': 'Waits until',
    'requests.open': 'Open',
    'requests.detailTitle': 'A change to {dataset}',
    'requests.detailBy': 'Asked by {name} on {at}. It waits until {until}.',
    'requests.field': 'Field',
    'requests.now': 'Now',
    'requests.asked': 'Asked for',
    'requests.newRecord': 'A new record {key}',
    'requests.record': 'The record {key}',
    'requests.removeRecord': 'Remove the record {key}',
    'requests.whole': 'Replace the records of {dataset}',
    'requests.at': 'At {path}',
    'requests.nothing': '(none)',
    'requests.note': 'A note for them (optional)',
    'requests.approve': 'Approve',
    'requests.reject': 'Reject',
    'requests.approved': 'The change to {dataset} is saved.',
    'requests.rejected': 'The change to {dataset} is rejected.',
    'requests.refused': 'The change to {dataset} could not be saved ({code}).',
    'requests.gone': 'That request is no longer waiting.',
    'requests.noAnswer': 'The dataset did not answer. Try again.',
    'requests.notManaged': 'You do not manage the data of that workspace.',
    'requests.someone': 'someone'
};

export type RequestsTextKey = keyof typeof EN;
export type RequestsTexts = Record<RequestsTextKey, string>;

const DE: RequestsTexts = {
    'requests.pageTitle': 'Anfragen · Magnetic',
    'requests.title': 'Anfragen',
    'requests.back': 'Deine Apps',
    'requests.intro': 'Änderungen, um die Personen gebeten haben, die deine Apps nutzen. Nichts wird gespeichert, bevor du zustimmst.',
    'requests.none': 'Keine Änderungen warten auf deine Zustimmung.',
    'requests.own': 'Deiner',
    'requests.column.dataset': 'Datensatz',
    'requests.column.by': 'Angefragt von',
    'requests.column.at': 'Angefragt',
    'requests.column.until': 'Wartet bis',
    'requests.open': 'Öffnen',
    'requests.detailTitle': 'Eine Änderung an {dataset}',
    'requests.detailBy': 'Angefragt von {name} am {at}. Sie wartet bis {until}.',
    'requests.field': 'Feld',
    'requests.now': 'Jetzt',
    'requests.asked': 'Angefragt',
    'requests.newRecord': 'Ein neuer Eintrag {key}',
    'requests.record': 'Der Eintrag {key}',
    'requests.removeRecord': 'Den Eintrag {key} entfernen',
    'requests.whole': 'Die Einträge von {dataset} ersetzen',
    'requests.at': 'Bei {path}',
    'requests.nothing': '(keiner)',
    'requests.note': 'Eine Notiz für sie (optional)',
    'requests.approve': 'Zustimmen',
    'requests.reject': 'Ablehnen',
    'requests.approved': 'Die Änderung an {dataset} ist gespeichert.',
    'requests.rejected': 'Die Änderung an {dataset} ist abgelehnt.',
    'requests.refused': 'Die Änderung an {dataset} konnte nicht gespeichert werden ({code}).',
    'requests.gone': 'Diese Anfrage wartet nicht mehr.',
    'requests.noAnswer': 'Der Datensatz hat nicht geantwortet. Versuche es noch einmal.',
    'requests.notManaged': 'Du verwaltest die Daten dieses Arbeitsbereichs nicht.',
    'requests.someone': 'jemandem'
};

const FR: RequestsTexts = {
    'requests.pageTitle': 'Demandes · Magnetic',
    'requests.title': 'Demandes',
    'requests.back': 'Vos apps',
    'requests.intro': 'Les changements demandés par les personnes qui utilisent vos apps. Rien n’est enregistré avant votre accord.',
    'requests.none': 'Aucun changement n’attend votre accord.',
    'requests.own': 'Le vôtre',
    'requests.column.dataset': 'Jeu de données',
    'requests.column.by': 'Demandé par',
    'requests.column.at': 'Demandé',
    'requests.column.until': 'Attend jusqu’au',
    'requests.open': 'Ouvrir',
    'requests.detailTitle': 'Un changement de {dataset}',
    'requests.detailBy': 'Demandé par {name} le {at}. Il attend jusqu’au {until}.',
    'requests.field': 'Champ',
    'requests.now': 'Maintenant',
    'requests.asked': 'Demandé',
    'requests.newRecord': 'Un nouvel enregistrement {key}',
    'requests.record': 'L’enregistrement {key}',
    'requests.removeRecord': 'Supprimer l’enregistrement {key}',
    'requests.whole': 'Remplacer les enregistrements de {dataset}',
    'requests.at': 'À {path}',
    'requests.nothing': '(aucun)',
    'requests.note': 'Une note pour eux (facultatif)',
    'requests.approve': 'Accepter',
    'requests.reject': 'Refuser',
    'requests.approved': 'Le changement de {dataset} est enregistré.',
    'requests.rejected': 'Le changement de {dataset} est refusé.',
    'requests.refused': 'Le changement de {dataset} n’a pas pu être enregistré ({code}).',
    'requests.gone': 'Cette demande n’attend plus.',
    'requests.noAnswer': 'Le jeu de données n’a pas répondu. Réessayez.',
    'requests.notManaged': 'Vous ne gérez pas les données de cet espace.',
    'requests.someone': 'quelqu’un'
};

const ES: RequestsTexts = {
    'requests.pageTitle': 'Solicitudes · Magnetic',
    'requests.title': 'Solicitudes',
    'requests.back': 'Tus apps',
    'requests.intro': 'Los cambios que pidieron las personas que usan tus apps. Nada se guarda hasta que lo apruebes.',
    'requests.none': 'Ningún cambio espera tu aprobación.',
    'requests.own': 'El tuyo',
    'requests.column.dataset': 'Conjunto de datos',
    'requests.column.by': 'Pedido por',
    'requests.column.at': 'Pedido',
    'requests.column.until': 'Espera hasta',
    'requests.open': 'Abrir',
    'requests.detailTitle': 'Un cambio en {dataset}',
    'requests.detailBy': 'Pedido por {name} el {at}. Espera hasta el {until}.',
    'requests.field': 'Campo',
    'requests.now': 'Ahora',
    'requests.asked': 'Pedido',
    'requests.newRecord': 'Un registro nuevo {key}',
    'requests.record': 'El registro {key}',
    'requests.removeRecord': 'Quitar el registro {key}',
    'requests.whole': 'Reemplazar los registros de {dataset}',
    'requests.at': 'En {path}',
    'requests.nothing': '(ninguno)',
    'requests.note': 'Una nota para ellos (opcional)',
    'requests.approve': 'Aprobar',
    'requests.reject': 'Rechazar',
    'requests.approved': 'El cambio en {dataset} está guardado.',
    'requests.rejected': 'El cambio en {dataset} está rechazado.',
    'requests.refused': 'El cambio en {dataset} no se pudo guardar ({code}).',
    'requests.gone': 'Esa solicitud ya no espera.',
    'requests.noAnswer': 'El conjunto de datos no respondió. Inténtalo de nuevo.',
    'requests.notManaged': 'No gestionas los datos de ese espacio.',
    'requests.someone': 'alguien'
};

const ALL: Record<Language, RequestsTexts> = { en: EN, de: DE, fr: FR, es: ES };

/** Every text of the Requests page in a language */
export function requestsTextsOf(language: Language): RequestsTexts {
    return ALL[language];
}
