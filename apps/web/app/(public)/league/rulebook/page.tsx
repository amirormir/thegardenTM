import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PERFORMANCE_COMPENSATIONS = [
  { rank: '1er', amount: '1,5 M' },
  { rank: '2e', amount: '2,5 M' },
  { rank: '3e', amount: '3,0 M' },
  { rank: '4e', amount: '3,5 M' },
  { rank: '5e', amount: '3,5 M' },
  { rank: '6e', amount: '5,0 M' },
  { rank: '7e', amount: '6,0 M' },
  { rank: '8e', amount: '7,0 M' },
  { rank: '9e', amount: '8,0 M' },
  { rank: '10e (dernier)', amount: '10,0 M' },
] as const;

const COST_BASE_VALUES = [
  { cost: '5', value: '55 M' },
  { cost: '4', value: '40 M' },
  { cost: '3', value: '30 M' },
  { cost: '2', value: '20 M' },
  { cost: '1', value: '10 M' },
] as const;

function RuleSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-8 border-t border-hairline pt-8">
      <h2 className="display-md text-foreground">{title}</h2>
      <div className="flex flex-col gap-8 text-base leading-8 text-foreground-dim md:text-lg md:leading-9">
        {children}
      </div>
    </section>
  );
}

function RuleSubsection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-foreground md:text-xl">{title}</h3>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function RuleList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function LeagueRulebookPage() {
  return (
    <div className="flex flex-col gap-16 md:gap-20">
      <header className="border-b border-hairline pb-8">
        <p className="breadcrumb-mono">§ 06 · Rulebook</p>
        <h1 className="mt-4 display-lg text-foreground">Garden — Rulebook officiel.</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-foreground-dim">
          Document de référence pour les règles de la ligue Garden. Toutes les valeurs
          chiffrées mentionnées dans ce document peuvent être modifiées par le staff.
        </p>
      </header>

      <div className="grid gap-12 xl:grid-cols-[0.32fr_0.68fr] xl:gap-16">
        <aside className="h-fit border border-hairline bg-surface px-5 py-5">
          <p className="label-mono text-foreground-muted">Navigation</p>
          <nav aria-label="Sommaire rulebook" className="mt-4 flex flex-col gap-3 text-sm">
            <a href="#creation-equipe" className="transition-colors hover:text-foreground">
              1. Création d&apos;équipe
            </a>
            <a href="#budget" className="transition-colors hover:text-foreground">
              2. Budget
            </a>
            <a href="#valeur-marchande" className="transition-colors hover:text-foreground">
              3. Valeur marchande
            </a>
            <a href="#contrats" className="transition-colors hover:text-foreground">
              4. Contrats
            </a>
            <a href="#transferts" className="transition-colors hover:text-foreground">
              5. Transferts
            </a>
            <a href="#matchs" className="transition-colors hover:text-foreground">
              6. Matchs &amp; format
            </a>
            <a href="#paris" className="transition-colors hover:text-foreground">
              7. Paris
            </a>
            <a href="#comportement" className="transition-colors hover:text-foreground">
              8. Comportement
            </a>
            <a href="#remplacants" className="transition-colors hover:text-foreground">
              9. Remplaçants
            </a>
            <a href="#rappels" className="transition-colors hover:text-foreground">
              10. Rappels et points en attente
            </a>
          </nav>
        </aside>

        <article className="flex flex-col gap-10">
          <RuleSection id="creation-equipe" title="1. Création d'équipe">
            <RuleSubsection title="1.1 Système de cost">
              <RuleList
                items={[
                  <>Chaque joueur possède un <strong className="text-foreground">cost compris entre 1 et 5</strong>.</>,
                  <>Chaque équipe peut comporter, à sa création, un <strong className="text-foreground">total maximum de 15 cost</strong>.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="1.2 Attribution des costs">
              <RuleList
                items={[
                  <>
                    La majorité des costs sera déterminée <strong className="text-foreground">une première fois</strong> avec
                    l&apos;opinion ouverte de n&apos;importe qui durant une soirée dédiée.
                  </>,
                  <>Après cette soirée, tous les prochains costs à déterminer le seront <strong className="text-foreground">uniquement par le staff</strong>.</>,
                ]}
              />
            </RuleSubsection>
          </RuleSection>

          <RuleSection id="budget" title="2. Budget">
            <div className="border border-hairline bg-surface px-5 py-4 text-sm text-foreground-dim">
              ⚠️ Disclaimer : toutes les valeurs citées dans cette section peuvent être modifiées
              par le staff.
            </div>

            <RuleSubsection title="2.1 Budget de départ">
              <RuleList
                items={[
                  <>
                    Chaque équipe reçoit à sa création un <strong className="text-foreground">budget transfert de 40 millions</strong>.
                  </>,
                  <>
                    Chaque équipe reçoit aussi une <strong className="text-foreground">masse salariale de 5 millions</strong>.
                  </>,
                  <>Ce budget peut être <strong className="text-foreground">équilibré librement</strong> par le chef d&apos;équipe.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="2.2 Conversion budget transfert ⇄ masse salariale">
              <RuleList
                items={[
                  <>
                    <strong className="text-foreground">Transfert vers salarial</strong> : on divise la somme à injecter par le{' '}
                    <strong className="text-foreground">nombre de BO</strong> qu&apos;une équipe doit jouer sur la saison régulière.
                  </>,
                  <>
                    <strong className="text-foreground">Salarial vers transfert</strong> : on applique l&apos;opération inverse.
                  </>,
                  <>
                    <strong className="text-foreground">Nombre de BO actuellement fixé</strong> : 18.
                  </>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="2.3 Sources de revenus">
              <p>
                Pour l&apos;instant, il n&apos;existe que <strong className="text-foreground">deux moyens</strong> de gagner du
                budget :
              </p>
              <RuleList
                items={[
                  <>Vendre un joueur.</>,
                  <>Compensations de performance, distribuées à chaque deadline selon le classement.</>,
                ]}
              />

              <div className="overflow-x-auto border-t border-hairline">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Classement</TableHead>
                      <TableHead>Compensation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PERFORMANCE_COMPENSATIONS.map((entry) => (
                      <TableRow key={entry.rank}>
                        <TableCell>{entry.rank}</TableCell>
                        <TableCell className="font-display tabular-nums text-foreground">
                          {entry.amount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </RuleSubsection>
          </RuleSection>

          <RuleSection id="valeur-marchande" title="3. Valeur marchande (VM)">
            <RuleSubsection title="3.1 Principes">
              <RuleList
                items={[
                  <>Chaque joueur possède une <strong className="text-foreground">valeur marchande (VM)</strong>.</>,
                  <>L&apos;échelle de la VM est calée sur celle utilisée dans le <strong className="text-foreground">sport classique</strong>.</>,
                  <>La <strong className="text-foreground">VM de base</strong> d&apos;un joueur correspond simplement à son cost.</>,
                  <>Les valeurs ci-dessous sont des <strong className="text-foreground">VM de base</strong> : la VM d&apos;un joueur peut ensuite monter bien au-delà.</>,
                ]}
              />

              <div className="overflow-x-auto border-t border-hairline">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cost</TableHead>
                      <TableHead>VM de base</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {COST_BASE_VALUES.map((entry) => (
                      <TableRow key={entry.cost}>
                        <TableCell>Cost {entry.cost}</TableCell>
                        <TableCell className="font-display tabular-nums text-foreground">
                          {entry.value}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </RuleSubsection>

            <RuleSubsection title="3.2 Évolution de la VM">
              <RuleList
                items={[
                  <>Après chaque game, un <strong className="text-foreground">algorithme</strong> attribue une note de performance au joueur.</>,
                  <>Cette note fait évoluer la VM <strong className="text-foreground">à la hausse ou à la baisse</strong>.</>,
                  <>
                    L&apos;algorithme est conçu pour récompenser la <strong className="text-foreground">régularité</strong> et la{' '}
                    <strong className="text-foreground">performance</strong>.
                  </>,
                  <>
                    L&apos;algorithme est aussi conçu pour punir les joueurs <strong className="text-foreground">irréguliers</strong> et les{' '}
                    <strong className="text-foreground">grosses baisses de performance</strong>.
                  </>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="3.3 Comment marche l'algorithme (en clair)">
              <p>
                Pas besoin d&apos;être développeur. Derrière chaque joueur, on garde trois choses :
                sa <strong className="text-foreground">valeur (VM)</strong>, son{' '}
                <strong className="text-foreground">niveau habituel</strong> (la moyenne de tes
                dernières perfs) et sa <strong className="text-foreground">régularité</strong> (est-ce
                que tu es constant ou en dents de scie).
              </p>

              <p>
                Après chaque game d&apos;<strong className="text-foreground">au moins 10 minutes</strong>{' '}
                (les remakes/AFK ne comptent pas), l&apos;algo te donne une{' '}
                <strong className="text-foreground">note sur 100</strong> à partir de tes stats :
                KDA, participation aux kills, part des dégâts et de l&apos;or de ton équipe, CS/min,
                score de vision, objectifs pris par l&apos;équipe (dragons, barons, tours) et la
                victoire ou la défaite. Ta note est comparée à celle de{' '}
                <strong className="text-foreground">ton adversaire direct au même poste</strong>.
              </p>

              <p>Ensuite ta valeur bouge selon trois idées simples :</p>
              <RuleList
                items={[
                  <>
                    <strong className="text-foreground">Retour vers ton vrai niveau</strong> : ta valeur
                    glisse doucement vers le palier qui correspond à ton niveau habituel. Enchaîne les
                    bonnes notes et ce niveau monte, donc ta valeur grimpe avec.
                  </>,
                  <>
                    <strong className="text-foreground">La surprise du jour</strong> : jouer{' '}
                    <strong className="text-foreground">au-dessus</strong> de ton niveau habituel te fait
                    gagner de la valeur, jouer <strong className="text-foreground">en dessous</strong> t&apos;en
                    fait perdre. Plus l&apos;écart est grand, plus le mouvement est fort.
                  </>,
                  <>
                    <strong className="text-foreground">L&apos;effet richesse</strong> : plus tu es déjà
                    cher, plus il est dur de monter encore ; plus tu es bas, plus il est dur de chuter
                    encore. Ça évite que les valeurs s&apos;emballent dans un sens ou dans l&apos;autre.
                  </>,
                ]}
              />

              <RuleList
                items={[
                  <>
                    <strong className="text-foreground">La régularité est récompensée</strong> : un joueur
                    constant progresse de façon douce et sûre ; un joueur en dents de scie subit des
                    variations plus violentes — une grosse contre-performance fait donc très mal.
                  </>,
                  <>
                    <strong className="text-foreground">Garde-fou</strong> : une très bonne (ou très
                    mauvaise) game fait <strong className="text-foreground">toujours</strong> bouger ta
                    valeur dans le bon sens, au moins un peu.
                  </>,
                ]}
              />

              <p className="text-sm text-foreground-muted">
                En résumé : sois performant <strong className="text-foreground">et</strong> régulier
                pour faire monter ta valeur durablement ; une seule très mauvaise game ne te coule pas,
                mais l&apos;irrégularité finit par se payer.
              </p>
            </RuleSubsection>
          </RuleSection>

          <RuleSection id="contrats" title="4. Contrats">
            <RuleSubsection title="4.1 Principes généraux">
              <RuleList
                items={[
                  <>Chaque joueur est <strong className="text-foreground">lié à son équipe par un contrat</strong>, y compris le chef d&apos;équipe.</>,
                  <>Les contrats s&apos;effectuent <strong className="text-foreground">sur le site Garden</strong>.</>,
                  <>Les capitaines signent eux-mêmes via leur compte.</>,
                  <>Les joueurs n&apos;ayant pas de compte voient leur contrat accepté manuellement par un admin.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="4.2 Validation par un admin">
              <p>Un contrat ne peut être accepté par un admin uniquement après confirmation que :</p>
              <RuleList
                items={[
                  <>Le joueur a accepté lui-même.</>,
                  <>Son capitaine a confirmé en son nom.</>,
                  <>
                    En cas de <strong className="text-foreground">mensonge</strong> de l&apos;une des deux parties, des sanctions pourront
                    être appliquées.
                  </>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="4.3 Champs obligatoires d'un contrat">
              <RuleList
                items={[
                  <>
                    <strong className="text-foreground">Montant du salaire</strong> avec un minimum de 5 % de la masse salariale
                    lorsque le budget est réparti 50/50.
                  </>,
                  <>
                    <strong className="text-foreground">Durée du contrat</strong> en BO, comprise entre{' '}
                    <strong className="text-foreground">5 et 18 BO</strong> (minimum 5, maximum 18).
                  </>,
                  <>
                    <strong className="text-foreground">Clause libératoire</strong>, qui ne peut jamais
                    être inférieure à la <strong className="text-foreground">valeur marchande</strong> du
                    joueur (voir section 5).
                  </>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="4.4 Rupture et prolongation">
              <RuleList
                items={[
                  <>Un contrat ne peut pas être brisé avant la fin de sa durée en BO.</>,
                  <>Certains cas particuliers peuvent autoriser une rupture anticipée.</>,
                  <>Des sanctions peuvent éventuellement s&apos;appliquer.</>,
                  <>Ces situations sont gérées au cas par cas par le staff.</>,
                  <>Un contrat peut bien sûr être prolongé.</>,
                ]}
              />
            </RuleSubsection>
          </RuleSection>

          <RuleSection id="transferts" title="5. Transferts">
            <RuleSubsection title="5.1 Modes d'achat d'un joueur">
              <p>Une équipe peut acheter un joueur à une autre équipe de deux manières :</p>
              <RuleList
                items={[
                  <>Accord entre les deux équipes sur une somme.</>,
                  <>
                    Paiement de la <strong className="text-foreground">clause libératoire</strong> présente dans le contrat du joueur.
                    Dans ce cas, l&apos;équipe vendeuse n&apos;a plus son mot à dire.
                  </>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="5.2 Fair-play financier">
              <div className="border border-hairline bg-surface px-5 py-4 text-sm text-foreground-dim">
                🚨 Attention : règle importante pour éviter les abus entre chefs d&apos;équipes amis.
              </div>
              <RuleList
                items={[
                  <>Il existe une <strong className="text-foreground">valeur minimale</strong> pour acheter un joueur.</>,
                  <>
                    Ce minimum est désormais égal à <strong className="text-foreground">100 % de la VM</strong>{' '}
                    du joueur : on ne peut pas l&apos;acheter pour moins que sa valeur marchande.
                  </>,
                  <>
                    De la même façon, la <strong className="text-foreground">clause libératoire</strong> ne
                    peut jamais être fixée sous la VM du joueur.
                  </>,
                  <>
                    Si la VM d&apos;un joueur augmente, sa clause <strong className="text-foreground">s&apos;ajuste
                    automatiquement</strong> pour rester au moins égale à la nouvelle VM.
                  </>,
                  <>Cette valeur peut changer si le staff le décide.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="5.3 Échanges de joueurs">
              <RuleList
                items={[
                  <>Les échanges sont autorisés.</>,
                  <>Ils respectent la même règle de fair-play financier que les achats classiques.</>,
                  <>
                    Pour récupérer un joueur, la contrepartie (joueur échangé + argent éventuel) doit
                    couvrir <strong className="text-foreground">au moins 100 % de la VM</strong> du joueur visé.
                  </>,
                  <>
                    Si le joueur proposé a une VM plus faible, l&apos;équipe acheteuse doit{' '}
                    <strong className="text-foreground">compléter avec de l&apos;argent</strong> pour atteindre la VM
                    du joueur convoité.
                  </>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="5.4 Fenêtre de transfert">
              <RuleList
                items={[
                  <>Les transferts sont bloqués pendant la phase de création des équipes pour éviter toute confusion.</>,
                  <>Ils sont ouverts une fois que la valeur du fair-play financier est définitivement fixée.</>,
                ]}
              />
            </RuleSubsection>
          </RuleSection>

          <RuleSection id="matchs" title="6. Matchs & format">
            <RuleSubsection title="6.1 Deadlines">
              <RuleList
                items={[
                  <>La ligue se veut plus longue que les anciens tournois et plus clémente sur les emplois du temps.</>,
                  <>Pour éviter de s&apos;étaler sur un an, il existe une <strong className="text-foreground">deadline de BO à jouer</strong>.</>,
                  <>Cette deadline est fixée par le staff en fonction de la période et de l&apos;avis des équipes.</>,
                  <>Le non-respect d&apos;une deadline sera sanctionné.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="6.2 Format de la ligue">
              <p>
                Le format est <strong className="text-foreground">volontairement classique</strong> :
                une longue phase régulière en aller-retour, puis des playoffs qui décident du titre.
              </p>

              <p className="text-foreground font-semibold">Phase régulière</p>
              <RuleList
                items={[
                  <>La ligue réunit <strong className="text-foreground">10 équipes</strong>.</>,
                  <>
                    Chaque équipe joue au total <strong className="text-foreground">18 BO3</strong>, en{' '}
                    <strong className="text-foreground">aller-retour</strong> : on affronte chaque autre
                    équipe deux fois (une fois côté bleu, une fois côté rouge).
                  </>,
                  <>Tous les matchs de la phase régulière sont des <strong className="text-foreground">BO3</strong>.</>,
                  <>La phase régulière se joue intégralement en <strong className="text-foreground">Fearless Draft</strong> (voir 6.3).</>,
                  <>
                    Le classement se fait au <strong className="text-foreground">nombre de BO gagnés</strong>. En cas
                    d&apos;égalité, on applique les tiebreaks (voir 6.4).
                  </>,
                ]}
              />

              <p className="text-foreground font-semibold">Playoffs</p>
              <RuleList
                items={[
                  <>Les <strong className="text-foreground">6 premiers</strong> du classement sont qualifiés en playoffs.</>,
                  <>Les <strong className="text-foreground">4 derniers</strong> sont éliminés.</>,
                  <>
                    Le seeding suit le classement de la phase régulière : les{' '}
                    <strong className="text-foreground">4 premiers</strong> entrent dans le{' '}
                    <strong className="text-foreground">Winner Bracket</strong>, les{' '}
                    <strong className="text-foreground">5e et 6e</strong> démarrent dans le{' '}
                    <strong className="text-foreground">Loser Bracket</strong>.
                  </>,
                  <>Les playoffs se disputent en <strong className="text-foreground">double élimination</strong>.</>,
                  <>
                    Les séries de playoffs se jouent en <strong className="text-foreground">BO5</strong>, toujours en{' '}
                    <strong className="text-foreground">Fearless Draft</strong>.
                  </>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="6.3 Fearless Draft">
              <RuleList
                items={[
                  <>
                    En Fearless, tout champion <strong className="text-foreground">joué lors d&apos;une game précédente</strong>{' '}
                    de la même série devient <strong className="text-foreground">indisponible</strong> pour le reste de la série.
                  </>,
                  <>
                    Cette règle s&apos;applique aux <strong className="text-foreground">deux équipes</strong> : un champion « brûlé »
                    par une game ne peut plus être pick par personne jusqu&apos;à la fin du BO.
                  </>,
                  <>Les picks se réinitialisent au <strong className="text-foreground">début de chaque nouvelle série</strong>.</>,
                  <>Toutes les drafts se font sur le site Garden (voir 6.5).</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="6.4 Tiebreaks (départage au classement)">
              <p>
                En cas d&apos;égalité au classement (même nombre de BO gagnés), les équipes sont départagées dans
                l&apos;ordre suivant, calqué sur les <strong className="text-foreground">règles officielles Riot Games en
                esport</strong>. On passe au critère suivant uniquement si le précédent ne suffit pas à départager :
              </p>
              <RuleList
                items={[
                  <>
                    <strong className="text-foreground">1. Différence de maps</strong> : différence entre les games
                    gagnées et les games perdues sur l&apos;ensemble de la phase régulière.
                  </>,
                  <>
                    <strong className="text-foreground">2. Confrontation directe</strong> : résultat des BO joués
                    directement entre les équipes à égalité.
                  </>,
                  <>
                    <strong className="text-foreground">3. Temps de jeu</strong> : on compare le temps moyen mis pour
                    remporter ses games — l&apos;équipe qui gagne le plus vite passe devant.
                  </>,
                  <>
                    <strong className="text-foreground">4. BO de départage</strong> : si rien n&apos;a séparé les équipes,
                    un <strong className="text-foreground">BO décisif</strong> est joué pour trancher.
                  </>,
                ]}
              />
              <p className="text-sm text-foreground-muted">
                Pour une égalité impliquant plus de deux équipes, les mêmes critères s&apos;appliquent successivement
                jusqu&apos;à séparer tout le monde ; le staff arbitre tout cas particulier.
              </p>
            </RuleSubsection>

            <RuleSubsection title="6.5 Absences et remplacements">
              <RuleList
                items={[
                  <>
                    Une équipe présentant un ou plusieurs joueurs absents au moment du début de la rencontre dispose d&apos;un{' '}
                    <strong className="text-foreground">délai de 15 minutes</strong> pour présenter un remplaçant officiel valide ou
                    demander un report d&apos;urgence.
                  </>,
                  <>Le temps de draft n&apos;est pas inclus dans ce délai.</>,
                  <>Si l&apos;équipe ne trouve toujours pas de joueur, elle doit utiliser son joker de non-présence.</>,
                  <>Un joker est attribué à chaque équipe à chaque deadline.</>,
                  <>Les jokers ne sont pas cumulables.</>,
                  <>
                    En cas de non-présence sans joker disponible, la décision finale revient au staff, qui peut prononcer un
                    report ou un forfait selon la situation.
                  </>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="6.6 Draft">
              <RuleList
                items={[
                  <>Toutes les drafts sans exception doivent se faire sur le site Garden.</>,
                ]}
              />
            </RuleSubsection>
          </RuleSection>

          <RuleSection id="paris" title="7. Paris">
            <div className="border border-hairline bg-surface px-5 py-4 text-sm text-foreground-dim">
              🎰 Pour parier, il faut <strong className="text-foreground">obligatoirement un compte sur le site
              Garden</strong>. Toutes les valeurs et limites de cette section peuvent être ajustées par le staff.
            </div>

            <RuleSubsection title="7.1 Principe">
              <RuleList
                items={[
                  <>
                    Chaque membre dispose d&apos;un <strong className="text-foreground">solde de paris en monnaie
                    virtuelle</strong> pour miser sur les résultats des matchs de la ligue.
                  </>,
                  <>
                    Les <strong className="text-foreground">cotes d&apos;ouverture</strong> sont établies à partir des votes
                    de la communauté : elles représentent la <strong className="text-foreground">chance estimée de chaque
                    équipe de finir 1re de la ligue</strong>.
                  </>,
                  <>
                    Une cote d&apos;ouverture n&apos;est qu&apos;un point de départ : elle est{' '}
                    <strong className="text-foreground">recalculée en fonction des résultats</strong> tout au long de la saison.
                  </>,
                  <>La monnaie de paris est <strong className="text-foreground">virtuelle</strong> et n&apos;a aucune valeur réelle.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="7.2 Règles de pari">
              <RuleList
                items={[
                  <>
                    <strong className="text-foreground">Interdiction de parier sur sa propre équipe</strong> : un joueur ne
                    peut miser ni sur, ni contre un match impliquant son équipe (conflit d&apos;intérêt).
                  </>,
                  <>
                    Un pari est <strong className="text-foreground">verrouillé au coup d&apos;envoi du match</strong> : plus
                    aucune mise ni modification n&apos;est possible une fois la première game lancée.
                  </>,
                  <>
                    La <strong className="text-foreground">cote appliquée est celle affichée au moment où le pari est
                    validé</strong>, même si elle évolue ensuite.
                  </>,
                  <>La mise est <strong className="text-foreground">débitée immédiatement</strong> ; les gains sont crédités à la clôture du match.</>,
                  <>
                    Une <strong className="text-foreground">mise minimum et une mise maximum</strong> peuvent être fixées par
                    le staff pour éviter les abus.
                  </>,
                  <>Il est impossible de parier une somme supérieure à son solde disponible.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="7.3 Annulations et remboursements">
              <RuleList
                items={[
                  <>
                    En cas de <strong className="text-foreground">match reporté, annulé ou forfait</strong>, les mises
                    concernées sont <strong className="text-foreground">remboursées</strong>.
                  </>,
                  <>Un pari sur une game rejouée (remake) suit le sort du match tel que tranché par le staff.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="7.4 Intégrité">
              <RuleList
                items={[
                  <>
                    Tout <strong className="text-foreground">arrangement de résultat</strong> (match truqué, entente entre
                    équipes ou joueurs pour influencer un pari) est <strong className="text-foreground">strictement
                    interdit</strong> et entraîne de lourdes sanctions.
                  </>,
                  <>Le staff se réserve le droit d&apos;annuler tout pari suspect et de sanctionner les personnes impliquées.</>,
                ]}
              />
            </RuleSubsection>
          </RuleSection>

          <RuleSection id="comportement" title="8. Comportement">
            <RuleSubsection title="7.1 Recommandations">
              <RuleList
                items={[
                  <>Il est conseillé à tous les joueurs de ne pas utiliser le <strong className="text-foreground">/all</strong> durant les games pour éviter tout souci.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="7.2 Évaluation">
              <RuleList
                items={[
                  <>Chaque comportement peut être apprécié différemment selon les équipes et les joueurs.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="7.3 Sanctions">
              <p>Sont strictement sanctionnés :</p>
              <RuleList
                items={[
                  <>Toute forme de flame.</>,
                  <>Le racisme.</>,
                  <>L&apos;homophobie.</>,
                  <>La misogynie.</>,
                  <>Toute autre forme de comportement discriminatoire ou toxique.</>,
                ]}
              />
            </RuleSubsection>
          </RuleSection>

          <RuleSection id="remplacants" title="9. Remplaçants">
            <RuleSubsection title="8.1 Prérequis de recrutement">
              <RuleList
                items={[
                  <>
                    Il est <strong className="text-foreground">impossible de signer un remplaçant</strong>{' '}
                    tant que l&apos;équipe n&apos;a pas déjà un{' '}
                    <strong className="text-foreground">roster de 5 joueurs sous contrat</strong> pour les
                    prochaines games.
                  </>,
                  <>Autrement dit : on complète d&apos;abord son cinq titulaire, ensuite seulement on recrute un sub.</>,
                ]}
              />
            </RuleSubsection>

            <RuleSubsection title="8.2 Cost du remplaçant">
              <RuleList
                items={[
                  <>Le remplaçant n&apos;ouvre droit à <strong className="text-foreground">aucun cost supplémentaire</strong>.</>,
                  <>
                    Quand il entre en jeu, la composition alignée (les 5 joueurs sur le terrain) doit
                    toujours respecter le <strong className="text-foreground">plafond de 15 cost</strong>.
                  </>,
                  <>
                    Concrètement, pour faire jouer le sub, il faut <strong className="text-foreground">sortir un
                    titulaire</strong> dont le cost permet de rester sous les 15.
                  </>,
                  <>
                    Pour aligner une composition qui dépasse 15 cost, il faut passer par un{' '}
                    <strong className="text-foreground">achat</strong> : soit payer la VM du remplaçant, soit
                    acheter un joueur sur un autre poste via un transfert classique. Un joueur acheté de
                    cette manière <strong className="text-foreground">n&apos;est plus soumis au plafond des 15</strong>.
                  </>,
                ]}
              />
            </RuleSubsection>
          </RuleSection>

          <RuleSection id="rappels" title="10. Rappels et points en attente">
            <RuleSubsection title="À venir">
              <RuleList
                items={[
                  <>Règles précises sur les remakes.</>,
                  <>Et tout autre point non encore couvert dans ce document.</>,
                ]}
              />
            </RuleSubsection>

            <p className="border-t border-hairline pt-6 text-sm text-foreground-muted">
              Document évolutif : toute mise à jour sera communiquée officiellement par le staff
              Garden.
            </p>
          </RuleSection>
        </article>
      </div>
    </div>
  );
}
