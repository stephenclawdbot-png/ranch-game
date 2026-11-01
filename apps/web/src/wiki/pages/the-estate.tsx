import * as gc from "@thoroughbred/game-core";
import { NOTIFICATION_CATEGORIES, PUSH_DAILY_CAP, QUIET_FROM_HOUR, QUIET_UNTIL_HOUR, RULES } from "@thoroughbred/db";
import { Callout, Figure, GameLink, H2, Icon, Lead, List, P, Table, WikiLink, count } from "../kit";

export default function TheEstatePage() {
  return (
    <>
      <Lead>
        The game has five areas: <b>Estate</b>, <b>Stable</b>, <b>Racing</b>, <b>Club</b> and <b>Sales</b>. On a phone they sit in the tab bar at the bottom; on a larger screen they
        are tabs along the top. Each area has a short row of sub-pages under the top bar.
      </Lead>
      <Table
        head={["Area", "Sub-pages", "What it is for"]}
        rows={[
          [
            <GameLink key="e" href="/">
              Estate
            </GameLink>,
            "–",
            "Your home screen: what to do next, today's goals, your races and your horses.",
          ],
          [
            <GameLink key="s" href="/stable">
              Stable
            </GameLink>,
            "Horses · Nursery · Breeding · Facilities",
            "Looking after, training and breeding your horses, and upgrading the yard.",
          ],
          [
            <GameLink key="r" href="/races">
              Racing
            </GameLink>,
            "This week · Race card · Story",
            "The week's road to the Weekend Feature, the Live card everyone shares, and the Story races against the Club.",
          ],
          [
            <GameLink key="c" href="/league">
              Club
            </GameLink>,
            "League · Daily Cup · Hall of Fame",
            "Competition and glory: the League, the daily Cup run and the legends.",
          ],
          [
            <GameLink key="m" href="/market">
              Sales
            </GameLink>,
            "Horses for sale · Packs",
            "The auction house and Paddock Packs of foals.",
          ],
        ]}
      />

      <H2 id="estate">Estate</H2>
      <Figure src="/art/scenes/wiki-estate-map.png" alt="A painted map of the estate pinned up in the yard" caption="The Estate: tap a building to go straight there." focus={0.5} />
      <P>
        The Estate is a picture of your yard with labelled buildings: the <b>Racecourse</b>, <b>The Barn</b>, the <b>Trophy Room</b>, the <b>Breeding Barn</b>, the <b>Gallops</b>{" "}
        and the <b>Sales Ring</b>. Below it the game suggests your next step: your horse in an upcoming race, a result waiting to be watched, or a Quick Pick that sends your best-suited
        fresh horse to a race in one tap.
      </P>
      <List
        items={[
          <>
            <b>While you were away</b>: back after {Math.round(gc.WELCOME_BACK_AFTER_MS / gc.MS_PER_HOUR)} hours or more, the Estate opens with up to {gc.AWAY_MAX_LINES} lines on
            what happened since your last visit, most important first, each one a tap away: results waiting (&ldquo;Your Live race has run: watch the finish&rdquo;, never the
            placing), your Live races later today in your local time, the credits that came in or went out (&ldquo;+640 credits while you were away (prizes 2, refunds 1)&rdquo;,
            a tap opens Finances; a prize from a race you haven&rsquo;t watched waits until you have), foals born or ready to foal, horses over an injury or fresh again, rating changes after races you&rsquo;ve
            watched, new training weeks and a rival&rsquo;s big win. Then one big button for the best next thing. Right after you sign in on a device it says{" "}
            <b>Welcome back</b> with your stable&rsquo;s name.
          </>,
          <>
            <b>Your first week</b>: for a new stable, one list of jobs to try, today&rsquo;s goals included, each one tap away. It goes once everything is done or the week is over.
            See <WikiLink slug="quick-start" />.
          </>,
          <>
            <b>Road to Saturday</b>: a tile that opens <GameLink href="/week">This week</GameLink>, with this week&rsquo;s Feature, your Qualifiers and your League line. It appears
            after your first Live entry, and so do your rivals.
          </>,
          <>
            <b>Today</b>: things ready for you, such as horses to groom, a free Paddock Pack, a mare ready to foal or the Daily Cup. During your first week it is called{" "}
            <b>Also today</b> and only shows what isn&rsquo;t on your list.
          </>,
          <>
            <b>Today&rsquo;s goals</b>: run a race, care for a horse and run the Daily Cup, each worth {gc.DAILY_GOAL_CREDITS} credits. See <WikiLink slug="credits-and-entries" />.
          </>,
          <>
            <b>Your races</b> and <b>Your horses</b>: entered and finished runs, and each horse&rsquo;s condition at a glance.
          </>,
          <>
            <b>Saturday Feature</b>: from Thursday, a card for the week&rsquo;s big race (the Weekend Feature, Saturday at 19:00 UTC, shown in your own
            time too): who has qualified and entered so far, and how to get in: a top {gc.FEATURE_QUALIFY_TOP} in a weekday Feature Qualifier or a rating of {gc.FEATURE_RATING_BY_RIGHT}+.
            The Feature&rsquo;s race page carries a banner; the race and its rules are the same as ever.
          </>,
          <>
            <b>This week</b>: the top ten stables by this week&rsquo;s League points (five on a phone) and your own place, with arrows for how far each moved since 00:00 UTC.
            Only stables with a Live run this week are on it; your own row always shows, with a dash for the place until your first Live run is in.
            Equal points share a place (&ldquo;=2&rdquo;). A race you haven&rsquo;t watched yet is left out of the table you see, so it never gives a result away. The full table is at
            the foot of the <GameLink href="/league#this-week">League</GameLink> page. See <WikiLink slug="league" />.
          </>,
          <>
            <b>Tomorrow at your yard</b>: at the foot of the Estate, and under a result, what will be new tomorrow, taken only from your stable as it is: the Club&rsquo;s gift foal
            (it arrives on your stable&rsquo;s second day, UTC), Live races that will have run, horses fresh again or over an injury, a Feature Qualifier or the Saturday Feature, the
            next Daily Cup, your next Story race and new Live entries at midnight. Nothing in it is a countdown: it will all still be there whenever you come back.
          </>,
        ]}
      />

      <H2 id="stable">Stable</H2>
      <Figure src="/art/scenes/wiki-stable-row.png" alt="A row of stable doors, a horse looking out of each" caption="The Stable: every horse in its stall." focus={0.55} />
      <List
        items={[
          <>
            <GameLink href="/stable">Horses</GameLink>: your string. Open a horse for its own page with four tabs: <b>Overview</b>, <b>Care</b>, <b>Training</b> and <b>Career</b>.
          </>,
          <>
            <GameLink href="/nursery">Nursery</GameLink>: foals, weanlings and yearlings growing up through daily care, and youngsters ready to welcome to the yard. See{" "}
            <WikiLink slug="growing-up" />.
          </>,
          <>
            <GameLink href="/breeding">Breeding</GameLink>: pair a mare with a stallion and read the preview first. See <WikiLink slug="breeding-basics" />.
          </>,
          <>
            <GameLink href="/facilities">Facilities</GameLink>: stalls, the entry office, the trainer, the vet and a stable hand. See <WikiLink slug="facilities" />.
          </>,
        ]}
      />

      <H2 id="racing">Racing</H2>
      <Figure src="/art/scenes/wiki-turnstiles.png" alt="Racegoers streaming through the turnstiles on race day" caption="Racing: the Live card at Kestrel Downs." focus={0.5} />
      <List
        items={[
          <>
            <GameLink href="/week">This week</GameLink>: the road to Saturday. The Weekend Feature&rsquo;s trip and surface (known from Monday, with the likely going), the weekday Feature Qualifiers
            with your runners&rsquo; places, and each of your horses: in for Saturday (a top 3 in a Qualifier or a rating of 100+), heading for the Saturday Plate, or not yet, with how well
            it suits Saturday and whether it has already raced today. It also shows your League gap to promotion, one suggested next step, and the ground and weather at every course with a few days&rsquo; outlook.
          </>,
          <>
            <GameLink href="/races">Race card</GameLink>: the Live card all stables share, {gc.MEETINGS_PER_DAY} race meetings a day of {gc.RACES_PER_MEETING} races, published{" "}
            {Math.round(RULES.cardHorizonMs / gc.MS_PER_HOUR)} hours ahead, with how many stables have entered each race. Entries close {Math.round(gc.ENTRY_CLOSE_BEFORE_MS / 1000)} seconds before the off. Live races use stable entries,
            and each horse can run {count(gc.MAX_LIVE_STARTS_PER_DAY, "Live race")} a day.
          </>,
          <>
            <GameLink href="/story">Story</GameLink>: {gc.STORY_CHAPTER_DEFS.length} chapters of races against the Club&rsquo;s rival stables (
            {gc.STORY_CHAPTER_DEFS.map((c) => c.title).join(", ")}). They are free to enter, and winning them earns the licences that open better Live classes.
          </>,
        ]}
      />
      <P>
        More in <WikiLink slug="race-types" /> and <WikiLink slug="entering-a-race" />.
      </P>

      <H2 id="club">Club</H2>
      <Figure src="/art/scenes/wiki-pavilion.png" alt="The Club pavilion with its clock and veranda" caption="The Club: the League, the Daily Cup and the Hall of Fame." focus={0.5} />
      <List
        items={[
          <>
            <GameLink href="/league">League</GameLink>: owners ranked on points from their racing, with promotion, and relegation from the {gc.RELEGATION_FROM_TIER.charAt(0).toUpperCase() + gc.RELEGATION_FROM_TIER.slice(1)}{" "}
            League up. See <WikiLink slug="league" />.
          </>,
          <>
            <GameLink href="/cup">Daily Cup</GameLink>: one run a day for every stable. See <WikiLink slug="daily-cup" />.
          </>,
          <>
            <GameLink href="/hall">Hall of Fame</GameLink>: the game&rsquo;s legends. Your own silverware is in the <GameLink href="/trophies">Trophy Room</GameLink> on the Estate. See{" "}
            <WikiLink slug="hall-and-trophies" />.
          </>,
        ]}
      />

      <H2 id="sales">Sales</H2>
      <Figure src="/art/scenes/wiki-sales-paddock.png" alt="Lots walked round the sales paddock, buyers taking notes" caption="Sales: the auction house and Paddock Packs." focus={0.5} />
      <List
        items={[
          <>
            <GameLink href="/market">Horses for sale</GameLink>: buy and sell horses for credits. See <WikiLink slug="the-market" />.
          </>,
          <>
            <GameLink href="/packs">Packs</GameLink>: Paddock Packs of foals with published odds. See <WikiLink slug="packs" />.
          </>,
        ]}
      />

      <H2 id="top-bar">The top bar</H2>
      <List
        items={[
          <>
            <Icon name="flag" size={16} /> <b>Entries</b>: your stable entries for Live races. Its tooltip shows how big your bank is and how many arrive at local midnight.
          </>,
          <>
            <Icon name="coin" size={16} /> <b>Credits</b>: your Stable Credits.
          </>,
          <>
            <Icon name="bell" size={16} /> <b>Notifications</b>: the bell, with a count of what&rsquo;s new. See <a href="#notifications" className="link">Notifications</a> below.
          </>,
          <>
            <b>Your silks</b>: your profile and settings. Not signed in? The top bar shows <b>Sign in</b> and <b>Connect wallet</b> instead. Sign in brings you back to the page you
            were on (see <GameLink href="/wiki/quick-start#signing-in">Signing in on another device</GameLink>).
          </>,
          <>
            <Icon name="papers" size={16} /> <b>Wiki</b>: this guide, from any screen.
          </>,
        ]}
      />
      <H2 id="notifications">Notifications</H2>
      <P>
        Everything that happens to your stable while you&rsquo;re away lands in your inbox, and the <b>bell</b> in the top bar shows how much of it is new (up to &ldquo;9+&rdquo;). Open
        it for the latest notes, grouped by day, each one a tap away from its race, horse or page: a result waiting to be watched, an injury and the day the horse is{" "}
        <b>back in the race</b>, a <b>new training week</b> for horses you train hard, <b>new races that suit your horses</b> when a meeting is published, a <b>listing that
        expired</b> unsold, sales, stud fees, jockey news, the weekly upkeep and the League recap. Nothing spoils a race: a result you haven&rsquo;t watched shows only its race
        name, and news from that race waits until you&rsquo;ve seen it. <b>Mark all read</b> clears the count without marking any result as watched.
      </P>
      <P>
        In your <GameLink href="/me">profile</GameLink>, <b>Notifications</b> has a switch for each kind (
        {NOTIFICATION_CATEGORIES.map((c) => c.label.replace(/&/g, "and").toLowerCase()).join(", ")}), all on to begin with. A kind switched off leaves the bell and its count, but the full list under{" "}
        <GameLink href="/me/notifications">All notifications</GameLink> still keeps everything, so nothing is ever lost.
      </P>

      <H2 id="phone-alerts">Phone alerts</H2>
      <P>
        If you like, your phone or computer can ping you for the few things worth coming back for: your <b>Live race goes to post</b> (and 10 minutes before, or when it is <b>moved earlier</b> because the field filled up), your{" "}
        <b>result is ready to watch</b> (it never says how your horse did), a <b>mare is ready to foal</b>, a <b>horse is back from injury</b> and the Club&rsquo;s <b>gift foal</b>.
        Everything else stays in the bell. Alerts stay quiet from {String(QUIET_FROM_HOUR).padStart(2, "0")}:00 to {String(QUIET_UNTIL_HOUR).padStart(2, "0")}:00 your time (unless a race
        you entered runs then), there are {PUSH_DAILY_CAP} a day at most, and a newer alert about the same race replaces the older one.
      </P>
      <List
        items={[
          <>
            <b>Turn them on</b>: after you enter your first Live race the game asks once (&ldquo;Want a ping on your phone when it&rsquo;s off?&rdquo;), or tap <b>Turn on phone
            alerts</b> under Notifications in your <GameLink href="/me">profile</GameLink>. Your browser asks for permission.
          </>,
          <>
            <b>Choose and turn off</b>: once they&rsquo;re on, each kind has a <b>Push to this device</b> switch in the same place, and <b>Turn off phone alerts on this device</b>{" "}
            stops them. A kind switched off for the bell sends no alerts either.
          </>,
          <>
            <b>iPhone and iPad</b>: alerts only reach Post Time added to your Home Screen. In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>, open Post Time from there and
            turn alerts on in your profile.
          </>,
        ]}
      />

      <H2 id="profile">Profile and settings</H2>
      <P>
        Your <GameLink href="/me">profile</GameLink> is where your stable&rsquo;s name and colours live, and where you set a <b>stable photo</b>: upload a PNG, JPEG or WebP up
        to {Math.floor(gc.STABLE_PHOTO_MAX_UPLOAD_BYTES / (1024 * 1024))} MB and it shows next to your stable name wherever your silks show. It&rsquo;s cropped to a square, and you can
        change it {count(gc.STABLE_PHOTO_UPLOADS_PER_DAY, "time")} a day; remove it and the silks come back.
      </P>
      <P>
        Your profile is also where you take your stable to another device: a device code for a new browser, a wallet to link for sign-in and, during the testing round, your
        permanent <b>login code</b> (your invite link brings you back too). See <GameLink href="/wiki/quick-start#signing-in">Signing in on another device</GameLink>.
      </P>

      <Callout tone="tip">
        <p>
          New here? Start with the <WikiLink slug="quick-start" />. The Estate always shows the next sensible thing to do, so it is a good place to come back to.
        </p>
      </Callout>
    </>
  );
}
