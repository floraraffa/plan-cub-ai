// CoachStrings — every line the coach says, in English / Spanish / French.
// This is the frozen script: when recording voice clips, record exactly these.
// Templates use {placeholders} filled by CubeTutor.

export type Lang = "en" | "es" | "fr"

// Order of the per-language audio-clip arrays in CubeTutor's Inspector.
// Record ONE clip per key per language, and assign them in EXACTLY this order.
export const CLIP_KEYS: string[] = [
  "greet", "scrambleGo", "teachIntro", "alreadySolved", "lessonDone",
  "backSolved", "nudge", "resultShort",
  "goal0", "goal1", "goal2", "goal3", "goal4",
  "hintA0", "hintA1", "hintA2", "hintA3", "hintA4",
  "hintB0", "hintB1", "hintB2", "hintB3", "hintB4",
  "why0", "why1", "why2", "why3", "why4",
  "wrongMove",
  "dailyGo", "dailyDone", "dailyAlready"
]

// Resolves any CLIP_KEY (including goalN/hintAN/hintBN/whyN) to its text.
export function getLine(lang: Lang, key: string): string {
  const S = STRINGS[lang]
  if (key.indexOf("goal") === 0) return S.goals[parseInt(key.substring(4))]
  if (key.indexOf("hintA") === 0) return S.hints[parseInt(key.substring(5))][0]
  if (key.indexOf("hintB") === 0) return S.hints[parseInt(key.substring(5))][1]
  if (key.indexOf("why") === 0) return S.whys[parseInt(key.substring(3))]
  return S[key]
}

export const STRINGS: {[lang: string]: {[key: string]: any}} = {
  en: {
    greet: "Hi! I am your cube coach. Tap **Learn** and I will teach you, **Mix and Play** to play, or try the **Daily Challenge**.",
    scrambleGo: "Shuffling! Solve it — the clock starts now.",
    teachIntro: "Watch closely! I will shuffle the cube, and then we fix it together, step by step.",
    alreadySolved: "Your cube is already solved! Tap 'Mix and Play' and we start for real.",
    lessonDone: "You solved it! You did the thinking — the cube just followed. Tap 'Mix and Play' to go again.",
    backSolved: "Back to a solved cube.",
    teachFirst: "Say 'teach me' first, and I will guide you step by step.",
    nudge: "Watch: I'll bring a glowing piece to the front and show a turn. I'll put it back — now you try.",
    result: "Solved in {time} with {moves} moves!",
    newBest: " **New personal best!**",
    best: " Personal best: {best}.",
    scrambleBtn: "Mix & Play",
    teachBtn: "Learn",
    movesWord: "moves",
    resultShort: "Solved! Well done!",
    wrongMove: "That path was breaking your progress — I brought it back. Try another way, or ask for a hint.",
    stageNames: ["White cross", "White corners", "Middle layer", "Yellow cross", "Final layer"],
    dailyBtn: "Daily",
    dailyGo: "Today's challenge! Everyone in the world gets this same mix today — solve it and keep your streak alive.",
    dailyDone: "Daily challenge complete in {time}! **Streak: {streak} days.**",
    dailyAlready: "Today's challenge is already done — streak: {streak} days. Come back tomorrow!",
    statsTail: " Total solves: {n}.",
    rowTop: "the top row", rowMid: "the middle row", rowBottom: "the bottom row",
    colLeft: "the left column", colMid: "the middle column", colRight: "the right column",
    dirLeft: "to the left", dirRight: "to the right", dirUp: "upward", dirDown: "downward",
    moveHint: "Try this: swipe {row} {dir} — follow the arrow.",
    guidedMove: "Watch me — I'll swipe {row} {dir}: the piece travels toward its home without breaking your work. Now you continue!",
    goals: [
      "First goal: **the white cross**. Put the four white edge pieces around the white center, so each edge also matches the side center color.",
      "White cross done, great thinking! Next: **the white corners**. Place the four white corner pieces to complete the whole white face and its first ring.",
      "First layer complete! Now **the middle layer**: place the four edge pieces that have no white and no yellow.",
      "Two layers! Now make **a yellow cross** on the top face. Only the yellow stickers need to face up for now.",
      "Yellow cross! Last part: **finish the cube**. Move the last pieces to their places, keeping what you built."
    ],
    hints: [
      ["Find an edge piece with white on it. Where does it need to go? Look at its OTHER color.",
       "An edge belongs between the white center and the center of its other color. Move it there without breaking the edges you already placed."],
      ["A corner has three colors. It belongs where those three face centers meet.",
       "Put the corner under its spot, then turn it up into place. If it is stuck in a wrong slot, take it out first."],
      ["Turn the cube so white is at the bottom. Look at the top layer for an edge without yellow.",
       "Match the edge's front color with its center, then move it left or right into the middle layer."],
      ["Look at the yellow pattern on top: a dot, an L-shape, or a line. Each one is one step from the next.",
       "Repeat the same short sequence and watch how the pattern changes. What does it do each time?"],
      ["First make the corners be in the right POSITION, even if twisted. Then orient them one by one.",
       "Notice how a repeated sequence cycles three pieces. Cycles are the secret of the whole cube."]
    ],
    whys: [
      "Why a cross first? Edge pieces have only two colors, so they are the easiest to reason about. Good solvers always build from simple pieces to harder ones.",
      "Why corners now? A corner touches three faces, so it needs reference points. The cross you built gives every corner a fixed home to match.",
      "Why does this work? Every move breaks something and rebuilds it within the same turns. We move middle edges in without ever disturbing the finished white layer for long.",
      "Why orientation first? Making yellow face up is a separate, simpler problem than placing pieces exactly. Splitting a hard problem into two easy ones is the whole secret.",
      "Why do repeats finish the cube? Repeated sequences move a few pieces in a cycle and return everything else untouched. Cycles let you fix the end without breaking the rest."
    ]
  },
  es: {
    greet: "¡Hola! Soy tu coach del cubo. Tocá **Aprender** y te enseño, **Mezclar y Jugar** para jugar, o probá el **Reto del Día**.",
    scrambleGo: "¡Mezclando! Resolvelo — el reloj arranca ahora.",
    teachIntro: "¡Mirá bien! Voy a mezclar el cubo, y después lo arreglamos juntos, paso a paso.",
    alreadySolved: "¡Tu cubo ya está resuelto! Tocá 'Mezclar y Jugar' y empezamos en serio.",
    lessonDone: "¡Lo resolviste! Vos hiciste el razonamiento — el cubo solo obedeció. Tocá 'Mezclar y Jugar' para ir de nuevo.",
    backSolved: "Cubo resuelto de nuevo.",
    teachFirst: "Decí 'enseñame' primero, y te guío paso a paso.",
    nudge: "Mirá: traigo una pieza brillante al frente y muestro un giro. Lo deshago — ahora probá vos.",
    result: "¡Resuelto en {time} con {moves} movimientos!",
    newBest: " **¡Nuevo récord personal!**",
    best: " Récord personal: {best}.",
    scrambleBtn: "Mezclar y Jugar",
    teachBtn: "Aprender",
    movesWord: "mov.",
    resultShort: "¡Resuelto! ¡Muy bien!",
    wrongMove: "Ese camino rompía tu avance — lo volví atrás. Probá otro camino, o pedime una pista.",
    stageNames: ["Cruz blanca", "Esquinas blancas", "Capa del medio", "Cruz amarilla", "Capa final"],
    dailyBtn: "Reto del día",
    dailyGo: "¡El reto del día! Todo el mundo recibe esta misma mezcla hoy — resolvelo y mantené viva tu racha.",
    dailyDone: "¡Reto del día completado en {time}! **Racha: {streak} días.**",
    dailyAlready: "El reto de hoy ya está hecho — racha: {streak} días. ¡Volvé mañana!",
    statsTail: " Cubos resueltos: {n}.",
    rowTop: "la fila de arriba", rowMid: "la fila del medio", rowBottom: "la fila de abajo",
    colLeft: "la columna izquierda", colMid: "la columna del medio", colRight: "la columna derecha",
    dirLeft: "hacia la izquierda", dirRight: "hacia la derecha", dirUp: "hacia arriba", dirDown: "hacia abajo",
    moveHint: "Probá esto: deslizá {row} {dir} — seguí la flecha.",
    guidedMove: "Mirá cómo lo hago — deslizo {row} {dir}: la pieza viaja hacia su lugar sin romper lo que armaste. ¡Ahora seguí vos!",
    goals: [
      "Primer objetivo: **la cruz blanca**. Poné las cuatro aristas blancas alrededor del centro blanco, y que cada una coincida con el color del centro lateral.",
      "¡Cruz blanca lista, gran razonamiento! Ahora **las esquinas blancas**: colocá las cuatro para completar toda la cara blanca y su primer anillo.",
      "¡Primera capa completa! Ahora **la capa del medio**: colocá las cuatro aristas que no tienen ni blanco ni amarillo.",
      "¡Dos capas! Ahora armá **una cruz amarilla** arriba. Por ahora solo importa que lo amarillo mire hacia arriba.",
      "¡Cruz amarilla! Última parte: **terminá el cubo**. Llevá las últimas piezas a su lugar, cuidando lo que ya construiste."
    ],
    hints: [
      ["Buscá una arista con blanco. ¿A dónde tiene que ir? Mirá su OTRO color.",
       "Una arista va entre el centro blanco y el centro de su otro color. Llevala ahí sin romper las que ya pusiste."],
      ["Una esquina tiene tres colores. Va donde esos tres centros se encuentran.",
       "Poné la esquina debajo de su lugar y girala hacia arriba. Si está trabada en un lugar equivocado, primero sacala."],
      ["Girá el cubo con el blanco abajo. Buscá en la capa de arriba una arista sin amarillo.",
       "Hacé coincidir el color del frente de la arista con su centro, y metela a izquierda o derecha en la capa del medio."],
      ["Mirá el patrón amarillo de arriba: un punto, una L, o una línea. Cada uno está a un paso del siguiente.",
       "Repetí la misma secuencia corta y observá cómo cambia el patrón. ¿Qué hace cada vez?"],
      ["Primero llevá las esquinas a su POSICIÓN correcta, aunque estén giradas. Después orientalas una por una.",
       "Fijate cómo una secuencia repetida hace ciclar tres piezas. Los ciclos son el secreto de todo el cubo."]
    ],
    whys: [
      "¿Por qué la cruz primero? Las aristas tienen solo dos colores: son lo más fácil de razonar. Siempre se construye de lo simple a lo difícil.",
      "¿Por qué las esquinas ahora? Una esquina toca tres caras y necesita referencias. La cruz que armaste le da a cada esquina un lugar fijo.",
      "¿Por qué funciona esto? Cada movimiento rompe algo y lo reconstruye en los mismos giros. Metemos las aristas del medio sin molestar la capa blanca por mucho tiempo.",
      "¿Por qué orientar primero? Que lo amarillo mire arriba es un problema aparte, más simple que ubicar piezas exactas. Dividir un problema difícil en dos fáciles es todo el secreto.",
      "¿Por qué las repeticiones terminan el cubo? Las secuencias repetidas mueven pocas piezas en ciclo y devuelven el resto intacto. Los ciclos arreglan el final sin romper lo demás."
    ]
  },
  fr: {
    greet: "Salut ! Je suis ton coach du cube. Touche **Apprendre** et je t'apprends, **Mélanger et Jouer** pour jouer, ou tente le **Défi du Jour**.",
    scrambleGo: "Je mélange ! Résous-le — le chrono démarre maintenant.",
    teachIntro: "Regarde bien ! Je vais mélanger le cube, puis on le répare ensemble, étape par étape.",
    alreadySolved: "Ton cube est déjà résolu ! Touche 'Mélanger et Jouer' et on commence pour de vrai.",
    lessonDone: "Tu l'as résolu ! C'est toi qui as réfléchi — le cube n'a fait qu'obéir. Touche 'Mélanger et Jouer' pour recommencer.",
    backSolved: "Cube résolu à nouveau.",
    teachFirst: "Dis d'abord 'apprends-moi', et je te guide pas à pas.",
    nudge: "Regarde : j'amène une pièce brillante devant et je montre un tour. Je le défais — à toi d'essayer.",
    result: "Résolu en {time} avec {moves} mouvements !",
    newBest: " **Nouveau record personnel !**",
    best: " Record personnel : {best}.",
    scrambleBtn: "Mélanger et Jouer",
    teachBtn: "Apprendre",
    movesWord: "mvts",
    resultShort: "Résolu ! Bravo !",
    wrongMove: "Ce chemin cassait ton progrès — je l'ai annulé. Essaie autrement, ou demande un indice.",
    stageNames: ["Croix blanche", "Coins blancs", "Couche du milieu", "Croix jaune", "Dernière couche"],
    dailyBtn: "Défi du jour",
    dailyGo: "Le défi du jour ! Tout le monde reçoit ce même mélange aujourd'hui — résous-le et garde ta série vivante.",
    dailyDone: "Défi du jour réussi en {time} ! **Série : {streak} jours.**",
    dailyAlready: "Le défi d'aujourd'hui est déjà fait — série : {streak} jours. Reviens demain !",
    statsTail: " Cubes résolus : {n}.",
    rowTop: "la rangée du haut", rowMid: "la rangée du milieu", rowBottom: "la rangée du bas",
    colLeft: "la colonne gauche", colMid: "la colonne du milieu", colRight: "la colonne droite",
    dirLeft: "vers la gauche", dirRight: "vers la droite", dirUp: "vers le haut", dirDown: "vers le bas",
    moveHint: "Essaie ça : fais glisser {row} {dir} — suis la flèche.",
    guidedMove: "Regarde — je fais glisser {row} {dir} : la pièce voyage vers sa place sans casser ton travail. À toi de continuer !",
    goals: [
      "Premier objectif : **la croix blanche**. Place les quatre arêtes blanches autour du centre blanc, chacune accordée à la couleur du centre latéral.",
      "Croix blanche réussie, bien raisonné ! Ensuite : **les coins blancs**. Place les quatre coins pour compléter toute la face blanche et son premier anneau.",
      "Première couche complète ! Maintenant **la couche du milieu** : place les quatre arêtes sans blanc ni jaune.",
      "Deux couches ! Fais maintenant **une croix jaune** sur la face du haut. Seule l'orientation du jaune compte pour l'instant.",
      "Croix jaune ! Dernière partie : **termine le cube**. Amène les dernières pièces à leur place, en gardant ce que tu as construit."
    ],
    hints: [
      ["Trouve une arête avec du blanc. Où doit-elle aller ? Regarde son AUTRE couleur.",
       "Une arête va entre le centre blanc et le centre de son autre couleur. Amène-la sans casser celles déjà placées."],
      ["Un coin a trois couleurs. Il va là où ces trois centres se rencontrent.",
       "Mets le coin sous sa place, puis tourne-le vers le haut. S'il est coincé au mauvais endroit, sors-le d'abord."],
      ["Tourne le cube avec le blanc en bas. Cherche en haut une arête sans jaune.",
       "Accorde la couleur avant de l'arête avec son centre, puis insère-la à gauche ou à droite dans la couche du milieu."],
      ["Regarde le motif jaune du haut : un point, un L, ou une ligne. Chacun est à un pas du suivant.",
       "Répète la même courte séquence et observe le motif changer. Que fait-elle à chaque fois ?"],
      ["Mets d'abord les coins à la bonne POSITION, même tordus. Ensuite oriente-les un par un.",
       "Remarque comment une séquence répétée fait tourner trois pièces en cycle. Les cycles sont le secret du cube."]
    ],
    whys: [
      "Pourquoi la croix d'abord ? Les arêtes n'ont que deux couleurs : c'est le plus simple à raisonner. On construit toujours du simple vers le difficile.",
      "Pourquoi les coins maintenant ? Un coin touche trois faces, il lui faut des repères. Ta croix donne à chaque coin une maison fixe.",
      "Pourquoi ça marche ? Chaque mouvement casse quelque chose et le reconstruit dans les mêmes tours. On insère les arêtes du milieu sans déranger longtemps la couche blanche.",
      "Pourquoi l'orientation d'abord ? Mettre le jaune vers le haut est un problème à part, plus simple que placer les pièces exactement. Diviser un problème dur en deux faciles, c'est tout le secret.",
      "Pourquoi les répétitions finissent-elles le cube ? Les séquences répétées déplacent quelques pièces en cycle et rendent le reste intact. Les cycles réparent la fin sans casser le reste."
    ]
  }
}
