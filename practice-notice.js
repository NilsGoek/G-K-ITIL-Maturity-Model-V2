/** Reusable visible explanation; it never selects a Practice or changes an answer. */
export function pr02Notice({ compact = false,included = false,withAction = true } = {}) {
  return `<aside class="pr02-notice${compact ? ' pr02-notice--compact' : ' pr02-notice--corner'}" aria-label="PR02-Abhängigkeit von Continual Improvement">
    <div class="pr02-notice-kicker"><span class="pr02-notice-symbol" aria-hidden="true">PR02 → CI</span><span>Für Continual Improvement erforderlich</span></div>
    <h3>PR02 · Continual Improvement</h3>
    <p>${compact ? 'Die CI-Kategorie benötigt diese separat bewertete Practice auf mindestens derselben Stufe.' : 'Die Kategorie Continual Improvement (CI) benötigt zusätzlich die Fähigkeitsbewertung dieser Practice.'}</p>
    <div class="pr02-notice-rule">PR02 ≥ gewünschte CI-Stufe</div>
    <p class="pr02-notice-detail">Auch die CI-Voraussetzungen müssen erfüllt sein. Beide Bewertungen müssen dieselbe Bewertungseinheit, denselben Umfang und Zeitraum betreffen.</p>
    ${withAction ? `<button type="button" class="btn pr02-notice-action"${included ? ' data-practice="PR02"' : ' data-route="practices"'}>${included ? 'PR02 bewerten →' : 'PR02 im Bewertungsumfang auswählen →'}</button>` : ''}
  </aside>`;
}

export const pr02NoticeHtml = pr02Notice;
