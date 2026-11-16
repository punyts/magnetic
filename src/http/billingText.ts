import type { Language } from '../prefs/Preferences.js';

/**
 * The words of the Agent use page, in each language Magnetic speaks. English is the source; every other language must
 * have every key (the type checks it). `{name}` marks a value filled in where the text is used (`fill`)
 */
const EN = {
    'billing.pageTitle': 'Agent use · Magnetic',
    'billing.title': 'Agent use',
    'billing.back': 'Your apps',
    'billing.intro': 'The agent is the only part of Magnetic that costs money. Everything else stays free: your apps, editing by hand, sharing and data.',
    'billing.included': 'Included with your account',
    'billing.added': 'Added',
    'billing.used': 'Used',
    'billing.left': 'Left',
    'billing.noLimit': 'Agent use has no limit per person on this server.',
    'billing.add': 'Add agent use',
    'billing.addOf': 'Add {amount}',
    'billing.addHint': "You pay on Stripe's page: Magnetic never sees your card. Each dollar adds a dollar of agent use, spent at the prices of the models.",
    'billing.unavailable': 'Adding agent use is not available on this server.',
    'billing.history': 'Payments',
    'billing.none': 'No payments yet.',
    'billing.column.date': 'Date',
    'billing.column.what': 'What',
    'billing.column.amount': 'Amount',
    'billing.payment': 'Payment',
    'billing.refund': 'Refund',
    'billing.paid': '{amount} of agent use is added. Thank you.',
    'billing.pending': 'Thank you. Your payment is being confirmed: it shows here in a moment.',
    'billing.checkAgain': 'Check again',
    'billing.cancelled': 'The payment was cancelled. Nothing was charged.',
    'billing.badAmount': 'Choose one of the amounts offered.',
    'billing.failed': 'The payment provider could not start a checkout. Try again in a moment.'
} as const;

export type BillingTextKey = keyof typeof EN;
export type BillingTexts = Record<BillingTextKey, string>;

const DE: BillingTexts = {
    'billing.pageTitle': 'Agentennutzung · Magnetic',
    'billing.title': 'Agentennutzung',
    'billing.back': 'Deine Apps',
    'billing.intro': 'Der Agent ist der einzige Teil von Magnetic, der Geld kostet. Alles andere bleibt kostenlos: deine Apps, Bearbeiten von Hand, Teilen und Daten.',
    'billing.included': 'In deinem Konto enthalten',
    'billing.added': 'Hinzugefügt',
    'billing.used': 'Verbraucht',
    'billing.left': 'Übrig',
    'billing.noLimit': 'Auf diesem Server ist die Agentennutzung pro Person nicht begrenzt.',
    'billing.add': 'Agentennutzung hinzufügen',
    'billing.addOf': '{amount} hinzufügen',
    'billing.addHint': 'Du bezahlst auf der Seite von Stripe: Magnetic sieht deine Karte nie. Jeder Dollar fügt einen Dollar Agentennutzung hinzu, verbraucht zu den Preisen der Modelle.',
    'billing.unavailable': 'Auf diesem Server kann keine Agentennutzung hinzugefügt werden.',
    'billing.history': 'Zahlungen',
    'billing.none': 'Noch keine Zahlungen.',
    'billing.column.date': 'Datum',
    'billing.column.what': 'Was',
    'billing.column.amount': 'Betrag',
    'billing.payment': 'Zahlung',
    'billing.refund': 'Erstattung',
    'billing.paid': '{amount} Agentennutzung ist hinzugefügt. Danke.',
    'billing.pending': 'Danke. Deine Zahlung wird bestätigt: Sie erscheint hier gleich.',
    'billing.checkAgain': 'Erneut prüfen',
    'billing.cancelled': 'Die Zahlung wurde abgebrochen. Es wurde nichts berechnet.',
    'billing.badAmount': 'Wähl einen der angebotenen Beträge.',
    'billing.failed': 'Der Zahlungsanbieter konnte den Bezahlvorgang nicht starten. Versuch es gleich noch einmal.'
};

const FR: BillingTexts = {
    'billing.pageTitle': 'Utilisation de l’agent · Magnetic',
    'billing.title': 'Utilisation de l’agent',
    'billing.back': 'Vos applications',
    'billing.intro': 'L’agent est la seule partie de Magnetic qui coûte de l’argent. Tout le reste reste gratuit : vos applications, la modification à la main, le partage et les données.',
    'billing.included': 'Inclus avec votre compte',
    'billing.added': 'Ajouté',
    'billing.used': 'Utilisé',
    'billing.left': 'Restant',
    'billing.noLimit': 'L’utilisation de l’agent n’a pas de limite par personne sur ce serveur.',
    'billing.add': 'Ajouter de l’utilisation de l’agent',
    'billing.addOf': 'Ajouter {amount}',
    'billing.addHint': 'Vous payez sur la page de Stripe : Magnetic ne voit jamais votre carte. Chaque dollar ajoute un dollar d’utilisation de l’agent, dépensé aux prix des modèles.',
    'billing.unavailable': 'Ce serveur ne permet pas d’ajouter de l’utilisation de l’agent.',
    'billing.history': 'Paiements',
    'billing.none': 'Aucun paiement pour l’instant.',
    'billing.column.date': 'Date',
    'billing.column.what': 'Quoi',
    'billing.column.amount': 'Montant',
    'billing.payment': 'Paiement',
    'billing.refund': 'Remboursement',
    'billing.paid': '{amount} d’utilisation de l’agent ajoutés. Merci.',
    'billing.pending': 'Merci. Votre paiement est en cours de confirmation : il apparaîtra ici dans un instant.',
    'billing.checkAgain': 'Vérifier à nouveau',
    'billing.cancelled': 'Le paiement a été annulé. Rien n’a été débité.',
    'billing.badAmount': 'Choisissez l’un des montants proposés.',
    'billing.failed': 'Le prestataire de paiement n’a pas pu ouvrir le paiement. Réessayez dans un instant.'
};

const ES: BillingTexts = {
    'billing.pageTitle': 'Uso del agente · Magnetic',
    'billing.title': 'Uso del agente',
    'billing.back': 'Tus aplicaciones',
    'billing.intro': 'El agente es la única parte de Magnetic que cuesta dinero. Todo lo demás sigue siendo gratis: tus aplicaciones, la edición a mano, compartir y los datos.',
    'billing.included': 'Incluido con tu cuenta',
    'billing.added': 'Añadido',
    'billing.used': 'Usado',
    'billing.left': 'Disponible',
    'billing.noLimit': 'En este servidor el uso del agente no tiene límite por persona.',
    'billing.add': 'Añadir uso del agente',
    'billing.addOf': 'Añadir {amount}',
    'billing.addHint': 'Pagas en la página de Stripe: Magnetic nunca ve tu tarjeta. Cada dólar añade un dólar de uso del agente, gastado a los precios de los modelos.',
    'billing.unavailable': 'En este servidor no se puede añadir uso del agente.',
    'billing.history': 'Pagos',
    'billing.none': 'Aún no hay pagos.',
    'billing.column.date': 'Fecha',
    'billing.column.what': 'Qué',
    'billing.column.amount': 'Importe',
    'billing.payment': 'Pago',
    'billing.refund': 'Reembolso',
    'billing.paid': 'Se han añadido {amount} de uso del agente. Gracias.',
    'billing.pending': 'Gracias. Tu pago se está confirmando: aparecerá aquí en un momento.',
    'billing.checkAgain': 'Comprobar de nuevo',
    'billing.cancelled': 'El pago se canceló. No se ha cobrado nada.',
    'billing.badAmount': 'Elige uno de los importes ofrecidos.',
    'billing.failed': 'El proveedor de pagos no pudo iniciar el pago. Inténtalo de nuevo en un momento.'
};

const ALL: Record<Language, BillingTexts> = { en: EN, de: DE, fr: FR, es: ES };

export const billingTextsOf = (language: Language): BillingTexts => ALL[language] ?? EN;

/** What the page says after a change: a key and its values, in the person's language */
export type BillingSaid = { readonly key: BillingTextKey; readonly values?: Readonly<Record<string, string>> };
