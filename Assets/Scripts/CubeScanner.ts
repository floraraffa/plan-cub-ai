// CubeScanner — scan a REAL 3x3 puzzle cube with the Spectacles camera and load
// it into the AR cube, ASolver-style:
//   - the demo cube goes NEUTRAL GREY and turns itself to the face we ask for
//   - the coach asks for each face in turn; you fill the square and tap Capture
//   - an AI VISION model reads that face's 9 sticker colours from the photo
//     (robust across lighting where hand-tuned RGB thresholds washed out), and
//     the cells paint onto the 3D cube; a local RGB reader remains as fallback
//   - once all six faces are in, your real cube appears in AR and the arrows
//     guide you move by move
//
// Holding rules (so every sticker lands on known cube coordinates):
//   side faces (green/red/blue/orange): WHITE on top
//   white face: GREEN pointing down       yellow face: GREEN pointing up
//
// Camera + AI: SAME stack as our Lingo Specs lens — CameraModule for the frames
// and OpenAI (vision + TTS) over the Remote Service Gateway. Nothing experimental.
//   - Needs an RSG token and the camera enabled.
//   - Camera frames are DEVICE ONLY: the camera path is guarded so the rest of
//     the lens still runs in the editor preview (which has no camera).

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {TargetingMode} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {CubeCoachPort} from "./CubeCoachPort"
import {CubeTutor} from "./CubeTutor"
import {OpenAI} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"

type FaceDef = {n: number[], ir: number[], iu: number[], up: string}

// Per face letter: outward normal (n), image-right (ir), image-up (iu) in cube
// coordinates for the prescribed holding orientation, and which face is UP.
// STANDARD (right-handed) cube: GREEN(F) built at +z so it faces the wearer by
// default and RED(R,+x) lands on the user's RIGHT — a faithful copy of a real
// Western cube. Verified end-to-end offline (cube_sim.py): scan preview AND
// learn view both come out un-mirrored with ZERO per-face flips.
const FACE_DEF: {[letter: string]: FaceDef} = {
  F: {n: [0, 0, 1], ir: [1, 0, 0], iu: [0, 1, 0], up: "U"},    // green, white up (faces user)
  R: {n: [1, 0, 0], ir: [0, 0, -1], iu: [0, 1, 0], up: "U"},   // red, white up
  B: {n: [0, 0, -1], ir: [-1, 0, 0], iu: [0, 1, 0], up: "U"},  // blue, white up
  L: {n: [-1, 0, 0], ir: [0, 0, 1], iu: [0, 1, 0], up: "U"},   // orange, white up
  U: {n: [0, 1, 0], ir: [1, 0, 0], iu: [0, 0, -1], up: "B"},   // white, green down
  D: {n: [0, -1, 0], ir: [1, 0, 0], iu: [0, 0, 1], up: "F"}    // yellow, green up
}

const SUGGEST_ORDER: string[] = ["F", "R", "B", "L", "U", "D"]

// AI vision reads each sticker as a colour WORD; map those to cube face letters.
const COLOR2LETTER: {[c: string]: string} = {
  white: "U", yellow: "D", green: "F", blue: "B", red: "R", orange: "L"
}
const AI_MODEL = "gpt-4o" // strong vision model — better green/blue discrimination

const TXT: {[lang: string]: {[k: string]: string}} = {
  en: {
    scanBtn: "Scan my cube",
    announce: "New! Tap **Scan my cube** and bring your REAL cube: show me its faces and I read them by myself.",
    intro: "Each face is named by its CENTRE colour (that middle sticker never moves). Fill the square with ONE face and tap Capture — side faces with WHITE on top; white face: green DOWN; yellow face: green UP.",
    tapWhenReady: "…then tap CAPTURE",
    snap: "Reading the photo…",
    aiReading: "Reading your cube with AI…",
    capturing: "Capturing…",
    analyzing: "Analysing the {c} face with the cloud… (look at the CENTRE colour)",
    building: "Building your cube with the cloud…",
    review: "Looks right? Tap any wrong colour to change it, then CONFIRM.",
    confirmBtn: "Confirm",
    aiFail: "I couldn't reach my AI helper — check the connection and tap again.",
    badShot: "That photo didn't work — more light, fill the square, and tap again.",
    alreadyDone: "The {c} face is already in — show me the {n} face.",
    showFace: "Now show me the {c} face {h}",
    hSide: "(WHITE on top)",
    hU: "(green DOWN)",
    hD: "(green UP)",
    reading: "Reading the {c} face…",
    faceRead: "{c} face done! {n} to go.",
    lastRead: "That's all six!",
    capture: "Capture",
    cancel: "Cancel",
    done: "Your cube is in! Follow my arrows on the 3D cube with your real one.",
    fail: "I couldn't read the colors well. More light helps — let's try again.",
    countBad: "I counted: {n}. Each colour must be exactly 9 — check those faces.",
    noCam: "The camera only works on the glasses.",
    noCube: "I can't see a cube — fill the square with ONE face, with good light.",
    cubeFound: "There's your cube! Hold each face steady and I'll read it.",
    reface: "The {c} face doesn't add up — show it to me once more.",
    cU: "WHITE", cD: "YELLOW", cF: "GREEN", cB: "BLUE", cR: "RED", cL: "ORANGE"
  },
  es: {
    scanBtn: "Escanear mi cubo",
    announce: "¡Nuevo! Tocá **Escanear mi cubo** y traé tu cubo REAL: mostrame las caras y las leo solita.",
    intro: "Cada cara se llama por el color de su CENTRO (ese sticker del medio nunca se mueve). Llená el recuadro con UNA cara y tocá Capturar — las de los costados con la BLANCA arriba; la blanca: verde ABAJO; la amarilla: verde ARRIBA.",
    tapWhenReady: "…y tocá CAPTURAR",
    snap: "Leyendo la foto…",
    aiReading: "Leyendo tu cubo con IA…",
    capturing: "Capturando…",
    analyzing: "Analizando la cara {c} con la nube… (mirá el color del CENTRO)",
    building: "Armando tu cubo con la nube…",
    review: "¿Quedó bien? Tocá un color mal para cambiarlo, y después CONFIRMAR.",
    confirmBtn: "Confirmar",
    aiFail: "No pude conectar con mi ayudante IA — revisá la conexión y tocá de nuevo.",
    badShot: "Esa foto no salió — más luz, llená el recuadro y tocá de nuevo.",
    alreadyDone: "La cara {c} ya está — mostrame la {n}.",
    showFace: "Ahora mostrame la cara {c} {h}",
    hSide: "(con la BLANCA arriba)",
    hU: "(con la verde ABAJO)",
    hD: "(con la verde ARRIBA)",
    reading: "Leyendo la cara {c}…",
    faceRead: "¡Cara {c} lista! Faltan {n}.",
    lastRead: "¡Ya están las seis!",
    capture: "Capturar",
    cancel: "Cancelar",
    done: "¡Tu cubo ya está en la lente! Seguí mis flechas en el cubo 3D con tu cubo real.",
    fail: "No pude leer bien los colores. Con más luz ayuda — probemos de nuevo.",
    countBad: "Conté: {n}. Cada color tiene que ser exactamente 9 — revisá esas caras.",
    noCam: "La cámara solo funciona en los anteojos.",
    noCube: "No veo el cubo — llená el recuadro con UNA cara, con buena luz.",
    cubeFound: "¡Ahí está tu cubo! Mostrame cada cara quietita y la leo.",
    reface: "La cara {c} no me cierra — mostrámela una vez más.",
    cU: "BLANCA", cD: "AMARILLA", cF: "VERDE", cB: "AZUL", cR: "ROJA", cL: "NARANJA"
  },
  fr: {
    scanBtn: "Scanner mon cube",
    announce: "Nouveau ! Touche **Scanner mon cube** avec ton VRAI cube : montre-moi ses faces et je les lis toute seule.",
    intro: "Chaque face est nommée par la couleur de son CENTRE (ce sticker du milieu ne bouge jamais). Remplis le cadre avec UNE face et touche Capturer — les côtés avec le BLANC en haut ; la blanche : vert en BAS ; la jaune : vert en HAUT.",
    tapWhenReady: "…puis touche CAPTURER",
    snap: "Je lis la photo…",
    aiReading: "Je lis ton cube avec l'IA…",
    capturing: "Capture…",
    analyzing: "J'analyse la face {c} avec le cloud… (regarde la couleur du CENTRE)",
    building: "Je construis ton cube avec le cloud…",
    review: "C'est bon ? Touche une couleur fausse pour la changer, puis CONFIRME.",
    confirmBtn: "Confirmer",
    aiFail: "Je n'ai pas pu joindre mon assistant IA — vérifie la connexion et retouche.",
    badShot: "Cette photo n'a pas marché — plus de lumière, remplis le cadre, retouche.",
    alreadyDone: "La face {c} est déjà lue — montre-moi la {n}.",
    showFace: "Montre-moi la face {c} {h}",
    hSide: "(BLANC en haut)",
    hU: "(vert en BAS)",
    hD: "(vert en HAUT)",
    reading: "Je lis la face {c}…",
    faceRead: "Face {c} lue ! Encore {n}.",
    lastRead: "Les six sont là !",
    capture: "Capturer",
    cancel: "Annuler",
    done: "Ton cube est chargé ! Suis mes flèches sur le cube 3D avec ton vrai cube.",
    fail: "Je n'ai pas bien lu les couleurs. Plus de lumière aide — réessayons.",
    countBad: "J'ai compté : {n}. Chaque couleur doit être exactement 9 — vérifie ces faces.",
    noCam: "La caméra ne marche que sur les lunettes.",
    noCube: "Je ne vois pas le cube — remplis le cadre avec UNE face, bien éclairée.",
    cubeFound: "Voilà ton cube ! Montre-moi chaque face sans bouger et je la lis.",
    reface: "La face {c} ne colle pas — montre-la moi encore une fois.",
    cU: "BLANCHE", cD: "JAUNE", cF: "VERTE", cB: "BLEUE", cR: "ROUGE", cL: "ORANGE"
  }
}

@component
export class CubeScanner extends BaseScriptComponent {
  @input cubeObject: SceneObject // the object holding CubeCoachPort
  @input tutorObject: SceneObject // the object holding CubeTutor
  // Scan button artwork, one per language (square; text button otherwise)
  @input
  @allowUndefined
  btnScanEnglish: Texture
  @input
  @allowUndefined
  btnScanSpanish: Texture
  @input
  @allowUndefined
  btnScanFrench: Texture
  // Capture / Confirm / Cancel button artwork, one per language (square 1:1).
  // If a texture is unassigned the button falls back to its text plate.
  @input
  @allowUndefined
  btnCaptureEnglish: Texture
  @input
  @allowUndefined
  btnCaptureSpanish: Texture
  @input
  @allowUndefined
  btnCaptureFrench: Texture
  @input
  @allowUndefined
  btnConfirmEnglish: Texture
  @input
  @allowUndefined
  btnConfirmSpanish: Texture
  @input
  @allowUndefined
  btnConfirmFrench: Texture
  @input
  @allowUndefined
  btnCancelEnglish: Texture
  @input
  @allowUndefined
  btnCancelSpanish: Texture
  @input
  @allowUndefined
  btnCancelFrench: Texture
  @input scanButtonSize: number = 14 // cm — matches the main row buttons
  @input previewSize: number = 18 // cm — the floating camera window
  @input
  @allowUndefined
  labelFont: Font
  @input
  @allowUndefined
  handleTexture: Texture // optional: same marshmallow bar art as the tutor's
  @input
  @allowUndefined
  handleMesh: RenderMesh // optional: SIK SphereMesh for a rounded pill bar

  private cube: CubeCoachPort | null = null
  private tutor: CubeTutor | null = null

  private camTex: Texture | null = null
  private scanning: boolean = false
  private samplesByLetter: {[letter: string]: number[][]} = {}
  private facesDone: {[letter: string]: boolean} = {}
  private doneCount: number = 0
  // GUIDED TRUST: the face the coach is asking for RIGHT NOW. A capture is
  // attributed to this face, not to a classifier of the center sticker — that
  // classifier read orange as red and jammed the scan on Flor's cube.
  private askingFor: string = "F"
  // AI vision path: the 9 colour letters each face returned (source of truth).
  private faceLetters: {[face: string]: string[]} = {}
  // the cropped face photos (base64 JPEG), kept so the final pass can read all
  // six faces TOGETHER under the "exactly 9 of each colour" constraint.
  private faceCrops: {[face: string]: string} = {}
  // review-before-commit: the 9 letters the AI just read for the current face,
  // shown as a tappable 3x3 grid so the user can fix any wrong sticker and
  // confirm — no more re-scanning everything for one bad colour.
  private pendingFace: string[] | null = null
  private confirmButton: SceneObject | null = null

  private uiRoot: SceneObject | null = null
  private infoText: Text | null = null
  private swatches: RenderMeshVisual[] = []
  private scanButton: SceneObject | null = null
  private cleanupQueue: SceneObject[] = []

  // live recognition state
  private autoT: number = 0
  private lastPattern: string = ""
  private stableCount: number = 0
  private captureCooldown: number = 0
  private viewLetter: string | null = null // face currently in front of the camera
  private lastSample: number[][] | null = null
  private lastSeps: number[] = [] // brightness of the gaps between stickers
  private noCubeT: number = 0 // seconds without a recognizable cube in view
  private lastNoise: number[] = [] // per-cell internal texture (flat = sticker)
  private lastOutside: number[][] = [] // ring just OUTSIDE the guide square

  // STAGE 1 state: first find the cube, only then read faces
  private cubePresent: boolean = false
  private presentCount: number = 0
  private absentCount: number = 0
  private saidFound: boolean = false
  private lastSuspicion: {[letter: string]: number} = {}
  private refaceTries: number = 0
  private triedFullAI: boolean = false // ran the "9-of-each" full-cube AI pass?
  private stillLetter: string | null = null // (legacy, unused in photo mode)
  private stillT: number = 0
  private shotPending: boolean = false // one photo at a time
  private lastStillNoise: number[] = [] // per-cell noise of the last photo
  // The hi-res still has a DIFFERENT field of view than the viewfinder feed:
  // the grid scale that matches what the user framed is found by comparing
  // the still against a live reading taken at the moment of the tap.
  private stillScale: number = -1 // calibrated once per session
  private tapSample: number[][] | null = null

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.setup())
    this.createEvent("UpdateEvent").bind(() => this.update())
  }

  private setup() {
    this.cube = this.cubeObject.getComponent(CubeCoachPort.getTypeName()) as CubeCoachPort
    this.tutor = this.tutorObject.getComponent(CubeTutor.getTypeName()) as CubeTutor
    if (!this.cube || !this.tutor) {
      print("CubeScanner: cubeObject/tutorObject inputs are missing their components")
      return
    }
    // Mix & Play / Daily / Learn pressed mid-scan -> the scan cleans up first
    this.tutor.setScanAbortHook(() => {
      if (this.scanning) this.cancelScan()
    })
  }

  private shownLang: string = "" // language the button was last built for

  private update() {
    // deferred UI destruction (destroying mid-touch-event can crash SIK)
    if (this.cleanupQueue.length > 0) {
      for (const o of this.cleanupQueue) o.destroy()
      this.cleanupQueue = []
    }

    this.updateWindowDrag(getDeltaTime())
    if (this.uiRoot) this.billboardWindow() // window always faces the user
    this.updatePhotoFlow()

    // the button appears once a language is chosen, joining the main row,
    // and rebuilds itself whenever the language changes
    if (this.tutor && this.tutor.isLanguageChosen() && !this.scanning) {
      const lang = this.tutor.getLang()
      if (lang !== this.shownLang) {
        this.shownLang = lang
        if (this.scanButton) {
          this.scanButton.enabled = false
          this.cleanupQueue.push(this.scanButton)
          this.scanButton = null
        }
        const slot = this.tutor.makeRoomForScanButton()
        this.scanButton = this.makeButton(this.t("scanBtn"), this.scanTex(),
          slot, this.scanButtonSize, () => this.startScan())
        // the coach presents the new mode, in the chosen language
        this.tutor.coachSay(this.t("announce"), "scanNew")
      }
    }
  }

  // PHOTO MODE: no continuous processing at all — the live feed is only a
  // viewfinder (a texture on a quad, zero CPU). Each face is ONE deliberate
  // hi-res photo, taken with the Capture button. This keeps the device cool:
  // the old real-time loop read ~150 pixel patches per second and overheated
  // the Spectacles until they shut down.
  private guideFlashT: number = 0

  private updatePhotoFlow() {
    if (!this.scanning) return
    const dt = getDeltaTime()
    // an AI read is in flight (encode + network): give it up to 15s, then bail
    if (this.shotPending) {
      this.stillT += dt
      if (this.stillT > 15) {
        this.shotPending = false
        print("CubeScanner: AI read timed out")
        this.setInfo(this.t("aiFail"))
      }
      return
    }
    // the guide frame flashes green for a moment after each good reading
    if (this.guideFlashT > 0) {
      this.guideFlashT -= dt
      if (this.guideFlashT <= 0) this.setGuideColor(false)
    }
  }

  private scanTex(): Texture {
    const lang = this.tutor ? this.tutor.getLang() : "en"
    const tex = lang === "es" ? this.btnScanSpanish
      : lang === "fr" ? this.btnScanFrench : this.btnScanEnglish
    return tex ? tex : this.btnScanEnglish
  }

  // Per-language artwork for the in-window buttons. Returns null when the
  // texture isn't assigned, so makeButtonIn draws its text plate instead.
  private captureTex(): Texture | null {
    const lang = this.tutor ? this.tutor.getLang() : "en"
    return (lang === "es" ? this.btnCaptureSpanish
      : lang === "fr" ? this.btnCaptureFrench : this.btnCaptureEnglish) || null
  }
  private confirmTex(): Texture | null {
    const lang = this.tutor ? this.tutor.getLang() : "en"
    return (lang === "es" ? this.btnConfirmSpanish
      : lang === "fr" ? this.btnConfirmFrench : this.btnConfirmEnglish) || null
  }
  private cancelTex(): Texture | null {
    const lang = this.tutor ? this.tutor.getLang() : "en"
    return (lang === "es" ? this.btnCancelSpanish
      : lang === "fr" ? this.btnCancelFrench : this.btnCancelEnglish) || null
  }

  // --- live color reading ------------------------------------------------------

  private static PALETTE: {[l: string]: number[]} = {
    U: [1, 1, 1, 1], D: [1, 0.85, 0, 1], F: [0, 0.62, 0.13, 1],
    B: [0, 0.27, 0.9, 1], R: [0.85, 0.06, 0.06, 1], L: [1, 0.45, 0, 1]
  }

  // Rough standalone classifier — good enough to recognize a face live.
  // The final cube state is still refined against the six scanned centers.
  // Live classifier: centers already scanned are ground truth under the
  // CURRENT light — a cell nearly identical to one of them takes its letter;
  // everything else falls back to the fixed hue rules.
  private classifyLive(rgb: number[]): string {
    const f = this.feature(rgb)
    let bestL = "", bestD = Number.MAX_VALUE
    for (const l in this.samplesByLetter) {
      const d = this.dist(f, this.feature(this.samplesByLetter[l][4]))
      if (d < bestD) { bestD = d; bestL = l }
    }
    // tight gate: only take an already-scanned center's letter when the cell is
    // truly near it. 1200 was so loose that orange (687 from the red center)
    // borrowed red's letter; below ~400 it falls through to the honest hue rule.
    if (bestL !== "" && bestD < 400) return bestL
    return this.classifyFixed(rgb)
  }

  private classifyFixed(rgb: number[]): string {
    const r = rgb[0], g = rgb[1], b = rgb[2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const s = mx === 0 ? 0 : (mx - mn) / mx
    if (s < 0.22) return "U" // white: strictly desaturated
    // white under a residual warm cast: bright and only mildly tinted
    // (a warm-lit white sticker classified as orange and the white face
    // was skipped forever — Flor's find)
    const bright = (r + g + b) / 3
    if (s < 0.34 && bright > 160) return "U"
    const d = mx - mn
    let h = 0
    if (mx === r) h = 60 * (((g - b) / d) % 6)
    else if (mx === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
    if (h < 0) h += 360
    if (h < 20 || h >= 335) return "R"
    if (h < 48) return "L"       // orange
    if (h < 78) return "D"       // yellow
    if (h < 170) return "F"      // green
    if (h < 270) return "B"      // blue
    return "R"
  }

  // Cube-grid cell + outward axis for cell `cell` (0..8) of face `letter`.
  private cellPosDir(letter: string, cell: number): {pos: number[], dir: number[]} {
    const sf = FACE_DEF[letter]
    const col = cell % 3, row = Math.floor(cell / 3)
    return {
      pos: [
        sf.n[0] + (col - 1) * sf.ir[0] + (1 - row) * sf.iu[0],
        sf.n[1] + (col - 1) * sf.ir[1] + (1 - row) * sf.iu[1],
        sf.n[2] + (col - 1) * sf.ir[2] + (1 - row) * sf.iu[2]
      ],
      dir: [sf.n[0], sf.n[1], sf.n[2]]
    }
  }

  private t(k: string): string {
    const lang = this.tutor ? this.tutor.getLang() : "en"
    const table = TXT[lang] ? TXT[lang] : TXT["en"]
    return table[k] ? table[k] : TXT["en"][k]
  }

  // "Now show me the GREEN face (WHITE on top)" — concrete, like the app
  private showFaceLine(letter: string): string {
    const h = letter === "U" ? this.t("hU") : letter === "D" ? this.t("hD") : this.t("hSide")
    return this.fmt(this.t("showFace"), {c: this.t("c" + letter), h: h})
  }

  private nextMissing(): string | null {
    for (const s of SUGGEST_ORDER) if (!this.facesDone[s]) return s
    return null
  }

  private fmt(s: string, vars: {[k: string]: string}): string {
    let out = s
    for (const k in vars) out = out.split("{" + k + "}").join(vars[k])
    return out
  }

  // --- camera -----------------------------------------------------------------

  private camModule: any = null

  private startCamera(): boolean {
    if (this.camTex) return true
    try {
      const camModule = require("LensStudio:CameraModule")
      this.camModule = camModule
      const req = CameraModule.createCameraRequest()
      req.cameraId = CameraModule.CameraId.Default_Color
      // 756 is this camera's MAX smaller-dimension (device log: "Requested
      // dimension 1024 is larger than max supported 756"). Anything larger
      // THROWS and the scan falls back to the "camera only works on glasses"
      // message. 756 is still a touch sharper than the old 704.
      req.imageSmallerDimension = 756
      this.camTex = camModule.requestCamera(req)
      return true
    } catch (e) {
      // preview, or camera permission missing: scanning is device-only
      print("CubeScanner: camera unavailable (" + e + ")")
      return false
    }
  }

  // --- scan flow ---------------------------------------------------------------

  private startScan() {
    if (this.scanning) return
    if (!this.startCamera()) {
      this.flashInfoOnButton(this.t("noCam"))
      return
    }
    this.scanning = true
    this.shotPending = false
    this.pendingFace = null
    this.samplesByLetter = {}
    this.faceLetters = {}
    this.faceCrops = {}
    this.facesDone = {}
    this.doneCount = 0
    this.viewLetter = null
    this.autoT = 0
    this.lastPattern = ""
    this.stableCount = 0
    this.cubePresent = false
    this.presentCount = 0
    this.absentCount = 0
    this.saidFound = false
    this.refaceTries = 0
    this.triedFullAI = false
    this.captureCooldown = 1.0 // let the window settle before the first read
    this.buildScanUI()
    this.tutor!.enterScanMode() // cuts speech AND parks lesson/challenge modes
    // scanning needs a STILL world: pin the whole stage (no head-follow);
    // the grey bars — stage and window — are the only way things move
    this.tutor!.setFollowFrozen(true)
    // ASolver look: the demo cube resets, goes grey, and will mirror + fill up
    this.cube!.resetToSolved()
    this.cube!.clearScanTiles()
    this.cube!.setScanDim(true)
    this.cube!.orientForScan("F", FACE_DEF["F"].up)
    this.askingFor = "F"
    // the window shows the general framing tip while the voice reads the intro;
    // the concrete "show me the GREEN face" text arrives when the voice says it,
    // so text and audio never name different things
    this.setInfo(this.t("intro"))
    this.tutor!.coachSay(this.t("intro"), "scanIntro")
    this.tutor!.coachSay(this.showFaceLine("F"), "scanShowF", () => {
      if (this.scanning) this.setInfo(this.showFaceLine("F") + "\n" + this.t("tapWhenReady"))
    })
  }

  // AI vision read a face: paint it and commit its 9 colour letters.
  private acceptFaceAI(letter: string, letters: string[]) {
    letters[4] = letter // a face's centre is, by definition, that face's colour
    this.faceLetters[letter] = letters // already in logical order
    print("CubeScanner: AI face " + letter + " committed " + letters.join(""))
    for (let cell = 0; cell < 9; cell++) {
      const cd = this.cellPosDir(letter, cell) // logical order, normal cellPosDir
      const pal = CubeScanner.PALETTE[letters[cell]] || [0.5, 0.5, 0.5, 1]
      this.cube!.setScanTile(cd.pos, cd.dir, new vec4(pal[0], pal[1], pal[2], pal[3]))
    }
    this.setGuideColor(true)
    this.guideFlashT = 1.2
    this.afterFaceCommitted(letter)
  }

  // The AI read a face: show it for REVIEW (3x3 swatches + painted on the cube).
  // The user can tap any wrong swatch to fix it, then tap Confirm to bank it.
  private showPendingFace(letter: string, letters: string[]) {
    letters[4] = letter // centre is always this face's colour
    this.pendingFace = letters
    print("CubeScanner: AI face " + letter + " = " + letters.join("") + " (review)")
    this.paintPending(letter)
    this.setInfo(this.t("review"))
    if (this.confirmButton) this.confirmButton.enabled = true
  }

  // Paint the pending letters onto the 3x3 swatches AND the demo cube face.
  // The swatches sit on a flat panel facing the user (correct left-right). The
  // cube tile is placed at the HORIZONTALLY-MIRRORED cell, because turning the
  // face to look at the user flips its left-right — this cancels that so the 3D
  // face reads the same way as the real cube in the user's hands.
  private paintPending(letter: string) {
    if (!this.pendingFace) return
    for (let cell = 0; cell < 9; cell++) {
      const pal = CubeScanner.PALETTE[this.pendingFace[cell]] || [0.5, 0.5, 0.5, 1]
      if (cell < this.swatches.length) {
        this.swatches[cell].mainMaterial.mainPass.baseColor =
          new vec4(pal[0], pal[1], pal[2], 1)
      }
      const cd = this.cellPosDir(letter, cell)
      this.cube!.setScanTile(cd.pos, cd.dir, new vec4(pal[0], pal[1], pal[2], pal[3]))
    }
  }

  // Tap a swatch to cycle its colour (centre stays — it defines the face).
  private cycleSwatch(cell: number) {
    if (!this.pendingFace || cell === 4) return
    const order = ["U", "D", "F", "B", "R", "L"]
    const cur = order.indexOf(this.pendingFace[cell])
    this.pendingFace[cell] = order[(cur + 1) % order.length]
    this.paintPending(this.askingFor)
  }

  // Confirm the (possibly corrected) pending face and move on.
  private confirmFace() {
    if (!this.pendingFace) return
    const letters = this.pendingFace
    this.pendingFace = null
    if (this.confirmButton) this.confirmButton.enabled = false
    this.acceptFaceAI(this.askingFor, letters)
  }

  // Shared tail for both paths: mark the face done, celebrate, ask for the next.
  private afterFaceCommitted(letter: string) {
    this.facesDone[letter] = true
    this.doneCount++
    this.stableCount = 0
    this.lastPattern = ""
    this.viewLetter = null
    this.captureCooldown = 1.2 // time to turn the real cube in your hands
    this.cube!.flashFeedback(true) // green: face read

    if (this.doneCount >= 6) {
      // every face was reviewed & confirmed by the user, so those letters are
      // the truth — validate them straight away (no extra AI pass to override)
      this.finishScan()
      return
    }
    const line = this.fmt(this.t("faceRead"),
      {c: this.t("c" + letter), n: "" + (6 - this.doneCount)})
    // dynamic line (names a color + count): key "" caches by the exact text, so
    // the voice can never replay a stale "green!" over a "red!" line
    this.tutor!.coachSay(line, "")
    // then ask for a SPECIFIC next face. The demo cube's turn AND the window
    // text wait until the voice actually reaches "show me the X face": until
    // then the just-read face stays up, so text, cube and audio always agree.
    const next = this.nextMissing()
    if (next) {
      // attribute the NEXT capture to this face immediately (even if the user
      // taps before the voice catches up); the turn + text still sync to speech
      this.askingFor = next
      this.tutor!.coachSay(this.showFaceLine(next), "scanShow" + next, () => {
        if (!this.scanning) return
        this.cube!.orientForScan(next, FACE_DEF[next].up)
        this.setInfo(this.showFaceLine(next) + "\n" + this.t("tapWhenReady"))
      })
    }
  }

  // THE capture: one tap sends the framed face to an AI vision model, which
  // reads its 9 sticker colours. This is robust across lighting where the old
  // hand-tuned RGB thresholds failed. Extended Permissions lets the camera and
  // internet run together (required here). Flow: wait for a fresh frame (device
  // rule) -> encode it to a JPEG -> ask the model -> paint the face.
  private captureFace() {
    if (!this.scanning || this.shotPending || this.doneCount >= 6) return
    this.shotPending = true
    this.stillT = 0
    this.setInfo(this.t("capturing"))
    const ctrl: any = this.camTex ? (this.camTex as any).control : null
    if (ctrl && ctrl.onNewFrame) {
      const reg = ctrl.onNewFrame.add(() => {
        if (!this.shotPending) return
        ctrl.onNewFrame.remove(reg)
        this.sendFaceToAI()
      })
    } else {
      this.sendFaceToAI()
    }
  }

  private lastCrop: Texture | null = null // kept alive until the encode finishes

  // Encode the current camera frame to a base64 JPEG and hand it to the model.
  // We CROP to the centre guide-square region first: the cube is a small object
  // in a wide, dim frame, so sending the whole frame made the model guess (two
  // reads of the same face came back completely different). A tight centre crop
  // gives it a clear 3x3 face to read.
  private sendFaceToAI() {
    const face = this.askingFor
    const crop = this.cropCenterTexture(0.6)
    this.lastCrop = crop
    const tex = crop ? crop : this.camTex!
    try {
      Base64.encodeTextureAsync(tex, (b64: string) => {
        if (!this.scanning || !this.shotPending) return
        this.askAIForColors(b64, face)
      }, () => {
        if (!this.shotPending) return
        this.shotPending = false
        print("CubeScanner: texture encode failed")
        this.setInfo(this.t("badShot"))
      }, CompressionQuality.HighQuality, EncodingType.Jpg)
    } catch (e) {
      this.shotPending = false
      print("CubeScanner: encode threw (" + e + ")")
      this.setInfo(this.t("badShot"))
    }
  }

  // A new Texture holding the centre `frac` square of the live camera frame,
  // so the AI sees a zoomed-in face instead of a tiny cube across the room.
  private cropCenterTexture(frac: number): Texture | null {
    try {
      const src = ProceduralTextureProvider.createFromTexture(this.camTex!)
      const sctrl = src.control as ProceduralTextureProvider
      const w = src.getWidth(), h = src.getHeight()
      const side = Math.floor(Math.min(w, h) * frac)
      const x0 = Math.floor((w - side) / 2), y0 = Math.floor((h - side) / 2)
      const buf = new Uint8Array(side * side * 4)
      sctrl.getPixels(x0, y0, side, side, buf)
      const dst = ProceduralTextureProvider.create(side, side, Colorspace.RGBA)
      ;(dst.control as ProceduralTextureProvider).setPixels(0, 0, side, side, buf)
      print("CubeScanner: cropped centre " + side + "x" + side + " from " + w + "x" + h)
      return dst
    } catch (e) {
      print("CubeScanner: crop failed (" + e + ") — sending full frame")
      return null
    }
  }

  // Vision request: the model returns the 9 colours of the centred face.
  private askAIForColors(b64: string, face: string) {
    this.faceCrops[face] = b64 // keep for the final all-six pass
    this.setInfo(this.fmt(this.t("analyzing"), {c: this.t("c" + face)}))
    const centerColor = this.colorWord(face)
    const prompt =
      "This first-person photo shows ONE face of a Rubik's cube, centred in the frame. " +
      "Read THAT centred face as a 3x3 grid, LEFT-to-RIGHT then TOP-to-BOTTOM (9 stickers). " +
      "Each sticker is exactly one of: white, yellow, green, blue, red, orange. " +
      "The centre sticker (position 5) is " + centerColor +
      " — use it as the colour reference for the other eight under this lighting. " +
      "Reply with ONLY a JSON array of 9 lowercase colour words, e.g. " +
      "[\"green\",\"white\",\"red\",\"blue\",\"green\",\"orange\",\"yellow\",\"green\",\"white\"]. No prose."
    OpenAI.chatCompletions({
      model: AI_MODEL,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          {type: "text", text: prompt},
          {type: "image_url", image_url: {url: "data:image/jpeg;base64," + b64}}
        ]
      }]
    } as any).then((resp: any) => {
      if (!this.scanning || !this.shotPending) return
      this.shotPending = false
      const txt = resp && resp.choices && resp.choices[0] && resp.choices[0].message
        ? ("" + resp.choices[0].message.content) : ""
      const letters = this.parseAIColors(txt)
      if (letters) {
        this.showPendingFace(face, letters)
      } else {
        print("CubeScanner: AI parse failed <" + txt + ">")
        this.setInfo(this.t("badShot"))
      }
    }).catch((e: any) => {
      if (!this.shotPending) return
      this.shotPending = false
      print("CubeScanner: AI request failed (" + e + ")")
      this.setInfo(this.t("aiFail"))
    })
  }

  private colorWord(letter: string): string {
    for (const w in COLOR2LETTER) if (COLOR2LETTER[w] === letter) return w
    return "white"
  }

  // True only when all six face crops are in hand (needed for the full-cube pass).
  private hasAllCrops(): boolean {
    for (const f of ["U", "D", "F", "B", "R", "L"]) if (!this.faceCrops[f]) return false
    return true
  }

  // Tolerant parse: prefer a JSON array, else pull the colour words in order.
  private parseAIColors(txt: string): string[] | null {
    if (!txt) return null
    let arr: string[] | null = null
    const lb = txt.indexOf("["), rb = txt.lastIndexOf("]")
    if (lb >= 0 && rb > lb) {
      try {
        const j = JSON.parse(txt.substring(lb, rb + 1))
        if (Array.isArray(j)) arr = j.map((x: any) => ("" + x).toLowerCase().trim())
      } catch (e) {}
    }
    if (!arr || arr.length !== 9) {
      const found: string[] = []
      const re = /white|yellow|green|blue|red|orange/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(txt)) !== null) found.push(m[0].toLowerCase())
      if (found.length < 9) return null
      arr = found.slice(0, 9)
    }
    const letters = arr.map((c) => COLOR2LETTER[c])
    for (const l of letters) if (!l) return null
    return letters
  }

  // Final pass: send all six cropped faces in ONE request so the model reads
  // the whole cube under the "exactly 9 of each colour" rule and self-corrects
  // ambiguous stickers. Then validate. Falls back to the per-face reads.
  private finalizeWithAI() {
    const faces = ["F", "R", "B", "L", "U", "D"]
    for (const f of faces) {
      if (!this.faceCrops[f]) { this.finishScan(); return } // a crop is missing
    }
    this.setInfo(this.t("building"))
    const names: {[l: string]: string} = {
      F: "green", R: "red", B: "blue", L: "orange", U: "white", D: "yellow"
    }
    const prompt =
      "These six photos are the six faces of ONE Rubik's cube (each photo is " +
      "centred on a single face). For every face, read its 9 stickers " +
      "LEFT-to-RIGHT then TOP-to-BOTTOM. Colours are ONLY: white, yellow, " +
      "green, blue, red, orange. IMPORTANT distinctions: GREEN is a vivid " +
      "grass/emerald green, BLUE is a deep royal blue — do not confuse them; " +
      "ORANGE is lighter and more yellow than RED. The result MUST contain " +
      "EXACTLY 9 stickers of EACH of the six colours (54 total) — count them " +
      "and, if a colour has more or fewer than 9, re-examine the most " +
      "ambiguous stickers (usually green vs blue) and fix them so every colour " +
      "is exactly 9. Each face's centre sticker (position 5) equals that " +
      "face's colour. Reply with ONLY this JSON object, no prose: " +
      "{\"green\":[9],\"red\":[9],\"blue\":[9],\"orange\":[9],\"white\":[9],\"yellow\":[9]} " +
      "where each value is that face's 9 lowercase colour words."
    const content: any[] = [{type: "text", text: prompt}]
    for (const f of faces) {
      content.push({type: "text", text: "Face with " + names[f] + " centre:"})
      content.push({type: "image_url",
        image_url: {url: "data:image/jpeg;base64," + this.faceCrops[f]}})
    }
    OpenAI.chatCompletions({
      model: AI_MODEL, temperature: 0, messages: [{role: "user", content}]
    } as any).then((resp: any) => {
      if (!this.scanning) return
      const txt = resp && resp.choices && resp.choices[0] && resp.choices[0].message
        ? ("" + resp.choices[0].message.content) : ""
      const parsed = this.parseFullCube(txt)
      if (parsed) {
        for (const f of faces) {
          parsed[f][4] = f // the centre is that face's colour by definition
          this.faceLetters[f] = parsed[f]
        }
        const cnt: {[l: string]: number} = {}
        for (const f of faces) for (const l of this.faceLetters[f]) cnt[l] = (cnt[l] || 0) + 1
        print("CubeScanner: AI full-cube read OK — counts " + JSON.stringify(cnt) +
          " | " + faces.map((f) => f + ":" + this.faceLetters[f].join("")).join(" "))
      } else {
        print("CubeScanner: full-cube parse failed, using per-face reads <" + txt + ">")
      }
      this.finishScan()
    }).catch((e: any) => {
      print("CubeScanner: full-cube AI failed (" + e + ") — using per-face reads")
      if (this.scanning) this.finishScan()
    })
  }

  // Parse the all-six JSON {green:[9],...} into {F:[letters],...}, or null.
  private parseFullCube(txt: string): {[face: string]: string[]} | null {
    if (!txt) return null
    const lb = txt.indexOf("{"), rb = txt.lastIndexOf("}")
    if (lb < 0 || rb <= lb) return null
    let obj: any
    try { obj = JSON.parse(txt.substring(lb, rb + 1)) } catch (e) { return null }
    if (!obj) return null
    const name2face: {[n: string]: string} = {
      green: "F", red: "R", blue: "B", orange: "L", white: "U", yellow: "D"
    }
    const out: {[face: string]: string[]} = {}
    for (const name in name2face) {
      const arr = obj[name]
      if (!Array.isArray(arr) || arr.length !== 9) return null
      const letters = arr.map((x: any) => COLOR2LETTER[("" + x).toLowerCase().trim()])
      for (const l of letters) if (!l) return null
      out[name2face[name]] = letters
    }
    return out
  }

  // Local fallback path (unused while AI reading is on): classify RGB cells.
  private readAndProcess() {
    const cells = this.sampleGrid()
    if (cells) this.processShot(cells)
    else this.setInfo(this.t("badShot"))
  }

  // Sample the still at the calibrated scale — or, on the first shot, find
  // the scale whose 9 cells best match the live reading taken at tap time.
  private readStill(tex: Texture): number[][] | null {
    if (this.stillScale > 0) {
      return this.sampleCellsFrom(tex, this.stillScale)
    }
    if (!this.tapSample) return this.sampleCellsFrom(tex, 0.55)
    let bestScale = -1, bestScore = Number.MAX_VALUE
    for (const s of [0.55, 0.45, 0.36, 0.28, 0.22]) {
      const c = this.sampleCellsFrom(tex, s)
      if (!c) continue
      let sc = 0
      for (let i = 0; i < 9; i++) {
        sc += this.dist(this.feature(c[i]), this.feature(this.tapSample[i]))
      }
      if (sc < bestScore) { bestScore = sc; bestScale = s }
    }
    print("CubeScanner: still scale calibrated -> " + bestScale +
      " (score " + Math.round(bestScore) + ")")
    if (bestScale > 0 && bestScore < 9 * 1500) {
      this.stillScale = bestScale
      return this.sampleCellsFrom(tex, bestScale) // re-read: refreshes noise too
    }
    // could not match the framing: the tap reading is the safe truth
    this.lastStillNoise = this.lastNoise
    return this.tapSample
  }

  // Judge one photographed face: readable? which face? already done?
  private processShot(cells: number[][]) {
    this.showSwatches(cells)
    const letters = cells.map((c) => this.classifyLive(c))
    // quality gate: enough light and mostly FLAT sticker cells
    let bright = 0
    for (const c of cells) bright += (c[0] + c[1] + c[2]) / 3
    bright /= 9
    let flat = 0
    for (const nz of this.lastStillNoise) if (nz < 18) flat++
    print("CubeScanner: shot read " + letters.join("") + " bright=" + bright.toFixed(0) +
      " flat=" + flat + " center=" + Math.round(cells[4][0]) + "," +
      Math.round(cells[4][1]) + "," + Math.round(cells[4][2]))
    // raw fidelity dump (asked-for face + every cell's RGB) — read this in the
    // device logs to see whether colours come through vivid or washed out
    print("CubeScanner: face=" + this.askingFor + " cellsRGB " +
      cells.map((c) => Math.round(c[0]) + "/" + Math.round(c[1]) + "/" + Math.round(c[2])).join(" "))
    if (bright < 25 || flat < 6) {
      this.setInfo(this.t("badShot"))
      return
    }
    // GUIDED TRUST: this capture belongs to the face we asked for, full stop.
    // No center classification, so orange can never be mistaken for red and the
    // scan can never jam on "the RED face is already in" while you hold orange.
    const center = this.askingFor
    if (!FACE_DEF[center] || this.facesDone[center]) return
    // good reading: commit the locally-classified letters (paints + advances)
    this.acceptFaceAI(center, letters)
  }

  private finishScan() {
    let err: string | null = "badPieces"
    // AI vision path: each face already carries its 9 colour letters — those
    // ARE the source of truth. Feed them straight into the same validator
    // (mirror flips + per-face rotation recovery) the RGB path used.
    this.lastLetters = {}
    let haveAll = true
    for (const f of ["U", "D", "F", "B", "R", "L"]) {
      if (!this.faceLetters[f]) { haveAll = false; break }
      this.lastLetters[f] = this.faceLetters[f]
    }
    if (haveAll) {
      // the camera frame's orientation varies by device path: try the four
      // mirror interpretations — a well-read cube validates in exactly one
      const flips = [[false, false], [true, false], [false, true], [true, true]]
      for (const f of flips) {
        err = this.cube!.applyScannedState(
          this.buildFacelets(f[0] as boolean, f[1] as boolean, null, 0))
        if (!err) {
          if (f[0] || f[1]) print("CubeScanner: camera flip detected (h=" + f[0] + " v=" + f[1] + ")")
          break
        }
      }
      // still invalid: maybe ONE face was held rotated — try each face at
      // each rotation (cheap: validation only, nothing moves until it passes)
      if (err) {
        const letters6 = ["U", "D", "F", "B", "R", "L"]
        let recovered = false
        for (let li = 0; li < 6 && !recovered; li++) {
          for (let rs = 1; rs <= 3 && !recovered; rs++) {
            for (let ffi = 0; ffi < flips.length && !recovered; ffi++) {
              const f = flips[ffi]
              err = this.cube!.applyScannedState(
                this.buildFacelets(f[0] as boolean, f[1] as boolean, letters6[li], rs))
              if (!err) {
                recovered = true
                print("CubeScanner: face " + letters6[li] + " was held rotated (" + (rs * 90) + "°) — recovered")
              }
            }
          }
        }
      }
    }
    // AI SELF-CORRECTION FALLBACK: the confirmed faces don't form a solvable
    // cube — under this lighting the model almost always mis-labels a few
    // green/blue (or red/orange) stickers, so some colour count isn't 9 and no
    // rotation can fix it. Re-read all six faces in ONE pass under the strict
    // "exactly 9 of each colour" rule (it re-examines the ambiguous stickers),
    // then validate again. Runs at most ONCE per scan, and only when we still
    // have all six crops. This is what turns "scans fine but never builds" into
    // a cube that actually assembles.
    if (err && !this.triedFullAI && this.hasAllCrops()) {
      this.triedFullAI = true
      print("CubeScanner: confirmed read invalid (" + err + ") — full-cube AI pass")
      this.setInfo(this.t("building"))
      this.finalizeWithAI() // re-reads, re-stores faceLetters, calls finishScan again
      return
    }
    if (err) {
      // count every colour we ended up with: a valid cube has EXACTLY 9 of each.
      // Whatever is over/under is precisely what the AI confused — show it so the
      // fix is obvious instead of a blind "try again".
      const cnt: {[l: string]: number} = {U: 0, D: 0, F: 0, B: 0, R: 0, L: 0}
      for (const f in this.faceLetters)
        for (const l of this.faceLetters[f]) cnt[l] = (cnt[l] || 0) + 1
      const off = ["U", "D", "F", "B", "R", "L"].filter((l) => cnt[l] !== 9)
      const note = off.map((l) => this.t("c" + l) + " " + cnt[l]).join(", ")
      print("CubeScanner: scan rejected (" + err + ") counts " + JSON.stringify(cnt) +
        " | " + ["U", "D", "F", "B", "R", "L"].map(
          (f) => f + ":" + (this.faceLetters[f] || []).join("")).join(" "))
      // instead of wiping everything, drop ONLY the shakiest face and ask
      // for it again — restarting all six for one bad read was maddening
      if (this.refaceTries < 3) {
        let worst: string | null = null, worstS = -1
        for (const l in this.lastSuspicion) {
          if (this.lastSuspicion[l] > worstS) { worstS = this.lastSuspicion[l]; worst = l }
        }
        // AI path has no per-cell suspicion: fall back to a face whose colour
        // count is off (that's where a sticker was mis-read).
        if (!worst && off.length) worst = off[0]
        if (worst) {
          this.refaceTries++
          delete this.samplesByLetter[worst]
          delete this.faceLetters[worst]
          this.facesDone[worst] = false
          this.doneCount = 5
          this.viewLetter = null
          this.stableCount = 0
          this.lastPattern = ""
          this.captureCooldown = 1.0
          this.cube!.clearScanTilesOfFace(FACE_DEF[worst].n)
          this.askingFor = worst
          let line = this.fmt(this.t("reface"), {c: this.t("c" + worst)})
          if (note) line += "\n" + this.fmt(this.t("countBad"), {n: note})
          print("CubeScanner: re-asking face " + worst + " (suspicion " + worstS + ", try " + this.refaceTries + ")")
          this.setInfo(line)
          // key "" caches by the exact text: re-asking RED then BLUE must not
          // replay the RED audio over the BLUE line
          this.tutor!.coachSay(line, "")
          this.cube!.orientForScan(worst, FACE_DEF[worst].up)
          return
        }
      }
      this.refaceTries = 0
      // start over with a tip; the window stays up — and the failure is
      // shown IN the scan window too (device has no voice: text only)
      this.samplesByLetter = {}
      this.faceLetters = {}
      this.facesDone = {}
      this.doneCount = 0
      this.viewLetter = null
      this.cube!.clearScanTiles()
      this.askingFor = "F"
      this.triedFullAI = false // a fresh six-face round earns a fresh AI pass
      this.tutor!.coachSay(this.t("fail"), "scanFail")
      this.setInfo(note ? this.t("fail") + "\n" + this.fmt(this.t("countBad"), {n: note})
        : this.t("fail"))
      // the window stays on the failure line until the voice moves on to
      // "show me the GREEN face", then flips together with the cube's turn
      this.tutor!.coachSay(this.showFaceLine("F"), "scanShowF", () => {
        if (!this.scanning) return
        this.cube!.orientForScan("F", FACE_DEF["F"].up)
        this.setInfo(this.showFaceLine("F") + "\n" + this.t("tapWhenReady"))
      })
      return
    }
    this.refaceTries = 0
    this.cube!.clearScanTiles()
    this.cube!.setScanDim(false)
    // green faces the viewer for learning — the default (far-side) view showed
    // every face left-right-swapped against the real cube in hand
    this.cube!.orientForLearn()
    this.tutor!.setFollowFrozen(false) // gentle head-follow comes back
    this.teardownScanUI()
    this.scanning = false
    this.tutor!.coachSay(this.t("done"), "scanDone")
    this.tutor!.startLessonFromScan()
    print("CubeScanner: scan applied — lesson started on the real cube's state")
  }

  private cancelScan() {
    this.stillLetter = null
    this.shotPending = false
    this.cube!.clearScanTiles()
    this.cube!.setScanDim(false)
    this.cube!.clearScanOrient()
    this.tutor!.setFollowFrozen(false)
    this.teardownScanUI()
    this.scanning = false
  }

  // The 9 cell colors from an arbitrary (hi-res) texture: same fixed grid as
  // the guide square, but with patches ~3x wider than the live feed's.
  private sampleCellsFrom(tex: Texture, frac: number): number[][] | null {
    try {
      const snap = ProceduralTextureProvider.createFromTexture(tex)
      const ctrl = snap.control as ProceduralTextureProvider
      const w = snap.getWidth(), h = snap.getHeight()
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2)
      const side = Math.floor(Math.min(w, h) * frac)
      const pitch = Math.floor(side / 3)
      const patch = Math.min(31, Math.max(9, Math.floor(pitch * 0.22)))
      const data = new Uint8Array(patch * patch * 4)
      const readPatch = (px: number, py: number): number[] => {
        const half = Math.floor(patch / 2)
        px = Math.max(half, Math.min(w - half - 1, px))
        py = Math.max(half, Math.min(h - half - 1, py))
        ctrl.getPixels(px - half, py - half, patch, patch, data)
        const pix: number[][] = []
        for (let i = 0; i < patch * patch; i++) {
          pix.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
        }
        pix.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))
        const from = Math.floor(pix.length * 0.2), to = Math.ceil(pix.length * 0.8)
        let sr = 0, sg = 0, sb = 0
        for (let i = from; i < to; i++) { sr += pix[i][0]; sg += pix[i][1]; sb += pix[i][2] }
        const n = Math.max(1, to - from)
        const mr = sr / n, mg = sg / n, mb = sb / n
        let v = 0
        for (let i = from; i < to; i++) {
          const dl = (pix[i][0] + pix[i][1] + pix[i][2]) / 3 - (mr + mg + mb) / 3
          v += dl * dl
        }
        let br = 0, bg = 0, bb = 0
        const bFrom = Math.floor(pix.length * 0.7)
        const bn = Math.max(1, pix.length - bFrom)
        for (let i = bFrom; i < pix.length; i++) { br += pix[i][0]; bg += pix[i][1]; bb += pix[i][2] }
        return [mr, mg, mb, Math.sqrt(v / n), br / bn, bg / bn, bb / bn]
      }
      // clamped gray-world balance from the still's own frame
      let ar = 0, ag = 0, ab = 0, an = 0
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 5; gx++) {
        const q = readPatch(Math.floor(w * (gx + 0.5) / 5), Math.floor(h * (gy + 0.5) / 5))
        ar += q[0]; ag += q[1]; ab += q[2]; an++
      }
      ar /= an; ag /= an; ab /= an
      const lum = (ar + ag + ab) / 3
      const cg = (k: number): number => Math.max(0.85, Math.min(1.2, k))
      const kr = cg(lum / Math.max(20, ar)), kg = cg(lum / Math.max(20, ag)), kb = cg(lum / Math.max(20, ab))
      const cells: number[][] = []
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const dx = Math.floor((c - 1) * pitch * 0.92)
          const dy = Math.floor((r - 1) * pitch * 0.92)
          cells.push(readPatch(cx + dx, cy - dy))
        }
      }
      this.fixBrandedCenter(cells)
      this.lastStillNoise = cells.map((q) => q[3])
      return cells.map((q) => [
        Math.min(255, q[0] * kr), Math.min(255, q[1] * kg), Math.min(255, q[2] * kb)])
    } catch (e) {
      print("CubeScanner: hi-res sampling failed (" + e + ")")
      return null
    }
  }

  // --- pixels ------------------------------------------------------------------

  // Read the 9 cell colors of the face in view. Three robustness layers:
  //   - TRIMMED patch mean: within each patch, glare and shadow pixels are
  //     discarded before averaging (shiny plastic loves specular highlights)
  //   - MULTI-SCALE: the grid is tried at four sizes and the one with the
  //     strongest dark-separator evidence wins — the cube no longer has to
  //     be glued to the camera to fill the guide square
  //   - GRAY-WORLD white balance: the light's color cast (warm indoor bulbs
  //     tint white stickers yellow) is estimated from the whole frame and
  //     removed, so hue classification sees honest colors
  private sampleGrid(): number[][] | null {
    try {
      const snap = ProceduralTextureProvider.createFromTexture(this.camTex!)
      const ctrl = snap.control as ProceduralTextureProvider
      const w = snap.getWidth(), h = snap.getHeight()
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2)
      const data = new Uint8Array(27 * 27 * 4) // holds up to a 25px patch
      const readPatch = (px: number, py: number, patch: number): number[] => {
        const half = Math.floor(patch / 2)
        px = Math.max(half, Math.min(w - half - 1, px))
        py = Math.max(half, Math.min(h - half - 1, py))
        ctrl.getPixels(px - half, py - half, patch, patch, data)
        // trimmed mean: sort patch pixels by brightness, keep the middle 60%
        const pix: number[][] = []
        for (let i = 0; i < patch * patch; i++) {
          pix.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
        }
        pix.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))
        const from = Math.floor(pix.length * 0.2), to = Math.ceil(pix.length * 0.8)
        let sr = 0, sg = 0, sb = 0
        for (let i = from; i < to; i++) { sr += pix[i][0]; sg += pix[i][1]; sb += pix[i][2] }
        const n = Math.max(1, to - from)
        const mr = sr / n, mg = sg / n, mb = sb / n
        // internal noise: a real sticker is a FLAT color; a random patch of
        // room has edges and texture inside the patch
        let v = 0
        for (let i = from; i < to; i++) {
          const dl = (pix[i][0] + pix[i][1] + pix[i][2]) / 3 - (mr + mg + mb) / 3
          v += dl * dl
        }
        // bright-fraction mean (top 30%): on a BRANDED center sticker the
        // logo darkens the middle, but the brightest pixels are the true color
        let br = 0, bg = 0, bb = 0
        const bFrom = Math.floor(pix.length * 0.7)
        const bn = Math.max(1, pix.length - bFrom)
        for (let i = bFrom; i < pix.length; i++) { br += pix[i][0]; bg += pix[i][1]; bb += pix[i][2] }
        return [mr, mg, mb, Math.sqrt(v / n), br / bn, bg / bn, bb / bn]
      }

      // CLAMPED white balance: estimate the cast from a coarse full-frame
      // sweep, but cap the per-channel gains — full gray-world desaturated
      // real sticker colors whenever the cube filled the frame (device logs
      // showed entire faces reading as "white")
      let ar = 0, ag = 0, ab = 0, an = 0
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          const p = readPatch(Math.floor(w * (gx + 0.5) / 5), Math.floor(h * (gy + 0.5) / 5), 9)
          ar += p[0]; ag += p[1]; ab += p[2]; an++
        }
      }
      ar /= an; ag /= an; ab /= an
      const lum = (ar + ag + ab) / 3
      const clampGain = (k: number): number => Math.max(0.85, Math.min(1.2, k))
      const kr = clampGain(lum / Math.max(20, ar))
      const kg = clampGain(lum / Math.max(20, ag))
      const kb = clampGain(lum / Math.max(20, ab))
      const balance = (c: number[]): number[] => [
        Math.min(255, c[0] * kr), Math.min(255, c[1] * kg), Math.min(255, c[2] * kb)]

      // a gap is a THIN dark line: probe with small patches, sweeping
      // perpendicular to the line, and keep the darkest reading
      const sepProbe = (px: number, py: number, sweepX: boolean, pitch: number): number => {
        let mn = 255
        const d = Math.max(2, Math.floor(pitch * 0.14))
        for (const off of [-d, 0, d]) {
          const p = readPatch(px + (sweepX ? off : 0), py + (sweepX ? 0 : off), 3)
          const l = (p[0] + p[1] + p[2]) / 3
          if (l < mn) mn = l
        }
        return mn
      }

      // FIXED grid, exactly matching the on-screen guide square: the user
      // aligns the face to the square. (Multi-scale guessing keyed on dark
      // gaps failed on cubes with faint gaps — device logs showed correct
      // centers but chaotic outer cells: the grid kept changing size.)
      const side = Math.floor(Math.min(w, h) * 0.55)
      const pitch = Math.floor(side / 3)
      // patch scales with resolution: a bigger, cleaner average per sticker
      // (was a fixed 9px — tiny and noisy at 1024) while staying inside the cell
      const gp = Math.max(11, Math.min(25, Math.floor(pitch * 0.14)))
      const cells: number[][] = []
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          // getPixels origin is bottom-left: image row 0 (top) = high y.
          // 0.92: patches sit INSIDE their sticker even with slight misalignment
          const dx = Math.floor((c - 1) * pitch * 0.92)
          const dy = Math.floor((r - 1) * pitch * 0.92)
          cells.push(readPatch(cx + dx, cy - dy, gp))
        }
      }
      // gaps between the center sticker and its 4 neighbors (vertical lines
      // left/right of center: sweep in x; horizontal lines above/below: in y)
      const hp = Math.floor(pitch / 2)
      this.lastSeps = [
        sepProbe(cx - hp, cy, true, pitch), sepProbe(cx + hp, cy, true, pitch),
        sepProbe(cx, cy - hp, false, pitch), sepProbe(cx, cy + hp, false, pitch)
      ]
      this.fixBrandedCenter(cells)
      this.lastNoise = cells.map((c) => c[3])
      this.lastStillNoise = this.lastNoise
      // ring just OUTSIDE the guide square: when a real cube fills the square,
      // this is background/hands (different); when a wall fills the frame,
      // outside looks exactly like inside — the core cube-presence signal
      const ro = Math.floor(side * 0.72)
      this.lastOutside = [
        readPatch(cx - ro, cy, 11), readPatch(cx + ro, cy, 11),
        readPatch(cx, cy - ro, 11), readPatch(cx, cy + ro, 11)
      ].map(balance)
      return cells.map(balance)
    } catch (e) {
      print("CubeScanner: pixel read failed (" + e + ")")
      return null
    }
  }

  // A brand logo printed on the CENTER sticker (like hers: a colorful logo on
  // the white center) poisons the sampled color: high internal noise, muddy
  // mean. Signature and cure: if the center patch is NOISY, its trimmed mean
  // is not strongly saturated, and its BRIGHTEST pixels are near-white, then
  // the sticker is white and the logo was the noise. Guards keep glare on a
  // colored center (saturated trimmed mean) from sneaking in.
  private fixBrandedCenter(cells: number[][]) {
    const c4 = cells[4]
    if (!c4 || c4.length < 7) return
    // relative noise: the logo'd center is visibly busier than the face's
    // other stickers, even when absolute noise is low in dim light
    const others: number[] = []
    for (let i = 0; i < 9; i++) {
      if (i !== 4 && cells[i] && cells[i].length > 3) others.push(cells[i][3])
    }
    others.sort((a, b) => a - b)
    const medianOut = others.length > 0 ? others[Math.floor(others.length / 2)] : 0
    const noisy = c4[3] >= 10 || (c4[3] >= 7 && c4[3] > medianOut * 2.2)
    if (!noisy) return
    const tmx = Math.max(c4[0], c4[1], c4[2]), tmn = Math.min(c4[0], c4[1], c4[2])
    const tSat = tmx === 0 ? 0 : (tmx - tmn) / tmx
    if (tSat > 0.55) return // strongly colored sticker: glare, not a logo
    const bmx = Math.max(c4[4], c4[5], c4[6]), bmn = Math.min(c4[4], c4[5], c4[6])
    const bSat = bmx === 0 ? 0 : (bmx - bmn) / bmx
    const bBright = (c4[4] + c4[5] + c4[6]) / 3
    if (bSat < 0.34 && bBright > 50) {
      print("CubeScanner: branded center detected (noise=" + c4[3].toFixed(0) +
        " medianOut=" + medianOut.toFixed(0) + ") — using bright fraction " +
        Math.round(c4[4]) + "," + Math.round(c4[5]) + "," + Math.round(c4[6]))
      // definitively white: push it to a clean bright white so both the live
      // classifier and the final reference see an unambiguous center
      const lift = Math.max(1, 190 / Math.max(1, bBright))
      c4[0] = Math.min(255, c4[4] * lift)
      c4[1] = Math.min(255, c4[5] * lift)
      c4[2] = Math.min(255, c4[6] * lift)
      c4[3] = 0 // treated as a clean flat sticker from here on
    }
  }

  // --- final color classification ----------------------------------------------

  // Chromaticity + brightness feature: robust to overall lighting level.
  private feature(rgb: number[]): number[] {
    const sum = Math.max(1, rgb[0] + rgb[1] + rgb[2])
    return [255 * rgb[0] / sum, 255 * rgb[1] / sum, 255 * rgb[2] / sum, (sum / 3) * 0.35]
  }

  private dist(a: number[], b: number[]): number {
    let s = 0
    for (let i = 0; i < 4; i++) s += (a[i] - b[i]) * (a[i] - b[i])
    return s
  }

  // GLOBAL color assignment: each photo has its own exposure, so per-cell
  // nearest-center voting drifted badly (logs: 14 oranges, 6 yellows). Now the
  // 48 outer cells are assigned to colors ALL AT ONCE, cheapest matches first,
  // under the hard rule "exactly 9 stickers of each color" — ambiguous cells
  // get decided by the global picture, not in isolation. Comparison is nearly
  // pure CHROMA: brightness differences between shots stop mattering.
  private lastLetters: {[l: string]: string[]} = {}

  private featureChroma(rgb: number[]): number[] {
    const sum = Math.max(1, rgb[0] + rgb[1] + rgb[2])
    return [255 * rgb[0] / sum, 255 * rgb[1] / sum, 255 * rgb[2] / sum, (sum / 3) * 0.12]
  }

  private classifyGlobal(): boolean {
    const letters6 = ["U", "D", "F", "B", "R", "L"]
    for (const l of letters6) if (!this.samplesByLetter[l]) return false
    const refs: number[][] = []
    for (const l of letters6) refs.push(this.featureChroma(this.samplesByLetter[l][4]))

    // every (outer cell, color) pairing with its cost
    const cand: {face: number, cell: number, color: number, d: number}[] = []
    const feats: number[][][] = []
    for (let fi = 0; fi < 6; fi++) {
      feats.push([])
      for (let j = 0; j < 9; j++) {
        const f = this.featureChroma(this.samplesByLetter[letters6[fi]][j])
        feats[fi].push(f)
        if (j === 4) continue
        for (let k = 0; k < 6; k++) {
          cand.push({face: fi, cell: j, color: k, d: this.dist(f, refs[k])})
        }
      }
    }
    cand.sort((a, b) => a.d - b.d)

    const counts = [1, 1, 1, 1, 1, 1] // each center is its own color already
    const assigned: number[][] = [[], [], [], [], [], []]
    for (let fi = 0; fi < 6; fi++) for (let j = 0; j < 9; j++) assigned[fi].push(-1)
    for (let fi = 0; fi < 6; fi++) assigned[fi][4] = fi
    let placed = 6
    for (const c of cand) {
      if (placed >= 54) break
      if (assigned[c.face][c.cell] >= 0 || counts[c.color] >= 9) continue
      assigned[c.face][c.cell] = c.color
      counts[c.color]++
      placed++
    }

    // per-face suspicion: cells whose GLOBAL assignment beat their local favorite
    this.lastSuspicion = {}
    this.lastLetters = {}
    for (let fi = 0; fi < 6; fi++) {
      const l = letters6[fi]
      this.lastSuspicion[l] = 0
      const out: string[] = []
      for (let j = 0; j < 9; j++) {
        const col = assigned[fi][j]
        out.push(letters6[col >= 0 ? col : fi])
        if (j === 4 || col < 0) continue
        let best = 0, bestD = Number.MAX_VALUE
        for (let k = 0; k < 6; k++) {
          const d = this.dist(feats[fi][j], refs[k])
          if (d < bestD) { bestD = d; best = k }
        }
        if (best !== col) this.lastSuspicion[l]++
      }
      this.lastLetters[l] = out
      print("CubeScanner: face " + l + " assigned: " + out.join("") +
        " suspicion=" + this.lastSuspicion[l])
    }
    return true
  }

  // Facelets from the assigned letters. Optionally reinterpret the whole image
  // mirrored (flipH/flipV) and/or ONE face rotated in 90° steps — people do
  // hold a face turned the wrong way, and that is recoverable.
  private buildFacelets(flipH: boolean, flipV: boolean, rotLetter: string | null,
    rotSteps: number): {pos: number[], dir: number[], letter: string}[] {
    const out: {pos: number[], dir: number[], letter: string}[] = []
    for (const l in this.lastLetters) {
      for (let cell = 0; cell < 9; cell++) {
        let row = Math.floor(cell / 3), col = cell % 3
        if (l === rotLetter) {
          for (let s = 0; s < rotSteps; s++) {
            const nr = col, nc = 2 - row // 90° clockwise
            row = nr; col = nc
          }
        }
        if (flipV) row = 2 - row
        if (flipH) col = 2 - col
        const cd = this.cellPosDir(l, row * 3 + col)
        out.push({pos: cd.pos, dir: cd.dir, letter: this.lastLetters[l][cell]})
      }
    }
    return out
  }

  // --- UI ----------------------------------------------------------------------

  private buildScanUI() {
    if (this.uiRoot) return
    const rig = this.tutor!.getRig()
    const root = global.scene.createSceneObject("ScanWindow")
    // WORLD-anchored: the window does NOT follow the head — scanning needs a
    // still target. It spawns just left of the stage and then stays put; the
    // grey bar underneath lets you grab it and place it wherever you like.
    if (rig) {
      const rt = rig.getTransform()
      root.getTransform().setWorldPosition(
        rt.getWorldPosition().add(rt.getWorldRotation().multiplyVec3(new vec3(-24, 2, 0))))
      root.getTransform().setWorldRotation(
        rt.getWorldRotation().multiply(quat.angleAxis(18 * Math.PI / 180, vec3.up())))
    } else {
      root.setParent(this.sceneObject)
      root.getTransform().setLocalPosition(new vec3(-24, 2, -40))
    }
    this.uiRoot = root
    this.buildWindowFrame(root) // floating panel you can pinch anywhere to move
    this.buildWindowHandle(root)

    // the camera feed
    const feedObj = global.scene.createSceneObject("Feed")
    feedObj.setParent(root)
    feedObj.getTransform().setLocalScale(new vec3(this.previewSize * 1.33, this.previewSize, 1))
    const img = feedObj.createComponent("Component.Image") as Image
    const mat = this.cube!.baseMaterial.clone()
    img.mainMaterial = mat
    try {
      mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
      mat.mainPass.baseTex = this.camTex
    } catch (e) {
      print("CubeScanner: preview image failed (" + e + ")")
    }

    // the guide square (4 thin bars marking the sampled central region)
    const gs = this.previewSize * 0.55
    this.guideBarMats = []
    const bar = (x: number, y: number, w: number, h: number) => {
      const o = global.scene.createSceneObject("GuideBar")
      o.setParent(root)
      o.getTransform().setLocalPosition(new vec3(x, y, 0.5))
      o.getTransform().setLocalScale(new vec3(w, h, 0.1))
      const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = this.cube!.boxMesh
      const m = this.cube!.baseMaterial.clone()
      m.mainPass.baseColor = new vec4(1, 1, 1, 0.85)
      rmv.mainMaterial = m
      this.guideBarMats.push(m)
    }
    bar(0, gs / 2, gs, 0.35)
    bar(0, -gs / 2, gs, 0.35)
    bar(-gs / 2, 0, 0.35, gs)
    bar(gs / 2, 0, 0.35, gs)

    // instruction text above the window
    const txtObj = global.scene.createSceneObject("ScanInfo")
    txtObj.setParent(root)
    txtObj.getTransform().setLocalPosition(new vec3(0, this.previewSize * 0.72, 0.5))
    txtObj.getTransform().setLocalScale(new vec3(0.5, 0.5, 0.5))
    this.infoText = txtObj.createComponent("Component.Text") as Text
    this.infoText.size = 48
    if (this.labelFont) this.infoText.font = this.labelFont

    // 3x3 REVIEW swatches beside the feed: the colours the AI read for this
    // face. Tap any wrong one to cycle its colour; the centre is locked (it is
    // the face's own colour). This is how the user fixes a single bad sticker
    // instead of re-scanning everything.
    this.swatches = []
    const sw = this.previewSize * 0.13
    const gx = -this.previewSize * 0.98 // left of the feed, so it never overlaps
    for (let i = 0; i < 9; i++) {
      const col = i % 3, row = Math.floor(i / 3)
      const o = global.scene.createSceneObject("Swatch" + i)
      o.setParent(root)
      o.getTransform().setLocalPosition(
        new vec3(gx + (col - 1) * sw * 1.25, (1 - row) * sw * 1.25, 0.5))
      o.getTransform().setLocalScale(new vec3(sw, sw, 0.1))
      const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = this.cube!.boxMesh
      const m = this.cube!.baseMaterial.clone()
      m.mainPass.baseColor = new vec4(0.2, 0.2, 0.22, 1)
      rmv.mainMaterial = m
      this.swatches.push(rmv)
      if (i !== 4) { // centre is the face colour — not editable
        const body = o.createComponent("Physics.BodyComponent") as BodyComponent
        body.dynamic = false
        const shape = Shape.createBoxShape()
        shape.size = new vec3(sw, sw, 2)
        body.shape = shape
        const inter = o.createComponent(Interactable.getTypeName()) as any
        inter.targetingMode = TargetingMode.All
        const idx = i
        inter.onInteractorTriggerEnd.add(() => this.cycleSwatch(idx))
      }
    }

    // Capture (read this face) + Confirm (bank the reviewed face) + Cancel.
    // Each uses per-language artwork (square); falls back to a text plate if the
    // matching texture isn't assigned in the Inspector.
    this.makeButtonIn(root, this.t("capture"), this.captureTex(),
      new vec3(0, -this.previewSize * 0.85, 1), 12, () => this.captureFace())
    this.confirmButton = this.makeButtonIn(root, this.t("confirmBtn"), this.confirmTex(),
      new vec3(-this.previewSize * 0.92, -this.previewSize * 0.85, 1), 10, () => this.confirmFace())
    if (this.confirmButton) this.confirmButton.enabled = false
    this.makeButtonIn(root, this.t("cancel"), this.cancelTex(),
      new vec3(this.previewSize * 0.92, -this.previewSize * 0.85, 1), 9, () => this.cancelScan())
  }

  // A floating glass panel BEHIND the scan area. Pinch it ANYWHERE to move the
  // whole window (not only the grey bar). It sits behind the buttons so their
  // taps still land, and it visually reads as one floating card that closes
  // when the scan ends (the whole window is destroyed in teardownScanUI).
  private buildWindowFrame(root: SceneObject) {
    const frame = global.scene.createSceneObject("ScanFrame")
    frame.setParent(root)
    const cx = -this.previewSize * 0.1, cy = this.previewSize * 0.12
    const fw = this.previewSize * 2.35, fh = this.previewSize * 1.5
    frame.getTransform().setLocalPosition(new vec3(cx, cy, -0.8)) // behind the content
    frame.getTransform().setLocalScale(new vec3(fw, fh, 0.3))
    const rmv = frame.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.handleMesh ? this.handleMesh : this.cube!.boxMesh
    const m = this.cube!.baseMaterial.clone()
    m.mainPass.blendMode = BlendMode.Normal
    m.mainPass.baseColor = new vec4(0.10, 0.11, 0.16, 0.5) // floating dark glass
    rmv.mainMaterial = m
    const body = frame.createComponent("Physics.BodyComponent") as BodyComponent
    body.dynamic = false
    const shape = Shape.createBoxShape()
    shape.size = new vec3(fw, fh, 2)
    body.shape = shape
    const inter = frame.createComponent(Interactable.getTypeName()) as any
    inter.targetingMode = TargetingMode.All
    inter.onInteractorTriggerStart.add((ev: any) => {
      this.winInteractor = ev.interactor
      this.lastWinPos = ev.interactor.startPoint
      this.winLostT = 0
    })
    const release = (ev: any) => {
      if (ev.interactor !== this.winInteractor) return
      this.winInteractor = null
      this.lastWinPos = null
    }
    inter.onInteractorTriggerEnd.add(release)
    inter.onInteractorTriggerEndOutside.add(release)
  }

  // The grey bar under the window: grab it to move the WHOLE scan window.
  private winInteractor: any = null
  private lastWinPos: vec3 | null = null
  private winLostT: number = 0

  private buildWindowHandle(root: SceneObject) {
    const bar = global.scene.createSceneObject("ScanWindowHandle")
    bar.setParent(root)
    bar.getTransform().setLocalPosition(new vec3(0, -this.previewSize * 1.02, 1))

    const plate = global.scene.createSceneObject("Bar")
    plate.setParent(bar)
    const mat = this.cube!.baseMaterial.clone()
    if (this.handleTexture) {
      plate.getTransform().setLocalScale(new vec3(12, 3.6, 1))
      const img = plate.createComponent("Component.Image") as Image
      img.mainMaterial = mat
      try {
        mat.mainPass.blendMode = BlendMode.Normal
        mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
        mat.mainPass.baseTex = this.handleTexture
      } catch (e) {
        print("CubeScanner: handle image failed (" + e + ")")
      }
    } else {
      plate.getTransform().setLocalScale(new vec3(8, 1.4, 1))
      const rmv = plate.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = this.handleMesh ? this.handleMesh : this.cube!.boxMesh
      mat.mainPass.blendMode = BlendMode.Normal
      mat.mainPass.baseColor = new vec4(1.0, 1.0, 1.0, 0.4)
      rmv.mainMaterial = mat
    }

    const body = bar.createComponent("Physics.BodyComponent") as BodyComponent
    body.dynamic = false
    const shape = Shape.createBoxShape()
    shape.size = new vec3(10, 3.5, 3)
    body.shape = shape

    const inter = bar.createComponent(Interactable.getTypeName()) as any
    inter.targetingMode = TargetingMode.All
    inter.onInteractorTriggerStart.add((ev: any) => {
      this.winInteractor = ev.interactor
      this.lastWinPos = ev.interactor.startPoint
      this.winLostT = 0
    })
    const release = (ev: any) => {
      if (ev.interactor !== this.winInteractor) return
      this.winInteractor = null
      this.lastWinPos = null
    }
    inter.onInteractorTriggerEnd.add(release)
    inter.onInteractorTriggerEndOutside.add(release)
  }

  private updateWindowDrag(dt: number) {
    if (!this.winInteractor || !this.uiRoot) return
    const pos: vec3 | null = this.winInteractor.startPoint
    if (!pos) {
      // hand tracking lost mid-drag: release after a moment, window stays put
      this.winLostT += dt
      if (this.winLostT > 0.4) { this.winInteractor = null; this.lastWinPos = null }
      return
    }
    this.winLostT = 0
    if (this.lastWinPos) {
      const t = this.uiRoot.getTransform()
      t.setWorldPosition(t.getWorldPosition().add(pos.sub(this.lastWinPos)))
    }
    this.lastWinPos = pos
  }

  // Keep the scan window FACING the user wherever it is dragged (billboarding).
  // Points the window's front (+z, where the feed/buttons live) straight at the
  // camera. The rig is frozen during a scan, so we aim at the live camera
  // position, not the rig — yaw only, like the head-follow, so it never tips.
  private billboardWindow() {
    if (!this.uiRoot) return
    const camPos = this.tutor!.getCameraPos()
    if (!camPos) return
    const t = this.uiRoot.getTransform()
    const d = camPos.sub(t.getWorldPosition())
    if (d.x * d.x + d.z * d.z < 1) return
    const yaw = Math.atan2(d.x, d.z)
    t.setWorldRotation(quat.angleAxis(yaw, vec3.up()))
  }

  private teardownScanUI() {
    this.winInteractor = null
    this.lastWinPos = null
    this.guideBarMats = []
    this.pendingFace = null
    this.confirmButton = null
    if (this.uiRoot) {
      this.uiRoot.enabled = false
      this.cleanupQueue.push(this.uiRoot) // destroy next frame, not mid-touch
      this.uiRoot = null
      this.infoText = null
      this.swatches = []
    }
  }

  private guideBarMats: Material[] = []

  // Green frame = "I can see your cube"; white = still looking for it.
  private setGuideColor(found: boolean) {
    const c = found ? new vec4(0.25, 1, 0.45, 0.95) : new vec4(1, 1, 1, 0.85)
    for (const m of this.guideBarMats) m.mainPass.baseColor = c
  }

  private setInfo(s: string) {
    if (this.infoText) this.infoText.text = s
  }

  private showSwatches(rgb: number[][]) {
    for (let i = 0; i < 9 && i < this.swatches.length; i++) {
      this.swatches[i].mainMaterial.mainPass.baseColor =
        new vec4(rgb[i][0] / 255, rgb[i][1] / 255, rgb[i][2] / 255, 1)
    }
  }

  private flashInfoOnButton(s: string) {
    // no window up: show the message on a temporary floating text
    const rig = this.tutor!.getRig()
    const o = global.scene.createSceneObject("ScanMsg")
    o.setParent(rig ? rig : this.sceneObject)
    o.getTransform().setLocalPosition(new vec3(0, -18, -12))
    o.getTransform().setLocalScale(new vec3(0.5, 0.5, 0.5))
    const txt = o.createComponent("Component.Text") as Text
    txt.text = s
    txt.size = 48
    if (this.labelFont) txt.font = this.labelFont
    const ev = this.createEvent("DelayedCallbackEvent")
    ev.bind(() => o.destroy())
    ;(ev as any).reset(3)
  }

  // --- buttons (same pattern as the tutor's) -----------------------------------

  private makeButton(label: string, tex: Texture | null, pos: vec3, size: number,
    onPress: () => void): SceneObject | null {
    const rig = this.tutor!.getRig()
    if (!rig) return null
    return this.makeButtonIn(rig, label, tex, pos, size, onPress)
  }

  private makeButtonIn(parent: SceneObject, label: string, tex: Texture | null,
    pos: vec3, size: number, onPress: () => void): SceneObject {
    const root = global.scene.createSceneObject("ScanBtn_" + label)
    root.setParent(parent)
    root.getTransform().setLocalPosition(pos)
    let w = 13, h = 4.5
    if (tex) {
      w = size; h = size
      const imgObj = global.scene.createSceneObject("Img")
      imgObj.setParent(root)
      imgObj.getTransform().setLocalScale(new vec3(w, h, 1))
      const img = imgObj.createComponent("Component.Image") as Image
      const mat = this.cube!.baseMaterial.clone()
      img.mainMaterial = mat
      try {
        mat.mainPass.blendMode = BlendMode.Normal
        mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
        mat.mainPass.baseTex = tex
      } catch (e) {
        print("CubeScanner: button image failed (" + e + ")")
      }
    } else {
      const plate = global.scene.createSceneObject("Plate")
      plate.setParent(root)
      plate.getTransform().setLocalScale(new vec3(13, 4.5, 1.2))
      const rmv = plate.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = this.cube!.boxMesh
      const mat = this.cube!.baseMaterial.clone()
      mat.mainPass.baseColor = new vec4(0.55, 0.2, 0.7, 1) // scan = violet family
      rmv.mainMaterial = mat
      const textObj = global.scene.createSceneObject("Label")
      textObj.setParent(root)
      textObj.getTransform().setLocalPosition(new vec3(0, 0, 1.0))
      textObj.getTransform().setLocalScale(new vec3(0.5, 0.5, 0.5))
      const txt = textObj.createComponent("Component.Text") as Text
      txt.text = label
      txt.size = 48
      if (this.labelFont) txt.font = this.labelFont
    }
    const body = root.createComponent("Physics.BodyComponent") as BodyComponent
    body.dynamic = false
    const shape = Shape.createBoxShape()
    shape.size = new vec3(w, h, 3)
    body.shape = shape
    const inter = root.createComponent(Interactable.getTypeName()) as any
    inter.targetingMode = TargetingMode.All
    inter.onInteractorTriggerEnd.add(() => onPress())
    return root
  }
}
