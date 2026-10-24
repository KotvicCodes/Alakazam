// wrapped in an IIFE so content scripts do not share top-level declarations
;(function () {
    //! Canonical Effect Identities
    // Cookie Clicker 2.058 (ozh/cookieclicker c77f00c), main.js buff types and
    // loc/FR.js. Buff instance ids are not type ids, and icons are ambiguous
    // (loans/interest, luck/misery). Map exact localized headings to stable keys;
    // never classify effects from descriptive prose or partial name matches.
    // Columns: canonical name, French heading, multiplies production, protect.
    const EFFECTS = [
        ['Frenzy', 'Frénésie', true, true],
        ['Elder frenzy', 'Frénésie des anciennes', true, true],
        ['Dragon Harvest', 'Récolte de dragon', true, true],
        ['Sugar frenzy', 'Frénésie sucrière', true, true],
        ['Click frenzy', 'Frénésie de clics', false, true],
        ['Dragonflight', 'Vol de dragon', false, true],
        ['Cursed finger', 'Doigt maudit', false, true],
        ['Devastation', 'Dévastation', false, true],
        ['Cookie storm', 'Tempête de cookies', false, true],
        ['Everything must go', 'Tout doit disparaître', false, true],
        ["Haggler's luck", 'Chance du marchandeur', false, true],
        ['Crafty pixies', 'Lutins rusés', false, true],
        ['Magic adept', 'Adepte magique', false, true],
        ['Clot', 'Caillot', false, false],
        ["Haggler's misery", 'Misère du marchandeur', false, false],
        ['Nasty goblins', 'Vilains gobelins', false, false],
        ['Magic inept', 'Inepte magique', false, false],
        ['Sugar blessing', 'Bénédiction sucrée', false, false],
        ['Gifted out', 'À court de cadeaux', false, false],
        ['Loan 1', 'Prêt 1', true, false],
        ['Loan 1 (interest)', 'Prêt 1 (intérêts)', false, false],
        ['Loan 2', 'Prêt 2', true, false],
        ['Loan 2 (interest)', 'Prêt 2 (intérêts)', false, false],
        ['Loan 3', 'Prêt 3', true, false],
        ['Loan 3 (interest)', 'Prêt 3 (intérêts)', false, false]
    ]

    // building specials use translated building names inside a localized heading.
    // Deduplication is the You special (the old list incorrectly said Deliciousness).
    const BUILDINGS = [
        ['High-five', 'Slap to the face', 'Curseur'],
        ['Congregation', 'Senility', 'Grand-mère'],
        ['Luxuriant harvest', 'Locusts', 'Ferme'],
        ['Ore vein', 'Cave-in', 'Mine'],
        ['Oiled-up', 'Jammed machinery', 'Usine'],
        ['Juicy profits', 'Recession', 'Banque'],
        ['Fervent adoration', 'Crisis of faith', 'Temple'],
        ['Manabloom', 'Magivores', 'Tour de mage'],
        ['Delicious lifeforms', 'Black holes', 'Cargaison'],
        ['Breakthrough', 'Lab disaster', "Labo d'alchimie"],
        ['Righteous cataclysm', 'Dimensional calamity', 'Portail'],
        ['Golden ages', 'Time jam', 'Machine à voyager dans le temps'],
        ['Extra cycles', 'Predictable tragedy', "Condenseur d'antimatière"],
        ['Solar flare', 'Eclipse', 'Prisme'],
        ['Winning streak', 'Dry spell', 'Porte-bonheur'],
        ['Macrocosm', 'Microcosm', 'Moteur fractal'],
        ['Refactoring', 'Antipattern', 'Console javascript'],
        ['Cosmic nursery', 'Big crunch', 'Veillevers'],
        ['Brainstorm', 'Brain freeze', 'Cortex pâtissier'],
        ['Deduplication', 'Clone strike', 'Toi']
    ]

    const normalize = name => (name || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const aliases = new Map()
    function add(name, translated, production, protect) {
        const effect = { key: normalize(name), name, production, protect }
        aliases.set(normalize(name), effect)
        aliases.set(normalize(translated), effect)
    }
    for (const entry of EFFECTS) add(...entry)
    for (const [good, bad, building] of BUILDINGS) {
        add(good, 'Pouvoir de ' + building + ' !', true, true)
        add(bad, 'Fardeau de ' + building + ' !', false, false)
    }

    // Sugar blessing lasts 24h and affects golden-cookie frequency; it is not an
    // active income multiplier. Loans have their own ascension harvest window.
    function identify(name) {
        return aliases.get(normalize(name)) || null
    }

    window.Alakazam.data = window.Alakazam.data || {}
    window.Alakazam.data.effects = { identify }
})()
