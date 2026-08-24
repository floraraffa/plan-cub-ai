// CubeTutor — voice coach for the cube (Lens Studio SPECTACLES 5.15).
// Listens (ASR, understands Spanish AND English command words), speaks (TTS,
// English voices only) and shows the same line on a floating panel above the cube.
//
// Voice commands:
//   "mezcla" / "scramble" / "shuffle"      -> shuffle the cube (12 animated moves)
//   "enséñame" / "tutorial" / "teach me"   -> start the guided lesson
//   "pista" / "hint" / "ayuda" / "help"    -> hint for the current stage
//   "reinicia" / "reset" / "solve"         -> back to the solved cube
//
// The lesson follows the layer method. The tutor READS the real cube state
// (CubeCoachPort derives it from the pieces) and only advances when you actually
// complete each goal — it teaches you to think, it never turns the cube for you.

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {TargetingMode} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {CubeCoachPort} from "./CubeCoachPort"
import {STRINGS, Lang, CLIP_KEYS, getLine} from "./CoachStrings"
import {OpenAI} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"

type Stage = {
  goal: string
  hints: string[]
  kind: string // which pieces to pulse-highlight (see CubeCoachPort.targetsFor)
  why: string // the reasoning behind this stage — so the student learns, not memorizes
  isDone: () => boolean
}

@component
export class CubeTutor extends BaseScriptComponent {
  @input cube: CubeCoachPort
  @input asrModule: AsrModule
  @input ttsModule: TextToSpeechModule
  @input
  @allowUndefined
  logoTexture: Texture // optional: logo, shown as splash at start
  @input
  @allowUndefined
  langImageEnglish: Texture // optional: language picker button images
  @input
  @allowUndefined
  langImageSpanish: Texture
  @input
  @allowUndefined
  langImageFrench: Texture
  @input langImageSize: number = 11 // side of each language image, cm
  // Main button images, one pair per language (optional; text buttons otherwise)
  @input
  @allowUndefined
  btnScrambleEnglish: Texture
  @input
  @allowUndefined
  btnScrambleSpanish: Texture
  @input
  @allowUndefined
  btnScrambleFrench: Texture
  @input
  @allowUndefined
  btnTeachEnglish: Texture
  @input
  @allowUndefined
  btnTeachSpanish: Texture
  @input
  @allowUndefined
  btnTeachFrench: Texture
  @input
  @allowUndefined
  btnDailyEnglish: Texture
  @input
  @allowUndefined
  btnDailySpanish: Texture
  @input
  @allowUndefined
  btnDailyFrench: Texture
  @input buttonImageSize: number = 14 // cm — button images are square (1:1)
  @input
  @allowUndefined
  btnUndoTexture: Texture // optional: undo button artwork (square)
  @input
  @allowUndefined
  btnRedoTexture: Texture // optional: redo button artwork (square)
  @input undoRedoSize: number = 7 // cm — side of the undo/redo buttons
  @input
  @allowUndefined
  btnHintTexture: Texture // optional: hint button artwork (square)
  // "help to solve" button artwork, one per language (square)
  @input
  @allowUndefined
  btnSolveEnglish: Texture
  @input
  @allowUndefined
  btnSolveSpanish: Texture
  @input
  @allowUndefined
  btnSolveFrench: Texture
  @input
  @allowUndefined
  handleTexture: Texture // optional: marshmallow-style artwork for the placement bar
  @input
  @allowUndefined
  handleMesh: RenderMesh // optional: assign SIK's SphereMesh for a rounded pill bar
  @input langSpacing: number = 11.5 // distance between image centers, cm
  // Voice clips per language, assigned in the EXACT order of CLIP_KEYS
  // (see CoachStrings.ts). Missing clips: English falls back to TTS, ES/FR to text.
  @input
  @allowUndefined
  clipsEnglish: AudioTrackAsset[]
  @input
  @allowUndefined
  clipsSpanish: AudioTrackAsset[]
  @input
  @allowUndefined
  clipsFrench: AudioTrackAsset[]
  @input followDistance: number = 70 // cm in front of the user (until the user re-places the stage)
  @input followSpeed: number = 3 // higher = snappier head-follow
  @input useOpenAITts: boolean = true // OpenAI voices via Remote Service Gateway (needs internet + RSG token)
  @input openAiVoice: string = "nova" // alloy | echo | fable | onyx | nova | shimmer | sage | verse

  // entrance animation + particle bursts
  private introItems: {obj: SceneObject, delay: number, dur: number, target: vec3, t: number, burst: boolean}[] = []
  private particles: {obj: SceneObject, vel: vec3, spin: vec3, life: number, maxLife: number, size: number}[] = []
  private particleMats: Material[] = []
  private sideButtonObjs: SceneObject[] = []
  private handleRoot: SceneObject | null = null
  private charObj: SceneObject | null = null
  private charMat: Material | null = null
  private charFlapT: number = 0
  private charMouthIsOpen: boolean = false
  private charBobT: number = 0
  private charExprTex: Texture | null = null
  private charExprUntil: number = 0
  private charShownTex: Texture | null = null
  private hintButton: SceneObject | null = null
  private solveButton: SceneObject | null = null
  private solveCount: number = 0
  private solvingStage: boolean = false // "help to solve" is walking the stage
  private solveMovesLeft: number = 0
  private solveKicks: number = 0 // consecutive unstick moves
  private lastCoachMove: {axis: string, layer: number, dir: number} | null = null
  private solveBaseMoves: number = 0 // user moves when the walkthrough began
  private solveSearching: boolean = false // the exact solver is thinking
  private solvePendingLine: {axis: string, layer: number, dir: number}[] = []
  private solveBestScore: number = -1 // historical best: every line must beat it

  private lang: Lang = "en"
  private langChosen: boolean = false
  private pickerObjs: SceneObject[] = []
  private mainButtonObjs: SceneObject[] = []

  private rig: SceneObject | null = null
  private camTransform: Transform | null = null
  private splashObj: SceneObject | null = null
  private splashUntil: number = 0

  private audio: AudioComponent | null = null
  private fxAudio: AudioComponent | null = null
  private musicAudio: AudioComponent | null = null
  private panelText: Text | null = null
  private panelRoot: SceneObject | null = null
  private panelSegs: {obj: SceneObject, txt: Text, line: number}[] = []
  private panelLayoutPending: number = 0 // frames left to try measuring

  private transcribing: boolean = false
  private retryCooldown: number = 0

  private lessonActive: boolean = false
  private pendingLesson: boolean = false // teach me: scramble first, lesson when done
  private stageIndex: number = 0
  private hintIndex: number = 0
  private pollTimer: number = 0
  private stages: Stage[] = []
  private flashes: {rmv: any, base: vec4, until: number}[] = []
  private now: number = 0

  // Cube IQ challenge session (free mode only; the lesson never scores)
  private statsText: Text | null = null
  private sessionActive: boolean = false
  private sessionPending: boolean = false // starts when the scramble animation ends
  private sessionStart: number = 0
  private sessionHints: number = 0
  private dailyActive: boolean = false
  private lastCheckedMoves: number = 0

  // idle nudge: if the student does nothing for a while, highlight + demonstrate
  @input idleNudgeSeconds: number = 8
  @input
  @allowUndefined
  soundRight: AudioTrackAsset // optional: short "good move" chime
  @input
  @allowUndefined
  soundWrong: AudioTrackAsset // optional: short "wrong move" buzz
  @input
  @allowUndefined
  musicTrack: AudioTrackAsset // optional: looping background music
  @input musicVolume: number = 0.3 // 0..1; ducks automatically while the coach speaks
  @input
  @allowUndefined
  coachFont: Font // rounded font, REGULAR weight — used for the coach's sentences
  @input
  @allowUndefined
  coachFontBold: Font // rounded font, BOLD weight — timers, progress and button labels
  @input
  @allowUndefined
  statsContainerTexture: Texture // marshmallow plate shown behind the timer/stats
  // Floating coach character: two full images, mouth OPEN and mouth CLOSED.
  // While the coach speaks they alternate (talk-flap); idle shows mouth closed.
  @input
  @allowUndefined
  charMouthOpen: Texture
  @input
  @allowUndefined
  charMouthClosed: Texture
  // Expression slots (all optional, square, same framing as the base pose):
  @input
  @allowUndefined
  charHappy: Texture // celebrating: good move, stage complete, solved, new record
  @input
  @allowUndefined
  charWrong: Texture // disapproving: a move broke the student's progress
  @input
  @allowUndefined
  charThinking: Texture // doubting/warning: hints, corrections, "are you sure?"
  @input
  @allowUndefined
  charWaiting: Texture // impatient/expectant: the student has been idle a while
  @input
  @allowUndefined
  charIdea: Texture // "aha!" face: shown when the student taps the hint bulb
  @input charSize: number = 15 // cm (square images)
  private idleT: number = 0
  private lastLessonMoves: number = 0
  private nudgeCount: number = 0
  private lastProgress: number = -1
  private wrongStreak: number = 0
  private skipNextEval: boolean = false // don't re-judge the auto-undo move
  private expectedMove: {axis: string, layer: number, dir: number} | null = null // the coach's current suggestion

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.setup())
    this.createEvent("UpdateEvent").bind(() => this.update())
  }

  private setup() {
    this.audio = this.sceneObject.createComponent("Component.AudioComponent") as AudioComponent
    this.fxAudio = this.sceneObject.createComponent("Component.AudioComponent") as AudioComponent
    if (this.musicTrack) {
      this.musicAudio = this.sceneObject.createComponent("Component.AudioComponent") as AudioComponent
      this.musicAudio.audioTrack = this.musicTrack
      this.musicAudio.volume = this.musicVolume
      this.musicAudio.play(-1) // loop forever
    }
    this.createFollowRig()
    this.createHandle()
    this.createPanel()
    this.createSplash()
    this.defineStages()
    this.createLanguagePicker() // pick a language to reveal all the buttons
    this.createHintButton()
    this.createCharacter()
    this.startListening() // last: voice is optional and may not exist on older OS
    this.langChosen = true // voice commands default to English until picked
    this.beginIntro()
  }

  // --- floating coach character with talk-flap mouth ---------------------------

  private createCharacter() {
    if (!this.charMouthClosed || !this.rig) return
    this.charObj = global.scene.createSceneObject("CoachCharacter")
    this.charObj.setParent(this.rig)
    // floats beside the coach text, above and to the left of the cube
    this.charObj.getTransform().setLocalPosition(new vec3(-22, 14, -20))
    this.charObj.getTransform().setLocalScale(new vec3(this.charSize, this.charSize, 1))
    const img = this.charObj.createComponent("Component.Image") as Image
    this.charMat = this.cube.baseMaterial.clone()
    img.mainMaterial = this.charMat
    try {
      this.charMat.mainPass.blendMode = BlendMode.Normal // respect PNG transparency
      this.charMat.mainPass.baseColor = new vec4(1, 1, 1, 1)
      this.charMat.mainPass.baseTex = this.charMouthClosed
    } catch (e) {
      print("CubeTutor: character texture failed (" + e + ")")
      this.charObj.destroy()
      this.charObj = null
    }
  }

  private updateCharacter(dt: number) {
    if (!this.charObj || !this.charMat) return
    // gentle idle float: bob + tiny sway
    this.charBobT += dt
    const t = this.charObj.getTransform()
    const bobY = Math.sin(this.charBobT * 1.6) * 1.2
    const swayR = Math.sin(this.charBobT * 0.9) * 0.06
    t.setLocalPosition(new vec3(-22, 14 + bobY, -20))
    t.setLocalRotation(quat.angleAxis(swayR, vec3.forward()))

    // While an expression is active the face HOLDS STILL — no mouth flapping,
    // no squash — so the emotion reads clearly instead of vibrating.
    const exprActive = this.charExprTex !== null && this.now < this.charExprUntil
    const talking = this.audio !== null && this.audio.isPlaying()
    let desired: Texture = this.charMouthClosed

    if (exprActive) {
      desired = this.charExprTex!
      this.charMouthIsOpen = false
      t.setLocalScale(new vec3(this.charSize, this.charSize, 1))
    } else if (talking && this.charMouthOpen) {
      // talk-flap only in the neutral pose
      this.charFlapT -= dt
      if (this.charFlapT <= 0) {
        this.charMouthIsOpen = !this.charMouthIsOpen
        this.charFlapT = 0.06 + Math.random() * 0.09 // organic flapping rhythm
      }
      if (this.charMouthIsOpen) desired = this.charMouthOpen
      const squash = 1 + (this.charMouthIsOpen ? 0.025 : -0.015)
      t.setLocalScale(new vec3(this.charSize, this.charSize * squash, 1))
    } else {
      this.charMouthIsOpen = false
      t.setLocalScale(new vec3(this.charSize, this.charSize, 1))
    }

    if (desired !== this.charShownTex) {
      this.charShownTex = desired
      try { this.charMat.mainPass.baseTex = desired } catch (e) {}
    }
  }

  // Show an expression for a few seconds (falls back to base if slot is empty).
  private setExpression(tex: Texture | null, seconds: number) {
    if (!tex) return
    this.charExprTex = tex
    this.charExprUntil = this.now + seconds
  }

  // --- entrance: everything pops in with staggered bounces and confetti -------

  private beginIntro() {
    const add = (obj: SceneObject | null, delay: number, burst: boolean) => {
      if (!obj) return
      const t = obj.getTransform()
      const target = t.getLocalScale()
      t.setLocalScale(new vec3(0.001, 0.001, 0.001))
      this.introItems.push({obj: obj, delay: delay, dur: 0.85, target: target, t: 0, burst: burst})
    }
    add(this.sceneObject, 0.5, true) // the cube itself
    for (let i = 0; i < this.pickerObjs.length; i++) add(this.pickerObjs[i], 1.7 + i * 0.3, true)
    add(this.charObj, 1.3, true) // the coach makes an entrance too
    add(this.handleRoot, 2.9, false)
  }

  private easeOutBack(t: number): number {
    const c1 = 1.70158, c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  }

  private updateIntro(dt: number) {
    for (let i = this.introItems.length - 1; i >= 0; i--) {
      const it = this.introItems[i]
      if (isNull(it.obj)) { this.introItems.splice(i, 1); continue } // destroyed mid-intro
      if (it.delay > 0) { it.delay -= dt; continue }
      if (it.t === 0 && it.burst) this.spawnBurst(it.obj.getTransform().getWorldPosition())
      it.t += dt / it.dur
      const k = Math.min(it.t, 1)
      const s = this.easeOutBack(k)
      it.obj.getTransform().setLocalScale(it.target.uniformScale(Math.max(0.001, s)))
      if (k >= 1) {
        it.obj.getTransform().setLocalScale(it.target)
        this.introItems.splice(i, 1)
      }
    }
  }

  // pastel cube-confetti burst, in the logo palette
  private spawnBurst(center: vec3) {
    if (this.particleMats.length === 0) {
      const palette = [
        new vec4(0.55, 0.8, 1, 1),   // light blue
        new vec4(1, 0.85, 0.35, 1),  // yellow
        new vec4(0.8, 0.7, 1, 1),    // lavender
        new vec4(1, 1, 1, 1)         // white
      ]
      for (const c of palette) {
        const m = this.cube.baseMaterial.clone()
        m.mainPass.baseColor = c
        this.particleMats.push(m)
      }
    }
    for (let i = 0; i < 14; i++) {
      const obj = global.scene.createSceneObject("confetti")
      const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = this.cube.boxMesh
      rmv.mainMaterial = this.particleMats[i % this.particleMats.length]
      const size = 0.5 + Math.random() * 0.7
      obj.getTransform().setLocalScale(new vec3(size, size, size))
      obj.getTransform().setWorldPosition(center)
      const a = Math.random() * Math.PI * 2
      const vel = new vec3(Math.cos(a) * (5 + Math.random() * 10),
        5 + Math.random() * 9, Math.sin(a) * (5 + Math.random() * 10))
      const spin = new vec3(Math.random() * 6, Math.random() * 6, Math.random() * 6)
      const life = 1.5 + Math.random() * 0.9
      this.particles.push({obj: obj, vel: vel, spin: spin, life: life, maxLife: life, size: size})
    }
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i]
      pt.life -= dt
      if (pt.life <= 0) {
        pt.obj.destroy()
        this.particles.splice(i, 1)
        continue
      }
      const t = pt.obj.getTransform()
      pt.vel = pt.vel.add(new vec3(0, -14 * dt, 0)) // soft gravity, floaty confetti
      t.setWorldPosition(t.getWorldPosition().add(pt.vel.uniformScale(dt)))
      const r = t.getLocalRotation()
      t.setLocalRotation(quat.angleAxis(pt.spin.x * dt, vec3.up()).multiply(
        quat.angleAxis(pt.spin.y * dt, vec3.right())).multiply(r))
      const k = pt.life / pt.maxLife
      t.setLocalScale(new vec3(pt.size * k, pt.size * k, pt.size * k))
    }
  }

  // --- i18n -------------------------------------------------------------------

  private t(key: string): string {
    return STRINGS[this.lang][key]
  }

  private fmt(template: string, vars: {[k: string]: string}): string {
    let out = template
    for (const k in vars) out = out.split("{" + k + "}").join(vars[k])
    return out
  }

  // --- language picker ----------------------------------------------------------

  private createLanguagePicker() {
    const options: {lang: Lang, label: string, tex: Texture | null}[] = [
      {lang: "en", label: "English", tex: this.langImageEnglish},
      {lang: "es", label: "Español", tex: this.langImageSpanish},
      {lang: "fr", label: "Français", tex: this.langImageFrench}
    ]
    // never closer than image size + 20% air, regardless of the Inspector value
    const spacing = Math.max(this.langSpacing, this.langImageSize * 1.05)
    for (let i = 0; i < options.length; i++) {
      const o = options[i]
      const obj = this.makePickerButton(o.label, o.tex, new vec3((i - 1) * spacing, -9, 18))
      this.pickerObjs.push(obj)
      const inter = obj.getComponent(Interactable.getTypeName()) as any
      inter.onInteractorTriggerEnd.add(() => this.selectLanguage(o.lang))
    }
    // no text at startup — the images alone are the language menu
  }

  private makePickerButton(label: string, tex: Texture | null, localPos: vec3): SceneObject {
    const root = global.scene.createSceneObject("Lang_" + label)
    if (this.rig) root.setParent(this.rig)
    root.getTransform().setLocalPosition(localPos)

    if (tex) {
      const imgObj = global.scene.createSceneObject("Img")
      imgObj.setParent(root)
      imgObj.getTransform().setLocalScale(new vec3(this.langImageSize, this.langImageSize, 1))
      const img = imgObj.createComponent("Component.Image") as Image
      const mat = this.cube.baseMaterial.clone()
      img.mainMaterial = mat
      try {
        mat.mainPass.blendMode = BlendMode.Normal // respect PNG transparency
        mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
        mat.mainPass.baseTex = tex
      } catch (e) {
        print("CubeTutor: language image failed (" + e + ")")
      }
    } else {
      const plate = global.scene.createSceneObject("Plate")
      plate.setParent(root)
      plate.getTransform().setLocalScale(new vec3(12, 5, 1.2))
      const rmv = plate.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = this.cube.boxMesh
      const mat = this.cube.baseMaterial.clone()
      mat.mainPass.baseColor = new vec4(0.12, 0.3, 0.75, 1)
      rmv.mainMaterial = mat
      const textObj = global.scene.createSceneObject("Label")
      textObj.setParent(root)
      textObj.getTransform().setLocalPosition(new vec3(0, 0, 1.0))
      textObj.getTransform().setLocalScale(new vec3(0.45, 0.45, 0.45))
      const txt = textObj.createComponent("Component.Text") as Text
      txt.text = label
      txt.size = 48
      const bf2 = this.coachFontBold ? this.coachFontBold : this.coachFont
      if (bf2) txt.font = bf2
    }

    const body = root.createComponent("Physics.BodyComponent") as BodyComponent
    body.dynamic = false
    const shape = Shape.createBoxShape()
    shape.size = new vec3(Math.min(this.langImageSize, this.langSpacing), this.langImageSize, 3)
    body.shape = shape
    const inter = root.createComponent(Interactable.getTypeName()) as any
    inter.targetingMode = TargetingMode.All
    return root
  }

  private pickerCleanup: boolean = false

  private hidePicker() {
    if (this.pickerObjs.length === 0) return
    // hide now, destroy next frame (destroying mid-touch-event can crash SIK)
    for (const o of this.pickerObjs) o.enabled = false
    this.pickerCleanup = true
  }

  private selectLanguage(l: Lang) {
    this.hidePicker() // once you picked, the language row goes away
    const firstPick = this.mainButtonObjs.length === 0
    if (l === this.lang && !firstPick) return
    this.lang = l
    this.speechQueue = [] // drop queued lines from the previous language
    this.defineStages() // rebuild texts in the chosen language
    this.createButtons() // create (first pick) or swap button images/labels
    this.refreshSolveButton() // Solve artwork follows the language too
    if (firstPick) {
      this.createUndoRedoButtons()
      // all the buttons make their entrance: pop + confetti, in cascade
      const entrance = this.mainButtonObjs.concat(this.sideButtonObjs)
      for (let i = 0; i < entrance.length; i++) {
        const obj = entrance[i]
        const t = obj.getTransform()
        const target = t.getLocalScale()
        t.setLocalScale(new vec3(0.001, 0.001, 0.001))
        this.introItems.push({obj: obj, delay: 0.15 + i * 0.28, dur: 0.85, target: target, t: 0, burst: true})
      }
    }
    this.speak("greet")
    if (this.lessonActive) this.updateLessonStats()
  }

  // --- head-follow rig ----------------------------------------------------------
  // Everything (cube, buttons, panels) lives under a rig that lazily follows the
  // user's head, so the whole station stays in front of them. The cube itself is
  // still fully grabbable: holding it overrides its world transform every frame,
  // and wherever you drop it, it keeps that offset inside the rig.

  private createFollowRig() {
    try {
      this.camTransform = WorldCameraFinderProvider.getInstance().getComponent().getTransform()
    } catch (e) {
      print("CubeTutor: no camera found for head-follow (" + e + ")")
    }
    this.rig = global.scene.createSceneObject("FollowRig")
    this.rig.getTransform().setWorldPosition(this.sceneObject.getTransform().getWorldPosition())
    this.sceneObject.setParentPreserveWorldTransform(this.rig)
  }

  private chasing: boolean = false
  private heightOffset: number = -5 // stage height relative to the eyes, cm
  private followCalibrated: boolean = false

  // Placement handle: grab the bar under the cube and put the WHOLE stage
  // wherever suits your eyes (distance and height). The head-follow then
  // keeps that personal placement — every Specs calibration is different.
  private handleInteractor: any = null
  private lastHandlePos: vec3 | null = null
  private handleLostT: number = 0 // seconds without hand data mid-drag

  private updateFollow(dt: number) {
    if (!this.rig || !this.camTransform) return
    const t = this.rig.getTransform()
    const camPos = this.camTransform.getWorldPosition()

    // While the user drags the handle, the stage follows the hand directly.
    // If hand tracking is lost mid-drag (hands out of view), release after a
    // moment and LOCK the stage right where it was brought.
    if (this.handleInteractor) {
      const pos: vec3 | null = this.handleInteractor.startPoint
      if (!pos) {
        this.handleLostT += dt
        if (this.handleLostT > 0.4) this.releaseHandle()
        this.chasing = false
        return
      }
      this.handleLostT = 0
      if (this.lastHandlePos) {
        t.setWorldPosition(t.getWorldPosition().add(pos.sub(this.lastHandlePos)))
      }
      this.lastHandlePos = pos
      this.chasing = false
      return
    }

    if (!this.followCalibrated) {
      this.followCalibrated = true
      this.recalibrateFrom(camPos, t.getWorldPosition())
    }

    // Head-follow uses yaw-only forward + a personal height offset, so looking
    // up or down never drags the stage vertically.
    const fwd = this.camTransform.getWorldRotation().multiplyVec3(new vec3(0, 0, -1))
    const yawFwd = new vec3(fwd.x, 0, fwd.z).normalize()
    const target = camPos.add(yawFwd.uniformScale(this.followDistance))
      .add(new vec3(0, this.heightOffset, 0))

    // Lazy follow with a dead zone: while the station is roughly in view it stays
    // PUT (so you can look at and reach the buttons without them running away).
    const dist = target.sub(t.getWorldPosition()).length
    if (!this.chasing && dist > 30) this.chasing = true
    if (this.chasing) {
      const k = 1 - Math.exp(-this.followSpeed * dt)
      t.setWorldPosition(vec3.lerp(t.getWorldPosition(), target, k))
      const d = camPos.sub(t.getWorldPosition())
      const yaw = Math.atan2(d.x, d.z)
      t.setWorldRotation(quat.slerp(t.getWorldRotation(), quat.angleAxis(yaw, vec3.up()), k))
      if (dist < 5) this.chasing = false
    }
  }

  private recalibrateFrom(camPos: vec3, rigPos: vec3) {
    const d = rigPos.sub(camPos)
    this.followDistance = Math.max(35, Math.sqrt(d.x * d.x + d.z * d.z))
    this.heightOffset = d.y
  }

  private releaseHandle() {
    this.handleInteractor = null
    this.lastHandlePos = null
    this.handleLostT = 0
    if (this.camTransform && this.rig) {
      // lock the new personal placement: this distance/height is now "home"
      this.recalibrateFrom(this.camTransform.getWorldPosition(), this.rig.getTransform().getWorldPosition())
    }
  }

  private createHandle() {
    if (!this.rig) return
    const root = global.scene.createSceneObject("PlacementHandle")
    this.handleRoot = root
    root.setParent(this.rig)
    root.getTransform().setLocalPosition(new vec3(0, -37, 2))

    const plate = global.scene.createSceneObject("Bar")
    plate.setParent(root)
    const mat = this.cube.baseMaterial.clone()
    if (this.handleTexture) {
      // custom marshmallow artwork
      plate.getTransform().setLocalScale(new vec3(12, 3.6, 1))
      const img = plate.createComponent("Component.Image") as Image
      img.mainMaterial = mat
      try {
        mat.mainPass.blendMode = BlendMode.Normal // respect PNG transparency
        mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
        mat.mainPass.baseTex = this.handleTexture
      } catch (e) {
        print("CubeTutor: handle image failed (" + e + ")")
      }
    } else {
      plate.getTransform().setLocalScale(new vec3(8, 1.4, 1))
      const rmv = plate.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      // with SphereMesh assigned this becomes a rounded pill; box otherwise
      rmv.mesh = this.handleMesh ? this.handleMesh : this.cube.boxMesh
      // ghost bar: translucent white, soft but clearly visible
      mat.mainPass.blendMode = BlendMode.Normal
      mat.mainPass.baseColor = new vec4(1.0, 1.0, 1.0, 0.4)
      rmv.mainMaterial = mat
    }

    const body = root.createComponent("Physics.BodyComponent") as BodyComponent
    body.dynamic = false
    const shape = Shape.createBoxShape()
    shape.size = new vec3(10, 3.5, 3)
    body.shape = shape

    const inter = root.createComponent(Interactable.getTypeName()) as any
    inter.targetingMode = TargetingMode.All
    inter.onInteractorTriggerStart.add((ev: any) => {
      this.handleInteractor = ev.interactor
      this.lastHandlePos = ev.interactor.startPoint
    })
    const release = (ev: any) => {
      if (ev.interactor !== this.handleInteractor) return
      this.releaseHandle()
    }
    inter.onInteractorTriggerEnd.add(release)
    inter.onInteractorTriggerEndOutside.add(release)
  }

  // --- splash logo ----------------------------------------------------------------

  private createSplash() {
    if (!this.logoTexture || !this.rig) return
    this.splashObj = global.scene.createSceneObject("CubIQLogo")
    this.splashObj.setParent(this.rig)
    const t = this.splashObj.getTransform()
    // Starts BIG and close to the user, then flies back to become a badge.
    // Square aspect (1:1) to match the logo image.
    t.setLocalPosition(new vec3(0, 2, 28))
    t.setLocalScale(new vec3(23, 23, 1))
    const img = this.splashObj.createComponent("Component.Image") as Image
    // A runtime-created Image has no material: give it one, cloned from the cube's.
    const mat = this.cube.baseMaterial.clone()
    img.mainMaterial = mat
    try {
      mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
      mat.mainPass.baseTex = this.logoTexture
    } catch (e) {
      print("CubeTutor: could not set logo texture (" + e + "); skipping splash")
      this.splashObj.destroy()
      this.splashObj = null
      return
    }
    this.splashUntil = 0 // timer: holds close & big, then flies to the background
  }

  private updateSplash(dt: number) {
    if (!this.splashObj || this.splashUntil < 0) return
    this.splashUntil += dt
    const holdTime = 2.8 // big and close for this long...
    const flyTime = 1.8 // ...then glides to the background badge spot
    if (this.splashUntil <= holdTime) return
    const p = Math.min(1, (this.splashUntil - holdTime) / flyTime)
    const e = p * p * (3 - 2 * p) // smoothstep
    const t = this.splashObj.getTransform()
    t.setLocalPosition(vec3.lerp(new vec3(0, 2, 28), new vec3(0, 34, -45), e))
    const s = vec3.lerp(new vec3(23, 23, 1), new vec3(43, 43, 1), e)
    t.setLocalScale(s)
    if (p >= 1) this.splashUntil = -1 // done; badge stays in the background
  }

  // --- buttons ----------------------------------------------------------------

  private createButtons() {
    for (const o of this.mainButtonObjs) o.destroy()
    this.mainButtonObjs = []
    const scrambleTex = this.lang === "en" ? this.btnScrambleEnglish
      : this.lang === "es" ? this.btnScrambleSpanish : this.btnScrambleFrench
    const teachTex = this.lang === "en" ? this.btnTeachEnglish
      : this.lang === "es" ? this.btnTeachSpanish : this.btnTeachFrench
    const dailyTex = this.lang === "en" ? this.btnDailyEnglish
      : this.lang === "es" ? this.btnDailySpanish : this.btnDailyFrench
    // Wide, low and pushed back: far from the cube's manipulation space.
    // With the scanner present, all four buttons sit on ONE line.
    const P = this.scanRow
      ? [new vec3(-24, -26, -12), new vec3(-8, -26, -12), new vec3(8, -26, -12)]
      : [new vec3(-16, -24, -12), new vec3(0, -28, -12), new vec3(16, -24, -12)]
    this.mainButtonObjs.push(
      this.makeButton(this.t("scrambleBtn"), scrambleTex, P[0], () => this.startChallenge()))
    this.mainButtonObjs.push(
      this.makeButton(this.t("dailyBtn"), dailyTex, P[1], () => this.startDaily()))
    this.mainButtonObjs.push(
      this.makeButton(this.t("teachBtn"), teachTex, P[2], () => this.teachMe()))
  }

  // --- daily challenge: same seeded mix for everyone, streak + stats persist ---

  private todayString(): string {
    const d = new Date()
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate()
  }

  private yesterdayString(): string {
    const d = new Date(Date.now() - 86400000)
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate()
  }

  private startDaily() {
    const store = global.persistentStorageSystem.store
    if (store.getString("lastDailyDay") === this.todayString()) {
      this.speak("dailyAlready", {streak: "" + Math.round(store.getFloat("dailyStreak"))})
      return
    }
    this.pendingLesson = false
    this.lessonActive = false
    this.sessionActive = false
    this.solvingStage = false
    if (this.hintButton) this.hintButton.enabled = false
    if (this.solveButton) this.solveButton.enabled = false
    this.cube.setHighlight("none")
    this.cube.hideMoveArrow()
    const d = new Date()
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
    this.cube.scrambleSeeded(seed, 10 + (seed % 5)) // 10-14 moves, varies by day
    this.sessionPending = true
    this.dailyActive = true
    this.speak("dailyGo")
  }

  // --- Cube IQ challenge ------------------------------------------------------

  private startChallenge() {
    this.pendingLesson = false
    this.lessonActive = false
    this.sessionActive = false
    this.solvingStage = false
    if (this.hintButton) this.hintButton.enabled = false
    if (this.solveButton) this.solveButton.enabled = false
    this.cube.setHighlight("none")
    this.cube.hideMoveArrow()
    this.dailyActive = false
    this.cube.scramble(12)
    this.sessionPending = true // clock starts when the scramble finishes
    this.speak("scrambleGo")
  }

  private cubeIQ(seconds: number, moves: number, hints: number): number {
    // Game score in IQ clothing: par is ~4 minutes and ~80 moves for value 100.
    let iq = 100 + (240 - seconds) * 0.15 + (80 - moves) * 0.25 - hints * 8
    return Math.round(Math.max(55, Math.min(160, iq)))
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return m + ":" + (s < 10 ? "0" : "") + s
  }

  private finishChallenge() {
    this.sessionActive = false
    const elapsed = this.now - this.sessionStart
    const moves = this.cube.userMoves
    const store = global.persistentStorageSystem.store
    const totalSolves = Math.round(store.getFloat("totalSolves")) + 1
    store.putFloat("totalSolves", totalSolves)

    const wasDaily = this.dailyActive
    let line: string
    if (this.dailyActive) {
      this.dailyActive = false
      let streak = Math.round(store.getFloat("dailyStreak"))
      streak = store.getString("lastDailyDay") === this.yesterdayString() ? streak + 1 : 1
      store.putFloat("dailyStreak", streak)
      store.putString("lastDailyDay", this.todayString())
      line = this.fmt(this.t("dailyDone"), {time: this.formatTime(elapsed), streak: "" + streak})
    } else {
      const best = store.getFloat("bestTime") // 0 = no record yet
      line = this.fmt(this.t("result"), {time: this.formatTime(elapsed), moves: "" + moves})
      if (best === 0 || elapsed < best) {
        store.putFloat("bestTime", elapsed)
        line += this.t("newBest")
      } else {
        line += this.fmt(this.t("best"), {best: this.formatTime(best)})
      }
    }
    line += this.fmt(this.t("statsTail"), {n: "" + totalSolves})
    this.setExpression(this.charHappy, 4)
    this.speakText(line, wasDaily ? "dailyDone" : "resultShort")
    if (this.statsText) this.statsText.text = ""
  }

  // Undo / redo at the cube's sides — small, always available.
  private createUndoRedoButtons() {
    this.sideButtonObjs.push(this.makeButton("Undo", this.btnUndoTexture, new vec3(-14, 0, 2), () => {
      this.cube.undo()
    }, this.undoRedoSize))
    this.sideButtonObjs.push(this.makeButton("Redo", this.btnRedoTexture, new vec3(14, 0, 2), () => {
      this.cube.redo()
    }, this.undoRedoSize))
  }

  // "?" button: one tap = spoken hint + demonstration. Only during the lesson.
  private createHintButton() {
    this.hintButton = this.makeButton("?", this.btnHintTexture, new vec3(-14, -9, 2), () => {
      this.giveHint()
    }, this.undoRedoSize)
    this.hintButton.enabled = false

    // "help to solve", below Redo: the coach moves and explains.
    // Big like the main buttons (Learn) — it is a primary teaching action.
    this.solveButton = this.makeButton("Solve", this.solveTex(), new vec3(14, -11, 2), () => {
      this.solveStep()
    }, 12)
    this.solveButton.enabled = false
  }

  // Solve artwork for the active language (falls back to English if unassigned)
  private solveTex(): Texture {
    const tex = this.lang === "es" ? this.btnSolveSpanish
      : this.lang === "fr" ? this.btnSolveFrench : this.btnSolveEnglish
    return tex ? tex : this.btnSolveEnglish
  }

  // Rebuild the Solve button so its artwork matches a newly chosen language.
  private refreshSolveButton() {
    if (!this.solveButton) return
    const wasEnabled = this.solveButton.enabled
    this.solveButton.destroy()
    this.solveButton = this.makeButton("Solve", this.solveTex(), new vec3(14, -11, 2), () => {
      this.solveStep()
    }, 12)
    this.solveButton.enabled = wasEnabled
  }

  private makeButton(label: string, tex: Texture | null, localPos: vec3, onPress: () => void, imgSize?: number): SceneObject {
    const root = global.scene.createSceneObject("Button_" + label)
    if (this.rig) root.setParent(this.rig)
    const t = root.getTransform()
    t.setLocalPosition(localPos)

    let flashRmv: any = null
    let flashBase: vec4 | null = null
    let w = 13, h = 4.5

    if (tex) {
      // image button (per-language artwork)
      w = imgSize ? imgSize : this.buttonImageSize
      h = w
      const imgObj = global.scene.createSceneObject("Img")
      imgObj.setParent(root)
      imgObj.getTransform().setLocalScale(new vec3(w, h, 1))
      const img = imgObj.createComponent("Component.Image") as Image
      const mat = this.cube.baseMaterial.clone()
      img.mainMaterial = mat
      try {
        mat.mainPass.blendMode = BlendMode.Normal // respect PNG transparency
        mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
        mat.mainPass.baseTex = tex
      } catch (e) {
        print("CubeTutor: button image failed (" + e + ")")
      }
      flashRmv = img
      flashBase = new vec4(1, 1, 1, 1)
    } else {
      const plate = global.scene.createSceneObject("Plate")
      plate.setParent(root)
      plate.getTransform().setLocalScale(new vec3(13, 4.5, 1.2))
      const rmv = plate.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = this.cube.boxMesh
      const mat = this.cube.baseMaterial.clone()
      mat.mainPass.baseColor = new vec4(0.12, 0.3, 0.75, 1)
      rmv.mainMaterial = mat
      flashRmv = rmv
      flashBase = new vec4(0.12, 0.3, 0.75, 1)

      const textObj = global.scene.createSceneObject("Label")
      textObj.setParent(root)
      textObj.getTransform().setLocalPosition(new vec3(0, 0, 1.0))
      textObj.getTransform().setLocalScale(new vec3(0.5, 0.5, 0.5))
      const txt = textObj.createComponent("Component.Text") as Text
      txt.text = label
      txt.size = 48
      const bf = this.coachFontBold ? this.coachFontBold : this.coachFont
      if (bf) txt.font = bf
    }

    const body = root.createComponent("Physics.BodyComponent") as BodyComponent
    body.dynamic = false
    const shape = Shape.createBoxShape()
    shape.size = new vec3(w, h, 3)
    body.shape = shape

    const inter = root.createComponent(Interactable.getTypeName()) as any
    inter.targetingMode = TargetingMode.All // poke with the finger, pinch, or ray
    inter.onInteractorTriggerEnd.add(() => {
      if (flashRmv && flashBase) {
        flashRmv.mainMaterial.mainPass.baseColor = new vec4(0.6, 0.8, 1, 1)
        this.flashes.push({rmv: flashRmv, base: flashBase, until: this.now + 0.2})
      }
      onPress()
    })
    return root
  }

  // --- hooks for the (experimental) real-cube scanner --------------------------

  // The scanner applied a real cube's state: start teaching right where it is.
  startLessonFromScan() {
    this.pendingLesson = false
    this.sessionActive = false
    this.sessionPending = false
    this.dailyActive = false
    this.solvingStage = false
    if (this.statsText) this.statsText.text = ""
    this.startLesson()
  }

  getLang(): string { return this.lang }

  getRig(): SceneObject | null { return this.rig }

  isLanguageChosen(): boolean { return this.mainButtonObjs.length > 0 }

  // The coach says (and shows) a line that has no pre-recorded clip.
  coachSay(line: string, key: string) { this.speakText(line, key) }

  // The scanner joins the main row: shift the three buttons left and hand
  // back the fourth slot. Sticky across language re-creations of the row.
  private scanRow: boolean = false
  makeRoomForScanButton(): vec3 {
    if (!this.scanRow) {
      this.scanRow = true
      if (this.mainButtonObjs.length > 0) this.createButtons() // re-layout now
    }
    return new vec3(24, -26, -12)
  }

  private teachMe() {
    this.lessonActive = false
    this.sessionActive = false
    this.sessionPending = false
    if (this.statsText) this.statsText.text = ""
    if (this.cube.isSolved()) {
      this.speak("teachIntro")
      this.cube.scramble(12)
      this.pendingLesson = true
    } else {
      this.startLesson()
    }
  }

  // --- floating text panel ----------------------------------------------------

  private createPanel() {
    const obj = global.scene.createSceneObject("CoachPanel")
    obj.setParent(this.rig ? this.rig : this.sceneObject)
    const t = obj.getTransform()
    // Behind and above the cube: a deeper information layer, scaled up to stay legible.
    t.setLocalPosition(new vec3(0, 17, -28))
    t.setLocalScale(new vec3(1.25, 1.25, 1.25))
    this.panelRoot = obj


    // Small stats line (timer + moves) between the cube and the buttons,
    // sitting on its own marshmallow plate when artwork is assigned.
    const stats = global.scene.createSceneObject("StatsPanel")
    stats.setParent(this.rig ? this.rig : this.sceneObject)
    const st = stats.getTransform()
    st.setLocalPosition(new vec3(0, -10.5, 2))
    st.setLocalScale(new vec3(0.45, 0.45, 0.45))

    if (this.statsContainerTexture) {
      const plateObj = global.scene.createSceneObject("StatsPlate")
      plateObj.setParent(stats)
      plateObj.getTransform().setLocalPosition(new vec3(0, 0, -0.6)) // just behind the text
      plateObj.getTransform().setLocalScale(new vec3(38, 20, 1)) // in stats-local units (scaled 0.45)
      const img = plateObj.createComponent("Component.Image") as Image
      const mat = this.cube.baseMaterial.clone()
      img.mainMaterial = mat
      try {
        mat.mainPass.blendMode = BlendMode.Normal // respect PNG transparency
        mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
        mat.mainPass.baseTex = this.statsContainerTexture
      } catch (e) {
        print("CubeTutor: stats container image failed (" + e + ")")
      }
    }

    this.statsText = stats.createComponent("Component.Text") as Text
    this.statsText.text = ""
    this.statsText.size = 48
    const boldFont = this.coachFontBold ? this.coachFontBold : this.coachFont
    if (boldFont) this.statsText.font = boldFont
    if (this.statsContainerTexture) {
      // dark warm text so it reads on the light plate
      this.statsText.textFill.color = new vec4(0.42, 0.35, 0.32, 1)
    }
  }

  // Speak a scripted line: shows the text and plays the matching per-language
  // audio clip if assigned. Without a clip: English uses TTS; ES/FR stay text-only
  // (never an English voice reading Spanish or French).
  private speak(key: string, vars?: {[k: string]: string}) {
    let line = getLine(this.lang, key)
    if (vars) line = this.fmt(line, vars)
    this.speakText(line, key)
  }

  private clipFor(key: string): AudioTrackAsset | null {
    const arr = this.lang === "en" ? this.clipsEnglish
      : this.lang === "es" ? this.clipsSpanish : this.clipsFrench
    if (!arr) return null
    const idx = CLIP_KEYS.indexOf(key)
    return idx >= 0 && idx < arr.length && arr[idx] ? arr[idx] : null
  }

  private ttsCache: {[key: string]: AudioTrackAsset} = {}
  private speechQueue: {line: string, key: string | null}[] = []
  private ttsFetching: boolean = false

  // Lines are queued: each one waits for the previous audio to FINISH, so the
  // coach never interrupts itself mid-sentence.
  private speakText(line: string, clipKey: string | null) {
    print("Coach: " + line.split("**").join(""))
    if (this.speechQueue.length >= 4) this.speechQueue.shift() // drop the oldest
    this.speechQueue.push({line: line, key: clipKey})
  }

  // Called every frame: plays the next queued line once the audio is free.
  private processSpeech() {
    if (this.speechQueue.length === 0 || this.ttsFetching) return
    if (this.audio && this.audio.isPlaying()) return

    const item = this.speechQueue.shift()!
    this.showRichText(item.line)
    item.line = item.line.split("**").join("") // voice reads it plain

    // 1) recorded clip for this language, if assigned
    const clip = item.key ? this.clipFor(item.key) : null
    if (clip && this.audio) {
      this.audio.audioTrack = clip
      this.audio.play(1)
      return
    }

    // 2) OpenAI TTS via Remote Service Gateway — native voices in EN/ES/FR
    if (this.useOpenAITts) {
      const cacheKey = this.lang + "|" + (item.key ? item.key : item.line)
      const cached = this.ttsCache[cacheKey]
      if (cached && this.audio) {
        this.audio.audioTrack = cached
        this.audio.play(1)
        return
      }
      this.ttsFetching = true
      OpenAI.speech({
        model: "gpt-4o-mini-tts",
        input: item.line,
        voice: this.openAiVoice,
        response_format: "mp3"
      }).then((aud: AudioTrackAsset) => {
        this.ttsFetching = false
        this.ttsCache[cacheKey] = aud
        if (this.audio) {
          this.audio.audioTrack = aud
          this.audio.play(1)
        }
      }).catch((e: any) => {
        this.ttsFetching = false
        print("CubeTutor: OpenAI TTS failed (" + e + ") — falling back")
        this.legacyTts(item.line)
      })
      return
    }

    this.legacyTts(item.line)
  }

  // 3) classic VoiceML TTS — English only; ES/FR stay silent rather than
  // hearing an English voice read another language.
  private legacyTts(line: string) {
    if (this.lang !== "en") return
    try {
      const options = TextToSpeech.Options.create()
      this.ttsModule.synthesize(line, options,
        (track: AudioTrackAsset) => {
          if (this.audio) {
            this.audio.audioTrack = track
            this.audio.play(1)
          }
        },
        (error: number, description: string) => {
          print("CubeTutor: TTS error " + error + " — " + description)
        })
    } catch (e) {
      print("CubeTutor: TTS unavailable (" + e + "); text panel only")
    }
  }

  // --- rich panel: **bold** markup renders with the bold font, inline -----------

  private showRichText(marked: string) {
    if (!this.panelRoot) return
    for (const s of this.panelSegs) s.obj.destroy()
    this.panelSegs = []

    // tokenize into words carrying their style
    const words: {w: string, bold: boolean}[] = []
    const parts = marked.split("**")
    for (let i = 0; i < parts.length; i++) {
      const bold = i % 2 === 1
      for (const w of parts[i].split(" ")) {
        if (w.length > 0) words.push({w: w, bold: bold})
      }
    }

    // greedy wrap by characters, then merge same-style runs per line
    const maxChars = 42 // wider text box, still centered
    let line = 0, count = 0
    const runs: {txt: string, bold: boolean, line: number}[] = []
    for (const wd of words) {
      if (count > 0 && count + 1 + wd.w.length > maxChars) { line++; count = 0 }
      const last = runs.length > 0 ? runs[runs.length - 1] : null
      if (last && last.line === line && last.bold === wd.bold) {
        last.txt += " " + wd.w
      } else {
        runs.push({txt: (last && last.line === line) ? " " + wd.w : wd.w, bold: wd.bold, line: line})
      }
      count += (count > 0 ? 1 : 0) + wd.w.length
    }

    for (const r of runs) {
      const obj = global.scene.createSceneObject("Seg")
      obj.setParent(this.panelRoot)
      // parked far below while measuring: text must RENDER to have a size
      obj.getTransform().setLocalPosition(new vec3(0, -500, 0))
      const txt = obj.createComponent("Component.Text") as Text
      txt.text = r.txt
      txt.size = 48
      const f = r.bold ? (this.coachFontBold ? this.coachFontBold : this.coachFont) : this.coachFont
      if (f) txt.font = f
      this.panelSegs.push({obj: obj, txt: txt, line: r.line})
    }
    this.panelLayoutPending = 30 // try measuring for up to ~30 frames
  }

  private layoutRichPanel() {
    if (this.panelLayoutPending <= 0 || this.panelSegs.length === 0) return
    this.panelLayoutPending--
    const widths: number[] = []
    let lineH = 0
    let allMeasured = true
    for (const s of this.panelSegs) {
      const w = s.txt.localAabbMax().x - s.txt.localAabbMin().x
      const h = s.txt.localAabbMax().y - s.txt.localAabbMin().y
      if (w <= 0.0001 && s.txt.text.length > 0) { allMeasured = false; break }
      widths.push(w)
      if (h > lineH) lineH = h
    }
    if (!allMeasured) {
      if (this.panelLayoutPending === 0) {
        // measuring failed: fall back to one plain centered text, never a jumble
        let plain = ""
        for (const s of this.panelSegs) plain += s.txt.text
        for (const s of this.panelSegs) s.obj.destroy()
        this.panelSegs = []
        const obj = global.scene.createSceneObject("Seg")
        obj.setParent(this.panelRoot)
        const txt = obj.createComponent("Component.Text") as Text
        txt.text = this.wrap(plain, 42)
        txt.size = 48
        if (this.coachFont) txt.font = this.coachFont
        this.panelSegs.push({obj: obj, txt: txt, line: 0})
      }
      return // not measurable yet, retry next frame
    }
    lineH *= 1.25
    const lineTotals: {[line: number]: number} = {}
    for (let i = 0; i < this.panelSegs.length; i++) {
      const l = this.panelSegs[i].line
      lineTotals[l] = (lineTotals[l] ? lineTotals[l] : 0) + widths[i]
    }
    const cursor: {[line: number]: number} = {}
    for (let i = 0; i < this.panelSegs.length; i++) {
      const s = this.panelSegs[i]
      if (cursor[s.line] === undefined) cursor[s.line] = -lineTotals[s.line] / 2
      // account for where the glyphs actually sit relative to the object origin
      const midX = (s.txt.localAabbMin().x + s.txt.localAabbMax().x) / 2
      s.obj.getTransform().setLocalPosition(new vec3(cursor[s.line] + widths[i] / 2 - midX, -s.line * lineH, 0))
      cursor[s.line] += widths[i]
    }
    this.panelLayoutPending = 0
  }

  private wrap(s: string, width: number): string {
    const words = s.split(" ")
    let out = "", line = ""
    for (const w of words) {
      if ((line + " " + w).length > width) { out += line + "\n"; line = w }
      else line = line === "" ? w : line + " " + w
    }
    return out + line
  }

  // --- lesson stages (layer method) -------------------------------------------

  private defineStages() {
    const S = STRINGS[this.lang]
    const kinds = ["whiteEdges", "whiteCorners", "midEdges", "yellowEdges", "lastLayer"]
    const checks = [
      () => this.cube.isWhiteCrossDone(),
      () => this.cube.isFirstLayerDone(),
      () => this.cube.isSecondLayerDone(),
      () => this.cube.isYellowCrossDone(),
      () => this.cube.isSolved()
    ]
    this.stages = kinds.map((k, i) => ({
      goal: S.goals[i],
      hints: S.hints[i],
      kind: k,
      why: S.whys[i],
      isDone: checks[i]
    }))
  }

  private startLesson() {
    this.lessonActive = true
    this.stageIndex = 0
    this.hintIndex = 0
    // Find where the user actually is, so we never re-teach finished stages.
    while (this.stageIndex < this.stages.length && this.stages[this.stageIndex].isDone()) {
      this.stageIndex++
    }
    if (this.stageIndex >= this.stages.length) {
      this.speak("alreadySolved")
      this.lessonActive = false
      return
    }
    this.speak("goal" + this.stageIndex)
    this.cube.setHighlight(this.stages[this.stageIndex].kind)
    this.idleT = Math.max(0, this.idleNudgeSeconds - 4) // first demo comes fast
    this.lastLessonMoves = this.cube.userMoves
    this.lastProgress = -1
    this.wrongStreak = 0
    this.nudgeCount = 0 // the help ladder restarts every stage
    this.updateLessonStats()
    if (this.hintButton) this.hintButton.enabled = true
    if (this.solveButton) this.solveButton.enabled = true
    this.solveCount = 0
  }

  private giveHint() {
    // Works in the lesson AND in a free challenge (where it costs Cube IQ points).
    let idx = this.stageIndex
    if (!this.lessonActive) {
      idx = 0
      while (idx < this.stages.length - 1 && this.stages[idx].isDone()) idx++
    }
    this.setExpression(this.charIdea ? this.charIdea : this.charThinking, 3)
    this.cube.focusNext(this.stages[idx].kind) // spotlight the exact next piece
    if (this.sessionActive) this.sessionHints++ // hints cost points in the challenge
    this.speak((this.hintIndex % 2 === 0 ? "hintA" : "hintB") + idx)
    this.speakMoveHint("moveHint") // the concrete instruction in words
    if (this.hintIndex >= 2) this.speak("why" + idx)
    this.hintIndex++
    if (!this.sessionActive) this.demoPiece()
  }

  // "Help to solve": ONE tap = the coach completes the WHOLE current stage,
  // move by move, narrating the first move and the reasoning while you watch.
  private solveStep() {
    if (!this.lessonActive) return
    if (this.solvingStage) {
      // tapping again while the coach works = "I'll take it from here"
      this.solvingStage = false
      return
    }
    const idx = this.stageIndex
    this.setExpression(this.charIdea ? this.charIdea : this.charThinking, 4)
    this.cube.focusNext(this.stages[idx].kind)
    this.speakMoveHint("guidedMove") // narrate the first recommended swipe
    this.speak("why" + idx) // the lesson plays while the coach works
    this.solveBaseMoves = this.cube.userMoves
    this.solvingStage = true
    this.solveSearching = false
    this.solvePendingLine = []
    this.solveBestScore = this.cube.stageScore(idx)
    // safety cap (emergency brake only — the classic algorithms are long,
    // and progress is monotonic, so this should never trip in practice)
    this.solveMovesLeft = 150
    this.solveKicks = 0
    this.lastProgress = -1
  }

  // Continues the walkthrough: one coach move at a time until the stage is done.
  private updateStageSolve() {
    if (!this.solvingStage) return
    if (!this.lessonActive) { this.solvingStage = false; return }
    if (this.cube.busy) return
    if (this.stages[this.stageIndex].isDone()) {
      this.solvingStage = false // stage complete: the normal flow announces the next one
      this.lastProgress = -1
      return
    }
    if (this.cube.userMoves !== this.solveBaseMoves) {
      this.solvingStage = false // the student took over: step aside
      return
    }
    // keep thinking even while a move animates: the search is time-sliced
    if (this.solveSearching) {
      if (this.cube.stepPieceSearch(20000)) {
        this.solveSearching = false
        const line = this.cube.getFoundLine()
        if (line) {
          this.solveKicks = 0
          this.solvePendingLine = line
        } else if (this.solveKicks < 4) {
          // no exact line found: kick and rethink. On the last stages only the
          // yellow layer is kicked — it can never damage the solved lower layers.
          const kick = this.stageIndex >= 3
            ? this.cube.yellowLayerMove()
            : this.cube.findShowMove(this.stages[this.stageIndex].kind)
          if (kick) { this.solvePendingLine = [kick]; this.solveKicks++ }
          else { this.solvingStage = false }
        } else {
          this.solvingStage = false
          this.speak("hintB" + this.stageIndex)
          this.demoPiece()
        }
      }
      if (this.cube.busy) return
    }
    if (this.cube.busy) return
    if (this.stages[this.stageIndex].isDone()) {
      this.solvingStage = false // stage complete: the normal flow announces the next one
      this.lastProgress = -1
      return
    }
    if (this.solvePendingLine.length > 0) {
      // never abort mid-line: an interrupted algorithm would leave the cube
      // half-scrambled. The cap is only checked before starting a new search.
      this.solveMovesLeft--
      const mv = this.solvePendingLine.shift()!
      this.cube.coachMove(mv)
      this.lastProgress = -1
      // track the best score reached so every future line must top it
      const s = this.cube.stageScore(this.stageIndex)
      if (s > this.solveBestScore) this.solveBestScore = s
      return
    }
    if (!this.solveSearching) {
      if (this.solveMovesLeft <= 0) {
        // emergency brake: stop gracefully — explain and demonstrate
        this.solvingStage = false
        this.speak("hintB" + this.stageIndex)
        this.demoPiece()
        return
      }
      // require strictly beating the historical best: progress is monotonic,
      // undoing a kick can never qualify — loops are impossible
      const s = this.cube.stageScore(this.stageIndex)
      if (s > this.solveBestScore) this.solveBestScore = s
      this.cube.startPieceSearch(this.stageIndex, this.solveBestScore)
      this.solveSearching = true
    }
  }

  // --- listening ---------------------------------------------------------------

  private voiceUnavailable: boolean = false

  private startListening() {
    if (this.voiceUnavailable) return
    try {
      this.startListeningUnsafe()
    } catch (e) {
      // Older Snap OS builds have no AsrModule: voice commands off, buttons cover everything.
      this.voiceUnavailable = true
      this.transcribing = true // stop the retry loop
      print("CubeTutor: voice input not available on this OS (" + e + ") — use the buttons")
    }
  }

  private startListeningUnsafe() {
    const options = AsrModule.AsrTranscriptionOptions.create()
    options.mode = AsrModule.AsrMode.HighAccuracy
    options.silenceUntilTerminationMs = 800
    options.onTranscriptionUpdateEvent.add((ev: any) => {
      if (ev.isFinal) {
        print("CubeTutor: heard \"" + ev.text + "\"")
        this.handleCommand(ev.text.toLowerCase())
        this.transcribing = false // session ends on silence; restart next frame
      }
    })
    options.onTranscriptionErrorEvent.add((code: any) => {
      // ASR is wearable-only: it always fails in the desktop preview and only
      // works on the Spectacles device. The buttons cover the preview.
      print("CubeTutor: ASR error " + code + " (voice works on device only; use the buttons in preview)")
      this.transcribing = false
      this.retryCooldown = 5.0
    })
    this.asrModule.startTranscribing(options)
    this.transcribing = true
  }

  private handleCommand(text: string) {
    const has = (...words: string[]) => words.some((w) => text.indexOf(w) >= 0)
    // Saying a language name switches the whole experience at any time.
    if (has("english", "inglés", "ingles", "anglais")) { this.selectLanguage("en"); return }
    if (has("español", "espanol", "spanish", "espagnol", "castellano")) { this.selectLanguage("es"); return }
    if (has("français", "francais", "french", "francés", "frances")) { this.selectLanguage("fr"); return }
    if (has("mezcla", "mezclá", "scramble", "shuffle", "mélange", "melange", "mix", "jugar", "jouer")) {
      this.startChallenge()
    } else if (has("enseñ", "enséñ", "tutorial", "teach", "learn", "aprender", "apprends", "apprendre")) {
      this.teachMe()
    } else if (has("pista", "hint", "ayuda", "help", "indice", "aide")) {
      this.giveHint()
    } else if (has("por qué", "porque", "porqué", "why", "explica", "explain", "pourquoi")) {
      const idx = this.lessonActive ? this.stageIndex : this.freeStageIndex()
      this.speak("why" + idx)
    } else if (has("reinicia", "reiníci", "reset", "solve", "resolvé", "recommence", "réinitialise")) {
      this.cube.resetSolved()
      this.lessonActive = false
      this.sessionActive = false
      this.sessionPending = false
      this.cube.setHighlight("none")
      this.cube.hideMoveArrow()
      if (this.statsText) this.statsText.text = ""
      this.speak("backSolved")
    }
  }

  // --- per-frame ----------------------------------------------------------------

  private update() {
    const dt = getDeltaTime()
    this.now += dt
    this.updateFollow(dt)
    this.updateSplash(dt)
    this.updateIntro(dt)
    this.updateParticles(dt)
    this.processSpeech()
    this.layoutRichPanel()
    this.updateStageSolve()
    this.updateCharacter(dt)
    if (this.musicAudio) {
      const target = (this.audio && this.audio.isPlaying()) ? this.musicVolume * 0.35 : this.musicVolume
      this.musicAudio.volume = this.musicAudio.volume + (target - this.musicAudio.volume) * Math.min(1, 4 * dt)
    }
    if (this.pickerCleanup) {
      this.pickerCleanup = false
      for (const o of this.pickerObjs) o.destroy()
      this.pickerObjs = []
    }
    if (!this.transcribing) {
      this.retryCooldown -= getDeltaTime()
      if (this.retryCooldown <= 0) this.startListening()
    }

    // restore button colors after the press flash
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      if (this.now >= this.flashes[i].until) {
        this.flashes[i].rmv.mainMaterial.mainPass.baseColor = this.flashes[i].base
        this.flashes.splice(i, 1)
      }
    }

    // "Teach me": lesson starts right after the shuffle animation finishes
    if (this.pendingLesson && !this.cube.busy) {
      this.pendingLesson = false
      this.startLesson()
    }

    // Cube IQ challenge: clock starts when the shuffle ends
    if (this.sessionPending && !this.cube.busy) {
      this.sessionPending = false
      this.sessionActive = true
      this.sessionStart = this.now
      this.sessionHints = 0
      this.cube.userMoves = 0
    }
    if (this.sessionActive) {
      if (this.statsText) {
        this.statsText.text = this.formatTime(this.now - this.sessionStart) +
          "  ·  " + this.cube.userMoves + " " + this.t("movesWord")
      }
      if (!this.cube.busy && this.cube.userMoves > 0 && this.cube.userMoves !== this.lastCheckedMoves) {
        this.lastCheckedMoves = this.cube.userMoves
        if (this.cube.isSolved()) this.finishChallenge()
      }
    }

    if (!this.lessonActive || this.cube.busy) return
    this.pollTimer += getDeltaTime()
    if (this.pollTimer < 0.5) return
    this.pollTimer = 0

    this.refreshArrow()

    if (this.stages[this.stageIndex].isDone()) {
      this.stageIndex++
      this.hintIndex = 0
      this.nudgeCount = 0 // the help ladder restarts every stage
      this.idleT = 0
      if (this.stageIndex >= this.stages.length) {
        this.setExpression(this.charHappy, 5)
        this.speak("lessonDone")
        this.lessonActive = false
        this.cube.setHighlight("none")
        this.cube.hideMoveArrow()
        if (this.statsText) this.statsText.text = ""
        if (this.hintButton) this.hintButton.enabled = false
        if (this.solveButton) this.solveButton.enabled = false
      } else {
        this.setExpression(this.charHappy, 3)
        this.speak("goal" + this.stageIndex)
        this.cube.setHighlight(this.stages[this.stageIndex].kind)
        this.lastProgress = -1
        this.wrongStreak = 0
        this.updateLessonStats()
      }
      return
    }

    // Idle nudge: student stuck? Point at the pieces and demonstrate a turn.
    if (this.cube.userMoves !== this.lastLessonMoves) {
      this.lastLessonMoves = this.cube.userMoves
      this.idleT = 0
      this.evaluateLessonMove()
    } else {
      this.idleT += 0.5 // this code runs on the 0.5s poll
      if (this.idleT >= this.idleNudgeSeconds) {
        this.idleT = 0
        this.nudgeCount++
        this.setExpression(this.charWaiting, 3.5)
        this.cube.focusNext(this.stages[this.stageIndex].kind)
        if (this.nudgeCount === 1) {
          // level 1: demonstrate on the cube
          if (this.demoPiece()) this.speak("nudge")
        } else if (this.nudgeCount === 2) {
          // level 2: say the exact move in words
          if (!this.speakMoveHint("moveHint")) {
            if (this.demoPiece()) this.speak("nudge")
          }
        } else {
          // level 3+: really stuck — the coach makes the move and explains why,
          // then explains the reasoning every other time
          if (!this.guidedCoachMove()) {
            if (this.demoPiece()) this.speak("nudge")
          }
          if (this.nudgeCount % 2 === 0) this.speak("why" + this.stageIndex)
        }
      }
    }
  }

  // --- guided step-by-step: judge each move, celebrate or correct ---------------

  // Progress score: keeping earlier stages intact is worth a lot; each placed
  // target piece of the current stage adds one.
  private lessonProgress(): number {
    const kind = this.stages[this.stageIndex].kind
    const priorOK = this.stageIndex === 0 || this.stages[this.stageIndex - 1].isDone()
    return (priorOK ? 100 : 0) + this.cube.countPlaced(kind)
  }

  private updateLessonStats() {
    if (!this.statsText) return
    const S = STRINGS[this.lang]
    const kind = this.stages[this.stageIndex].kind
    this.statsText.text = S.stageNames[this.stageIndex] + ":  " +
      this.cube.countPlaced(kind) + "/" + this.cube.targetsTotal(kind)
  }

  private playFx(track: AudioTrackAsset) {
    if (!track || !this.fxAudio) return
    this.fxAudio.audioTrack = track
    this.fxAudio.play(1)
  }

  private evaluateLessonMove() {
    if (this.skipNextEval) {
      this.skipNextEval = false
      this.lastProgress = this.lessonProgress()
      this.updateLessonStats()
      return
    }
    const p = this.lessonProgress()
    // Following the coach's suggestion is ALWAYS right — even when it is a
    // setup move that temporarily lowers the placed-pieces count.
    const lt = this.cube.lastTurn
    if (this.expectedMove && lt &&
      lt.axis === this.expectedMove.axis &&
      lt.layer === this.expectedMove.layer &&
      lt.dir === this.expectedMove.dir) {
      this.expectedMove = null
      this.cube.flashFeedback(true)
      this.setExpression(this.charHappy, 2)
      this.playFx(this.soundRight)
      this.wrongStreak = 0
      this.lastProgress = p
      this.updateLessonStats()
      return
    }
    if (this.lastProgress >= 0) {
      if (p > this.lastProgress) {
        this.cube.flashFeedback(true) // green: that move helped!
        this.setExpression(this.charHappy, 2)
        this.playFx(this.soundRight)
        this.wrongStreak = 0
      } else if (p < this.lastProgress) {
        this.cube.flashFeedback(false) // red: that move broke your work
        this.setExpression(this.charWrong, 2)
        this.playFx(this.soundWrong)
        this.wrongStreak++
        if (this.wrongStreak >= 2) {
          // Two bad moves in a row: bring the cube back and explain.
          this.wrongStreak = 0
          this.skipNextEval = true
          this.cube.undoLastMove()
          this.setExpression(this.charThinking, 3)
          this.speak("wrongMove")
        }
      } else {
        this.wrongStreak = 0 // neutral setup move: fine
      }
    }
    this.lastProgress = p
    this.updateLessonStats()
  }

  // Speak the concrete move as words: "swipe the top row to the left".
  private speakMoveHint(templateKey: string): boolean {
    if (!this.camTransform) return false
    const mv = this.cube.findHelpfulMove(this.stageIndex, true)
    if (!mv) return false
    const rot = this.camTransform.getWorldRotation()
    const d = this.cube.describeMove(mv, this.camTransform.getWorldPosition(),
      rot.multiplyVec3(vec3.right()), rot.multiplyVec3(vec3.up()))
    if (!d) return false
    this.speakText(this.fmt(this.t(templateKey), {row: this.t(d.row), dir: this.t(d.dir)}), null)
    return true
  }

  // Deep-stuck rescue: the coach performs the helpful move itself, narrating it.
  private guidedCoachMove(idx?: number): {axis: string, layer: number, dir: number} | null {
    if (!this.camTransform) return null
    const stage = idx === undefined ? this.stageIndex : idx
    const mv = this.cube.findHelpfulMove(stage, true)
    if (!mv) return null
    const rot = this.camTransform.getWorldRotation()
    const d = this.cube.describeMove(mv, this.camTransform.getWorldPosition(),
      rot.multiplyVec3(vec3.right()), rot.multiplyVec3(vec3.up()))
    if (!d || !this.cube.coachMove(mv)) return null
    this.speakText(this.fmt(this.t("guidedMove"), {row: this.t(d.row), dir: this.t(d.dir)}), null)
    this.lastProgress = -1 // recalibrate: the coach's move must not be judged
    return mv
  }

  // Recompute and show the "swipe here" arrow for the current stage.
  private refreshArrow() {
    if (!this.lessonActive || this.cube.busy) {
      this.cube.hideMoveArrow()
      return
    }
    const mv = this.cube.findHelpfulMove(this.stageIndex)
    // keep the previous suggestion intact while a just-made move awaits judgment
    if (this.cube.userMoves === this.lastLessonMoves) this.expectedMove = mv
    if (mv) {
      this.cube.showMoveArrow(mv, this.camTransform ? this.camTransform.getWorldPosition() : null)
    } else {
      this.cube.hideMoveArrow()
    }
  }

  // Rotate the cube so an unplaced target piece faces the user, then demo its layer.
  private demoPiece(): boolean {
    let dir: vec3 | null = null
    if (this.camTransform) {
      dir = this.camTransform.getWorldPosition()
        .sub(this.sceneObject.getTransform().getWorldPosition()).normalize()
    }
    return this.cube.showPiece(this.stages[this.lessonActive ? this.stageIndex : this.freeStageIndex()].kind, dir)
  }

  private freeStageIndex(): number {
    let idx = 0
    while (idx < this.stages.length - 1 && this.stages[idx].isDone()) idx++
    return idx
  }
}
