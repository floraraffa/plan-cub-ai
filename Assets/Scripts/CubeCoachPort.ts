// CubeCoachPort — all-in-one cube for Lens Studio SPECTACLES (5.15).
// Drop this on an EMPTY SceneObject and set two inputs (boxMesh, baseMaterial).
// Interaction model (fixed-position cube):
//   - The cube stays at a FIXED spot in front of the user (the head-follow rig
//     carries it); it can never be dragged away or lost.
//   - PINCH + drag -> rotates the cube in place, trackball style: drag right to
//     spin it, drag up/down to tilt it. Intuitive one-hand orbiting.
//   - INDEX-FINGER swipe on a face -> turns that layer (the ONLY way to turn layers).
// Finger swipes use SIK Poke targeting (TargetingMode.All on the Interactable).

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {TargetingMode} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {HandInputData} from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData"

@component
export class CubeCoachPort extends BaseScriptComponent {
  @input boxMesh: RenderMesh
  @input baseMaterial: Material
  @input cubieSize: number = 4.0
  @input gap: number = 0.25
  @input dragThreshold: number = 2.0
  @input autoDemo: boolean = false // shuffle by itself (demo mode); off = you are in control
  @input
  @allowUndefined
  arrowTexture: Texture // your arrow artwork: square, pointing RIGHT, transparent bg
  @input arrowSize: number = 9 // cm

  private cubies: SceneObject[] = []
  private spacing: number = 0
  private matCache: {[key: string]: Material} = {}

  private pivot: SceneObject | null = null
  private animT: number = 0
  private animDur: number = 0.6
  private animAxis: vec3 = vec3.up()
  private animDir: number = 1
  private animating: boolean = false

  private demoTimer: number = 0
  private scrambleQueue: number = 0
  private seededMoves: {axis: string, layer: number, dir: number}[] = []
  private focusTarget: SceneObject | null = null
  private focusTimer: number = 0
  userMoves: number = 0 // layer turns made by the user (not scramble/demo)

  // teaching aids: pulse-highlight of target pieces + show-and-revert demo turn
  private highlightKind: string = "none"
  private highlightTargets: SceneObject[] = []
  private highlightRefresh: number = 0
  private pulseT: number = 0
  private showPhase: number = 0 // 0 idle, 4 orienting, 1 turning, 2 pausing, 3 returning
  private showMove: {axis: string, layer: number, dir: number} | null = null
  private showPause: number = 0
  private orientTarget: quat | null = null
  private orientT: number = 0

  // orbit state: pinch + drag rotates the cube in place (trackball style).
  // The cube never translates — it stays at a fixed spot in front of the user.
  private activeInteractors: any[] = []
  private orbiter: any = null
  private lastOrbitPos: vec3 | null = null
  private orbitLostT: number = 0 // seconds without hand data mid-orbit

  // feedback + full undo/redo history of user turns
  private history: {axis: string, layer: number, dir: number}[] = []
  private histIdx: number = 0
  private flashTimer: number = 0

  // layer-turn state (index-finger poke, or second pinching hand)
  private layerInteractor: any = null
  private turned: boolean = false
  private hitLocal: vec3 = vec3.zero()
  private faceNormal: vec3 = vec3.zero()
  private accumDrag: vec3 = vec3.zero()
  private lastLayerPos: vec3 | null = null // finger position last frame (world)

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.setup())
    this.createEvent("UpdateEvent").bind(() => this.update())
  }

  private setup() {
    // Guard: an empty material (no passes) crashes on clone/mainPass. The "+ → Material"
    // menu creates exactly that. Use a ready-made one, e.g. SIK's SimplePBRMaterial.
    try {
      const test = this.baseMaterial.mainPass
    } catch (e) {
      print("CubeCoachPort: Base Material has NO passes (empty material). " +
        "Assign a ready material instead — search 'SimplePBR' in the Asset Browser " +
        "(it ships inside the Spectacles Interaction Kit package) and set it as Base Material.")
      return
    }
    const t = this.sceneObject.getTransform()
    const p = t.getWorldPosition()
    if (Math.abs(p.x) < 0.001 && Math.abs(p.y) < 0.001 && Math.abs(p.z) < 0.001) {
      t.setWorldPosition(new vec3(0, -5, -70))
    }

    // Physics body so interactors can target the cube.
    const body = this.sceneObject.createComponent("Physics.BodyComponent") as BodyComponent
    body.dynamic = false
    const shape = Shape.createBoxShape()
    shape.size = new vec3(15, 15, 15)
    body.shape = shape

    this.buildCube()
    // No mirror hacks: the cube is built with STANDARD handedness (green at +z,
    // red at +x). A real, right-handed rig is essential — a negative scale here
    // reverses the handedness of every layer turn, which broke the moves.

    const interactable = this.sceneObject.createComponent(Interactable.getTypeName()) as any
    interactable.targetingMode = TargetingMode.All // pinch (direct/indirect) + index-finger poke
    interactable.onInteractorTriggerStart.add((ev: any) => this.onTriggerStart(ev))
    interactable.onInteractorTriggerEnd.add((ev: any) => this.onTriggerEnd(ev))
    interactable.onInteractorTriggerEndOutside.add((ev: any) => this.onTriggerEnd(ev))

    print("CubeCoachPort: ready [BUILD mirror-v11] — index finger turns layers; pinch + drag rotates the cube")
  }

  // --- cube construction ----------------------------------------------------

  private colorFor(face: string): vec4 {
    switch (face) {
      case "U": return new vec4(1, 1, 1, 1)
      case "D": return new vec4(1, 0.85, 0, 1)
      case "F": return new vec4(0, 0.62, 0.13, 1)
      case "B": return new vec4(0, 0.27, 0.9, 1)
      case "R": return new vec4(0.85, 0.06, 0.06, 1)
      case "L": return new vec4(1, 0.45, 0, 1)
      // Additive AR displays render pure black as invisible; use a readable grey.
      default: return new vec4(0.16, 0.16, 0.18, 1)
    }
  }

  private matFor(face: string): Material {
    if (!this.matCache[face]) {
      const m = this.baseMaterial.clone()
      m.mainPass.baseColor = this.colorFor(face)
      this.matCache[face] = m
    }
    return this.matCache[face]
  }

  private addBox(parent: SceneObject, name: string, pos: vec3, scale: vec3, face: string): SceneObject {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(parent)
    const t = obj.getTransform()
    t.setLocalPosition(pos)
    t.setLocalScale(scale)
    const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.boxMesh
    rmv.mainMaterial = this.matFor(face)
    return obj
  }

  private buildCube() {
    this.spacing = this.cubieSize + this.gap
    const s = this.cubieSize
    const st = 0.82
    const th = 0.1 / s
    const off = 0.5 + th / 2 + 0.005

    // NOTE: assumes the SIK BoxMesh is a 1cm unit cube (true in recent SIK).
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const cubie = this.addBox(
            this.sceneObject,
            "Cubie_" + x + "_" + y + "_" + z,
            new vec3(x * this.spacing, y * this.spacing, z * this.spacing),
            new vec3(s, s, s),
            "body"
          )
          if (y === 1) this.addSticker(cubie, "U", new vec3(0, off, 0), new vec3(st, th, st))
          if (y === -1) this.addSticker(cubie, "D", new vec3(0, -off, 0), new vec3(st, th, st))
          if (z === 1) this.addSticker(cubie, "F", new vec3(0, 0, off), new vec3(st, st, th))   // green faces the user (+z)
          if (z === -1) this.addSticker(cubie, "B", new vec3(0, 0, -off), new vec3(st, st, th)) // blue at the back (-z)
          if (x === 1) this.addSticker(cubie, "R", new vec3(off, 0, 0), new vec3(th, st, st))
          if (x === -1) this.addSticker(cubie, "L", new vec3(-off, 0, 0), new vec3(th, st, st))
          this.cubies.push(cubie)
        }
      }
    }
    print("CubeCoachPort: built " + this.cubies.length + " cubies")
  }

  private addSticker(cubie: SceneObject, face: string, pos: vec3, scale: vec3) {
    const obj = global.scene.createSceneObject("Sticker_" + face)
    obj.setParent(cubie)
    const t = obj.getTransform()
    t.setLocalPosition(pos)
    t.setLocalScale(scale)
    const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.boxMesh
    rmv.mainMaterial = this.matFor(face)
  }

  // --- layer rotation -------------------------------------------------------

  rotateLayer(axis: string, layer: number, dir: number, duration: number = 0.6) {
    if (this.animating) return
    this.animDur = duration
    const axisVec = axis === "x" ? vec3.right() : axis === "y" ? vec3.up() : vec3.forward()

    this.pivot = global.scene.createSceneObject("LayerPivot")
    this.pivot.setParent(this.sceneObject)
    this.pivot.getTransform().setLocalPosition(vec3.zero())
    this.pivot.getTransform().setLocalRotation(quat.quatIdentity())

    for (const c of this.cubies) {
      const p = c.getTransform().getLocalPosition()
      const coord = axis === "x" ? p.x : axis === "y" ? p.y : p.z
      if (Math.round(coord / this.spacing) === layer) {
        c.setParentPreserveWorldTransform(this.pivot)
      }
    }
    this.animAxis = axisVec
    this.animDir = dir
    this.animT = 0
    this.animating = true
  }

  private finishRotation() {
    if (!this.pivot) return
    const children: SceneObject[] = []
    for (let i = 0; i < this.pivot.getChildrenCount(); i++) children.push(this.pivot.getChild(i))
    for (const c of children) {
      c.setParentPreserveWorldTransform(this.sceneObject)
      const t = c.getTransform()
      const p = t.getLocalPosition()
      t.setLocalPosition(new vec3(
        Math.round(p.x / this.spacing) * this.spacing,
        Math.round(p.y / this.spacing) * this.spacing,
        Math.round(p.z / this.spacing) * this.spacing
      ))
    }
    this.pivot.destroy()
    this.pivot = null
    this.animating = false
  }

  // --- per-frame ------------------------------------------------------------

  private update() {
    const dt = getDeltaTime()

    this.updateOrbit()
    this.trackLayerSwipe()
    this.updateTeachingAids(dt)

    // scan guidance: the whole cube turns by itself to SHOW which face to scan;
    // grabbing the cube (orbit) takes priority and cancels the auto-turn
    if (this.scanOrientTarget) {
      if (this.orbiter) {
        this.scanOrientTarget = null
      } else {
        const t = this.sceneObject.getTransform()
        t.setLocalRotation(quat.slerp(t.getLocalRotation(), this.scanOrientTarget, Math.min(1, dt * 4)))
      }
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      if (this.flashTimer <= 0 && this.matCache["body"]) {
        this.matCache["body"].mainPass.baseColor = this.colorFor("body")
      }
    }

    if (this.animating && this.pivot) {
      this.animT += dt / this.animDur
      const t = Math.min(this.animT, 1)
      const eased = t * t * (3 - 2 * t)
      this.pivot.getTransform().setLocalRotation(quat.angleAxis(eased * (Math.PI / 2) * this.animDir, this.animAxis))
      if (t >= 1) this.finishRotation()
    } else if (this.seededMoves.length > 0) {
      const m = this.seededMoves.shift()!
      this.rotateLayer(m.axis, m.layer, m.dir, 0.35)
    } else if (this.scrambleQueue > 0) {
      this.scrambleQueue--
      this.randomMove(0.35) // fast turns while scrambling
    } else if (this.autoDemo) {
      this.demoTimer += dt
      if (this.demoTimer > 2.2) {
        this.demoTimer = 0
        this.randomMove(0.6)
      }
    }
  }

  private randomMove(duration: number) {
    const axes = ["x", "y", "z"]
    this.rotateLayer(
      axes[Math.floor(Math.random() * 3)],
      [-1, 0, 1][Math.floor(Math.random() * 3)],
      Math.random() < 0.5 ? 1 : -1,
      duration
    )
  }

  // --- public API for the tutor ----------------------------------------------

  scramble(moves: number) {
    this.scrambleQueue = moves
    this.history = []
    this.histIdx = 0
  }

  // Deterministic scramble: the same seed always yields the same move list,
  // so a date-based seed gives the whole world the same daily challenge.
  scrambleSeeded(seed: number, moves: number) {
    this.history = []
    this.histIdx = 0
    this.seededMoves = []
    let s = seed >>> 0
    const rnd = () => {
      // mulberry32
      s = (s + 0x6D2B79F5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const axes = ["x", "y", "z"]
    for (let i = 0; i < moves; i++) {
      this.seededMoves.push({
        axis: axes[Math.floor(rnd() * 3)],
        layer: [-1, 0, 1][Math.floor(rnd() * 3)],
        dir: rnd() < 0.5 ? 1 : -1
      })
    }
  }

  // Strongly pulse ONE piece — the next one to solve — for a few seconds.
  focusNext(kind: string) {
    const pending = this.targetsFor(kind).filter((c) => !this.isPlaced(c))
    if (pending.length === 0) return
    this.focusTarget = pending[0]
    this.focusTimer = 4.0
  }

  get busy(): boolean {
    return this.animating || this.scrambleQueue > 0 || this.seededMoves.length > 0 || this.showPhase !== 0
  }

  resetSolved() {
    this.scrambleQueue = 0
    this.history = []
    this.histIdx = 0
    if (this.pivot) this.finishRotation()
    for (const c of this.cubies) c.destroy()
    this.cubies = []
    this.buildCube()
  }

  // --- cube state reading (derived from cubie transforms) ---------------------
  // Letters: U=white(top) D=yellow F=green B=blue R=red L=orange (as built).

  private normalForFace(letter: string): vec3 {
    switch (letter) {
      case "U": return vec3.up()
      case "D": return vec3.up().uniformScale(-1)
      case "F": return vec3.forward()                  // green built at +z (faces user)
      case "B": return vec3.forward().uniformScale(-1) // blue built at -z
      case "R": return vec3.right()
      default: return vec3.right().uniformScale(-1) // L
    }
  }

  private gridCoord(cubie: SceneObject): vec3 {
    const p = cubie.getTransform().getLocalPosition()
    return new vec3(Math.round(p.x / this.spacing), Math.round(p.y / this.spacing), Math.round(p.z / this.spacing))
  }

  // Stickers of a cubie with their CURRENT cube-local outward direction.
  private stickersOf(cubie: SceneObject): {letter: string, dir: vec3}[] {
    const rot = cubie.getTransform().getLocalRotation()
    const out: {letter: string, dir: vec3}[] = []
    for (let i = 0; i < cubie.getChildrenCount(); i++) {
      const ch = cubie.getChild(i)
      if (ch.name.indexOf("Sticker_") !== 0) continue
      const letter = ch.name.substring(8)
      out.push({letter: letter, dir: this.principalAxis(rot.multiplyVec3(this.normalForFace(letter)))})
    }
    return out
  }

  private cubiesByStickerCount(n: number): SceneObject[] {
    return this.cubies.filter((c) => this.stickersOf(c).length === n)
  }

  // Color letter of the CENTER currently facing direction `dir`.
  private centerLetterInDir(dir: vec3): string | null {
    for (const c of this.cubiesByStickerCount(1)) {
      const g = this.gridCoord(c)
      if (g.x === dir.x && g.y === dir.y && g.z === dir.z) {
        return this.stickersOf(c)[0].letter
      }
    }
    return null
  }

  // A cubie is "placed" when every sticker matches the center it faces.
  private isPlaced(cubie: SceneObject): boolean {
    for (const s of this.stickersOf(cubie)) {
      if (this.centerLetterInDir(s.dir) !== s.letter) return false
    }
    return true
  }

  private whiteDir(): vec3 | null {
    for (const c of this.cubiesByStickerCount(1)) {
      if (this.stickersOf(c)[0].letter === "U") return this.gridCoord(c)
    }
    return null
  }

  isWhiteCrossDone(): boolean {
    const edges = this.cubiesByStickerCount(2).filter((c) =>
      this.stickersOf(c).some((s) => s.letter === "U"))
    return edges.length === 4 && edges.every((c) => this.isPlaced(c))
  }

  isFirstLayerDone(): boolean {
    if (!this.isWhiteCrossDone()) return false
    const corners = this.cubiesByStickerCount(3).filter((c) =>
      this.stickersOf(c).some((s) => s.letter === "U"))
    return corners.length === 4 && corners.every((c) => this.isPlaced(c))
  }

  isSecondLayerDone(): boolean {
    if (!this.isFirstLayerDone()) return false
    const midEdges = this.cubiesByStickerCount(2).filter((c) =>
      !this.stickersOf(c).some((s) => s.letter === "U" || s.letter === "D"))
    return midEdges.every((c) => this.isPlaced(c))
  }

  isYellowCrossDone(): boolean {
    if (!this.isSecondLayerDone()) return false
    const w = this.whiteDir()
    if (!w) return false
    const yellowDir = w.uniformScale(-1)
    const edges = this.cubiesByStickerCount(2).filter((c) =>
      this.stickersOf(c).some((s) => s.letter === "D"))
    return edges.every((c) => {
      const s = this.stickersOf(c).filter((st) => st.letter === "D")[0]
      return s.dir.x === yellowDir.x && s.dir.y === yellowDir.y && s.dir.z === yellowDir.z
    })
  }

  isSolved(): boolean {
    return this.cubies.every((c) => this.isPlaced(c))
  }

  // --- move recommendation: a tiny virtual solver + 3D arrows ------------------
  // Simulates candidate moves on an abstract copy of the cube state and finds
  // one (up to 2 moves deep) that advances the current lesson stage. The first
  // move of the best line is shown as an arrow ON the cube: swipe here, this way.

  private static STAGE_KINDS: string[] = ["whiteEdges", "whiteCorners", "midEdges", "yellowEdges", "lastLayer"]

  private extractState(): any[] {
    return this.cubies.map((c) => {
      const g = this.gridCoord(c)
      return {
        pos: [g.x, g.y, g.z],
        stickers: this.stickersOf(c).map((s) => ({letter: s.letter, dir: [s.dir.x, s.dir.y, s.dir.z]}))
      }
    })
  }

  // 90° rotation of an integer vector around axis 0/1/2 (x/y/z), right-handed.
  private rotVec(v: number[], axis: number, d: number): number[] {
    const x = v[0], y = v[1], z = v[2]
    if (axis === 0) return d === 1 ? [x, -z, y] : [x, z, -y]
    if (axis === 1) return d === 1 ? [z, y, -x] : [-z, y, x]
    return d === 1 ? [-y, x, z] : [y, -x, z]
  }

  private cloneState(state: any[]): any[] {
    return state.map((c) => ({
      pos: [c.pos[0], c.pos[1], c.pos[2]],
      stickers: c.stickers.map((s: any) => ({letter: s.letter, dir: [s.dir[0], s.dir[1], s.dir[2]]}))
    }))
  }

  private applyVirtual(state: any[], axis: number, layer: number, d: number) {
    for (const c of state) {
      if (c.pos[axis] === layer) {
        c.pos = this.rotVec(c.pos, axis, d)
        for (const s of c.stickers) s.dir = this.rotVec(s.dir, axis, d)
      }
    }
  }

  private vCenter(state: any[], dir: number[]): string | null {
    for (const c of state) {
      if (c.stickers.length === 1 &&
        c.pos[0] === dir[0] && c.pos[1] === dir[1] && c.pos[2] === dir[2]) {
        return c.stickers[0].letter
      }
    }
    return null
  }

  private vPlaced(state: any[], c: any): boolean {
    for (const s of c.stickers) {
      if (this.vCenter(state, s.dir) !== s.letter) return false
    }
    return true
  }

  private vTargets(state: any[], kind: string): any[] {
    const hasL = (c: any, l: string) => c.stickers.some((s: any) => s.letter === l)
    switch (kind) {
      case "whiteEdges": return state.filter((c) => c.stickers.length === 2 && hasL(c, "U"))
      case "whiteCorners": return state.filter((c) => c.stickers.length === 3 && hasL(c, "U"))
      case "midEdges": return state.filter((c) => c.stickers.length === 2 && !hasL(c, "U") && !hasL(c, "D"))
      case "yellowEdges": return state.filter((c) => c.stickers.length === 2 && hasL(c, "D"))
      default: return state.filter((c) => c.stickers.length >= 2 && hasL(c, "D"))
    }
  }

  private vStageDone(state: any[], idx: number): boolean {
    const kinds = CubeCoachPort.STAGE_KINDS
    if (idx === 3) {
      // yellow cross: prior done + all D stickers of yellow edges face the yellow center
      if (!this.vStageDone(state, 2)) return false
      let whiteDir: number[] | null = null
      for (const c of state) {
        if (c.stickers.length === 1 && c.stickers[0].letter === "U") whiteDir = c.pos
      }
      if (!whiteDir) return false
      const yd = [-whiteDir[0], -whiteDir[1], -whiteDir[2]]
      return this.vTargets(state, "yellowEdges").every((c) => {
        const s = c.stickers.filter((st: any) => st.letter === "D")[0]
        return s.dir[0] === yd[0] && s.dir[1] === yd[1] && s.dir[2] === yd[2]
      })
    }
    if (idx === 4) return state.every((c) => this.vPlaced(state, c))
    // stages 0-2 chain: all targets of this and previous kinds placed
    for (let i = 0; i <= idx; i++) {
      if (!this.vTargets(state, kinds[i]).every((c) => this.vPlaced(state, c))) return false
    }
    return true
  }

  private vScore(state: any[], stageIdx: number): number {
    let score = 0
    for (let i = 0; i < stageIdx; i++) {
      if (this.vStageDone(state, i)) score += 100
    }
    const kind = CubeCoachPort.STAGE_KINDS[stageIdx]
    score += this.vTargets(state, kind).filter((c) => this.vPlaced(state, c)).length
    return score
  }

  // Fast scoring helpers for the search: build a direction->color map of the
  // six centers once per state, then every "is placed" check is a lookup.
  private vCenterMap(state: any[]): {[key: string]: string} {
    const map: {[key: string]: string} = {}
    for (const c of state) {
      if (c.stickers.length === 1) {
        map[c.pos[0] + "," + c.pos[1] + "," + c.pos[2]] = c.stickers[0].letter
      }
    }
    return map
  }

  private vPlacedFast(map: {[key: string]: string}, c: any): boolean {
    for (const s of c.stickers) {
      if (map[s.dir[0] + "," + s.dir[1] + "," + s.dir[2]] !== s.letter) return false
    }
    return true
  }

  private vStageDoneFast(state: any[], map: {[key: string]: string}, idx: number): boolean {
    const kinds = CubeCoachPort.STAGE_KINDS
    if (idx === 3) {
      if (!this.vStageDoneFast(state, map, 2)) return false
      let whiteKey: string | null = null
      for (const k in map) if (map[k] === "U") whiteKey = k
      if (!whiteKey) return false
      const w = whiteKey.split(",").map((n) => parseInt(n))
      const yd = (-w[0]) + "," + (-w[1]) + "," + (-w[2])
      return this.vTargets(state, "yellowEdges").every((c) => {
        const s = c.stickers.filter((st: any) => st.letter === "D")[0]
        return (s.dir[0] + "," + s.dir[1] + "," + s.dir[2]) === yd
      })
    }
    if (idx === 4) return state.every((c) => this.vPlacedFast(map, c))
    for (let i = 0; i <= idx; i++) {
      if (!this.vTargets(state, kinds[i]).every((c) => this.vPlacedFast(map, c))) return false
    }
    return true
  }

  // PERF-CRITICAL scoring: runs at every search leaf on device. Uses an index
  // profile cached on the state (piece identities never change during in-place
  // search) and a flat 27-cell center array — no string keys, no allocations.
  private vProfile(state: any[]): any {
    let prof = (state as any).__prof
    if (prof) return prof
    const hasL = (c: any, l: string) => {
      for (const s of c.stickers) if (s.letter === l) return true
      return false
    }
    const targets: number[][] = [[], [], [], [], []]
    const centers: number[] = []
    for (let i = 0; i < state.length; i++) {
      const c = state[i]
      const n = c.stickers.length
      if (n === 1) centers.push(i)
      if (n === 2 && hasL(c, "U")) targets[0].push(i)
      if (n === 3 && hasL(c, "U")) targets[1].push(i)
      if (n === 2 && !hasL(c, "U") && !hasL(c, "D")) targets[2].push(i)
      if (n === 2 && hasL(c, "D")) targets[3].push(i)
      if (n >= 2 && hasL(c, "D")) targets[4].push(i)
    }
    prof = {targets: targets, centers: centers, centerArr: new Array(27)}
    ;(state as any).__prof = prof
    return prof
  }

  // Flat cell->letter array for the six centers (they always occupy exactly
  // the six face cells, so the array is fully overwritten each time).
  private vCells(state: any[], prof: any): any[] {
    const arr = prof.centerArr
    for (const i of prof.centers) {
      const p = state[i].pos
      arr[(p[0] + 1) * 9 + (p[1] + 1) * 3 + (p[2] + 1)] = state[i].stickers[0].letter
    }
    return arr
  }

  private vPlacedIdx(arr: any[], c: any): boolean {
    for (const s of c.stickers) {
      const d = s.dir
      if (arr[(d[0] + 1) * 9 + (d[1] + 1) * 3 + (d[2] + 1)] !== s.letter) return false
    }
    return true
  }

  private vScoreFast(state: any[], stageIdx: number): number {
    const prof = this.vProfile(state)
    const arr = this.vCells(state, prof)
    let yellowIdx = -1
    for (const i of prof.centers) if (state[i].stickers[0].letter === "D") yellowIdx = i
    const yd = yellowIdx >= 0 ? state[yellowIdx].pos : null
    const allPlaced = (idxs: number[]) => {
      for (const i of idxs) if (!this.vPlacedIdx(arr, state[i])) return false
      return true
    }
    const yellowCross = () => {
      if (!yd) return false
      for (const i of prof.targets[3]) {
        let s: any = null
        for (const st of state[i].stickers) if (st.letter === "D") s = st
        if (s.dir[0] !== yd[0] || s.dir[1] !== yd[1] || s.dir[2] !== yd[2]) return false
      }
      return true
    }
    // single pass up the stage chain (every stage requires the previous ones)
    let score = 0
    let chain = true
    for (let i = 0; i < stageIdx; i++) {
      if (chain) chain = i < 3 ? allPlaced(prof.targets[i]) : yellowCross()
      if (chain) score += 100
    }
    if (stageIdx === 3) {
      // yellow cross stage: progress = edges whose yellow sticker faces yellow
      if (yd) {
        for (const i of prof.targets[3]) {
          let s: any = null
          for (const st of state[i].stickers) if (st.letter === "D") s = st
          if (s.dir[0] === yd[0] && s.dir[1] === yd[1] && s.dir[2] === yd[2]) score++
        }
      }
      return score
    }
    for (const i of prof.targets[stageIdx]) if (this.vPlacedIdx(arr, state[i])) score++
    return score
  }

  // Search for a line of moves that raises the stage score.
  // Depth 1-2 by default (cheap: safe to poll); pass deep=true for depth 3
  // (one-shot use only: Solve walkthrough and explicit hints).
  // Uses ONE working state with apply/undo — no cloning, no GC pressure.
  findHelpfulMove(stageIdx: number, deep: boolean = false,
    banned: {axis: string, layer: number, dir: number} | null = null): {axis: string, layer: number, dir: number} | null {
    const axesN = ["x", "y", "z"]
    const bannedIdx = banned ? (banned.axis === "x" ? 0 : banned.axis === "y" ? 1 : 2) : -1
    const isBanned = (m: {a: number, l: number, d: number}) =>
      banned !== null && m.a === bannedIdx && m.l === banned.layer && m.d === banned.dir
    const st = this.extractState()
    const s0 = this.vScoreFast(st, stageIdx)
    let bestScore = s0
    let best: {axis: string, layer: number, dir: number} | null = null

    const moves: {a: number, l: number, d: number}[] = []
    for (let a = 0; a < 3; a++) for (const l of [-1, 0, 1]) for (const d of [1, -1]) {
      moves.push({a: a, l: l, d: d})
    }

    // depth 1
    for (const m1 of moves) {
      if (isBanned(m1)) continue
      this.applyVirtual(st, m1.a, m1.l, m1.d)
      const s1 = this.vScoreFast(st, stageIdx)
      this.applyVirtual(st, m1.a, m1.l, -m1.d)
      if (s1 > bestScore) {
        bestScore = s1
        best = {axis: axesN[m1.a], layer: m1.l, dir: m1.d}
      }
    }
    if (best) return best

    // depth 2
    for (const m1 of moves) {
      if (isBanned(m1)) continue
      this.applyVirtual(st, m1.a, m1.l, m1.d)
      for (const m2 of moves) {
        if (m2.a === m1.a && m2.l === m1.l && m2.d === -m1.d) continue
        this.applyVirtual(st, m2.a, m2.l, m2.d)
        const s2 = this.vScoreFast(st, stageIdx)
        this.applyVirtual(st, m2.a, m2.l, -m2.d)
        if (s2 > bestScore) {
          bestScore = s2
          best = {axis: axesN[m1.a], layer: m1.l, dir: m1.d}
        }
      }
      this.applyVirtual(st, m1.a, m1.l, -m1.d)
    }
    if (best || !deep) return best

    // depth 3 — only on explicit request (Solve / hints)
    for (const m1 of moves) {
      if (isBanned(m1)) continue
      this.applyVirtual(st, m1.a, m1.l, m1.d)
      for (const m2 of moves) {
        if (m2.a === m1.a && m2.l === m1.l && m2.d === -m1.d) continue
        this.applyVirtual(st, m2.a, m2.l, m2.d)
        for (const m3 of moves) {
          if (m3.a === m2.a && m3.l === m2.l && m3.d === -m2.d) continue
          this.applyVirtual(st, m3.a, m3.l, m3.d)
          const s3 = this.vScoreFast(st, stageIdx)
          this.applyVirtual(st, m3.a, m3.l, -m3.d)
          if (s3 > bestScore) {
            bestScore = s3
            best = {axis: axesN[m1.a], layer: m1.l, dir: m1.d}
          }
        }
        this.applyVirtual(st, m2.a, m2.l, -m2.d)
      }
      this.applyVirtual(st, m1.a, m1.l, -m1.d)
    }
    return best
  }

  // Human description of a move, relative to what the user actually sees:
  // which row/column to swipe, and in which direction. Returns string KEYS
  // (rowTop/rowMid/rowBottom/colLeft/colMid/colRight + left/right/up/down)
  // that the tutor translates through the language table.
  describeMove(mv: {axis: string, layer: number, dir: number}, camPos: vec3 | null,
    camRight: vec3, camUp: vec3): {row: string, dir: string} | null {
    const aUnit = mv.axis === "x" ? vec3.right() : mv.axis === "y" ? vec3.up() : vec3.forward()
    let faceN = vec3.forward().uniformScale(-1)
    if (camPos) {
      const inv = this.sceneObject.getTransform().getInvertedWorldTransform()
      const toCam = inv.multiplyPoint(camPos).normalize()
      let bestDot = -2
      const candidates = [vec3.right(), vec3.right().uniformScale(-1), vec3.up(),
        vec3.up().uniformScale(-1), vec3.forward(), vec3.forward().uniformScale(-1)]
      for (const c of candidates) {
        if (Math.abs(c.dot(aUnit)) > 0.5) continue
        const dd = c.dot(toCam)
        if (dd > bestDot) { bestDot = dd; faceN = c }
      }
    }
    const p0 = faceN.uniformScale(this.spacing * 1.5).add(aUnit.uniformScale(mv.layer * this.spacing))
    let dirVec = aUnit.cross(p0).uniformScale(mv.dir)
    dirVec = dirVec.sub(faceN.uniformScale(dirVec.dot(faceN)))
    if (dirVec.length < 0.001) return null
    dirVec = dirVec.normalize()

    const rot = this.sceneObject.getTransform().getWorldRotation()
    const dirW = rot.multiplyVec3(dirVec)
    const p0W = rot.multiplyVec3(p0)
    const h = dirW.dot(camRight)
    const v = dirW.dot(camUp)
    if (Math.abs(h) >= Math.abs(v)) {
      const y = p0W.dot(camUp)
      return {
        row: y > this.spacing / 2 ? "rowTop" : (y < -this.spacing / 2 ? "rowBottom" : "rowMid"),
        dir: h > 0 ? "dirRight" : "dirLeft"
      }
    }
    const x = p0W.dot(camRight)
    return {
      row: x > this.spacing / 2 ? "colRight" : (x < -this.spacing / 2 ? "colLeft" : "colMid"),
      dir: v > 0 ? "dirUp" : "dirDown"
    }
  }

  // When the student asks for it: the coach makes ONE helpful move itself,
  // slowly, so they can watch. Does not count as a user move.
  coachMove(mv: {axis: string, layer: number, dir: number}): boolean {
    if (this.busy || this.showPhase !== 0) return false
    this.rotateLayer(mv.axis, mv.layer, mv.dir, 1.1)
    return true
  }

  // --- exact piece solver (time-sliced iterative-deepening DFS) ----------------
  // Finds the SHORTEST move line (up to 5) whose result strictly beats a given
  // score — i.e. really places one more piece without breaking earlier work.
  // Runs in slices across frames so the lens never stutters.

  // Classic beginner-method algorithms for the given stage, translated to this
  // cube's actual orientation (yellow face up) and tried in all 4 headings.
  private stageMacros(stageIdx: number): {a: number, l: number, d: number}[][] {
    const state = this.extractState()
    let up: number[] | null = null
    const fronts: number[][] = []
    for (const c of state) {
      if (c.stickers.length !== 1) continue
      if (c.stickers[0].letter === "D") up = c.pos
    }
    if (!up) return []
    for (const c of state) {
      if (c.stickers.length !== 1) continue
      const d = c.pos
      if (d[0] * up[0] + d[1] * up[1] + d[2] * up[2] === 0) fronts.push(d)
    }
    const cross = (a: number[], b: number[]) => [
      a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const neg = (a: number[]) => [-a[0], -a[1], -a[2]]
    const toTurn = (n: number[], prime: boolean) => {
      const a = n[0] !== 0 ? 0 : (n[1] !== 0 ? 1 : 2)
      const s = n[a]
      // clockwise face turn = +90° right-handed about the outward normal
      // (sticker test: U sends the front-top edge to the left face)
      return {a: a, l: s, d: prime ? -s : s}
    }
    let ALGS: string[] = []
    if (stageIdx === 1) {
      // insert a white corner from the top layer (cross stays intact)
      ALGS = ["R U R' U'", "R U R' U' R U R' U'", "R U R' U' R U R' U' R U R' U'",
        "R U R' U' R U R' U' R U R' U' R U R' U'"]
    } else if (stageIdx === 2) {
      // insert a middle-layer edge to the right / to the left
      ALGS = ["U R U' R' U' F' U F", "U' F' U F U R U' R'"]
    } else if (stageIdx === 3) {
      ALGS = ["F R U R' U' F'"]      // orient edges (yellow cross patterns)
    } else {
      ALGS = [
        "F R U R' U' F'",       // orient edges
        "R U R' U R U2 R'",     // Sune: orients corners
        "R U2 R' U' R U' R'",   // AntiSune (Sune inverse)
        "U R U' L' U R' U' L",  // Niklas: corner 3-cycle
        "F2 U L R' F2 L' R U F2", // edge 3-cycle, corner-safe
        "R U2 R' U' R U' R' L' U2 L U L' U L" // pure twist of two corners
      ]
    }
    const out: {a: number, l: number, d: number}[][] = []
    for (const front of fronts) {
      const right = cross(front, up)
      const map: {[k: string]: number[]} = {
        U: up, D: neg(up), F: front, B: neg(front), R: right, L: neg(right)}
      for (const alg of ALGS) {
        const seq: {a: number, l: number, d: number}[] = []
        for (const tok of alg.split(" ")) {
          const n = map[tok.charAt(0)]
          const prime = tok.indexOf("'") >= 0
          const twice = tok.indexOf("2") >= 0
          const t = toTurn(n, prime)
          seq.push(t)
          if (twice) seq.push({a: t.a, l: t.l, d: t.d})
        }
        out.push(seq)
      }
    }
    return out
  }

  private ps: any = null // active search context

  stageScore(stageIdx: number): number {
    return this.vScoreFast(this.extractState(), stageIdx)
  }

  startPieceSearch(stageIdx: number, minScoreExclusive: number) {
    const entries: {a: number, l: number, d: number}[][] = []
    for (let a = 0; a < 3; a++) for (const l of [-1, 0, 1]) for (const d of [1, -1]) {
      entries.push([{a: a, l: l, d: d}])
    }
    for (let a = 0; a < 3; a++) for (const l of [-1, 0, 1]) {
      entries.push([{a: a, l: l, d: 1}, {a: a, l: l, d: 1}]) // 180-degree turns
    }
    // stages past the cross: add the classic algorithms as composite moves
    if (stageIdx >= 1) {
      for (const m of this.stageMacros(stageIdx)) entries.push(m)
    }
    this.ps = {
      st: this.extractState(),
      stageIdx: stageIdx,
      minScore: minScoreExclusive,
      moves: entries,
      depthLimit: 2,
      maxDepth: stageIdx >= 1 ? 3 : 5, // macros make shallow search enough
      path: [] as number[],
      frames: [{ci: -1}] as {ci: number}[],
      found: null as number[] | null,
      finished: false
    }
  }

  // Advances the search by ~budget steps. Returns true when finished.
  // Each entry in ps.moves is a SEQUENCE (length 1 = plain turn, longer = algorithm)
  // applied and undone atomically.
  stepPieceSearch(budget: number): boolean {
    const ps = this.ps
    if (!ps || ps.finished) return true
    const moves = ps.moves
    const applySeq = (seq: any[]) => {
      for (let i = 0; i < seq.length; i++) this.applyVirtual(ps.st, seq[i].a, seq[i].l, seq[i].d)
    }
    const undoSeq = (seq: any[]) => {
      for (let i = seq.length - 1; i >= 0; i--) this.applyVirtual(ps.st, seq[i].a, seq[i].l, -seq[i].d)
    }
    while (budget > 0) {
      budget--
      const f = ps.frames[ps.frames.length - 1]
      f.ci++
      if (f.ci >= moves.length) {
        if (ps.path.length === 0) {
          // this depth exhausted: deepen or give up
          ps.depthLimit++
          if (ps.depthLimit > ps.maxDepth) { ps.finished = true; return true }
          ps.frames = [{ci: -1}]
          continue
        }
        const mi = ps.path.pop()!
        undoSeq(moves[mi])
        ps.frames.pop()
        continue
      }
      const seq = moves[f.ci]
      const m = seq[0]
      // prune (single turns only): never the inverse of the previous turn;
      // never 3 same-layer turns in a row
      if (seq.length === 1 && ps.path.length > 0) {
        const prevSeq = moves[ps.path[ps.path.length - 1]]
        if (prevSeq.length === 1) {
          const prev = prevSeq[0]
          if (prev.a === m.a && prev.l === m.l && prev.d === -m.d) continue
          if (ps.path.length > 1) {
            const prev2Seq = moves[ps.path[ps.path.length - 2]]
            if (prev2Seq.length === 1) {
              const prev2 = prev2Seq[0]
              if (prev.a === m.a && prev.l === m.l && prev2.a === m.a && prev2.l === m.l) continue
            }
          }
        }
      }
      applySeq(seq)
      budget -= seq.length - 1
      if (ps.frames.length === ps.depthLimit) {
        // leaf of this iteration: test the goal
        budget -= 8
        if (this.vScoreFast(ps.st, ps.stageIdx) > ps.minScore) {
          ps.found = ps.path.concat([f.ci])
          undoSeq(seq)
          ps.finished = true
          return true
        }
        undoSeq(seq)
      } else {
        ps.path.push(f.ci)
        ps.frames.push({ci: -1})
      }
    }
    return false
  }

  // The yellow layer as an executable turn: a kick that can NEVER damage the
  // solved lower layers (used by the Solve walkthrough on the last stages).
  yellowLayerMove(): {axis: string, layer: number, dir: number} | null {
    const state = this.extractState()
    for (const c of state) {
      if (c.stickers.length === 1 && c.stickers[0].letter === "D") {
        const d = c.pos
        const a = d[0] !== 0 ? 0 : (d[1] !== 0 ? 1 : 2)
        return {axis: ["x", "y", "z"][a], layer: d[a], dir: 1}
      }
    }
    return null
  }

  private scanOrientTarget: quat | null = null

  // Put every piece back where it belongs: a clean, solved cube (used before
  // the scan demo so colors on the AR cube match the words).
  resetToSolved() {
    if (this.animating) this.finishRotation()
    for (const c of this.cubies) {
      const parts = c.name.split("_") // "Cubie_x_y_z" — the birth cell
      const g = new vec3(parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]))
      const t = c.getTransform()
      t.setLocalPosition(g.uniformScale(this.spacing))
      t.setLocalRotation(quat.quatIdentity())
    }
    this.history = []
    this.histIdx = 0
    this.userMoves = 0
    this.hideMoveArrow()
    this.setHighlight("none")
  }

  // Smoothly turn the WHOLE cube so the face with `letter` looks at the user
  // and the face with `upLetter` points up — a silent "hold it like THIS" demo.
  orientForScan(letter: string, upLetter: string) {
    let df: vec3 | null = null
    let du: vec3 | null = null
    for (const c of this.cubiesByStickerCount(1)) {
      const s = this.stickersOf(c)[0]
      if (s.letter === letter) df = s.dir
      if (s.letter === upLetter) du = s.dir
    }
    if (!df || !du) return
    // +z faces the user: updateFollow yaws the rig so the cube's local +z points
    // back at the wearer, so turning the scanned face to +z shows its FRONT.
    const zAxis = new vec3(0, 0, 1)
    const yAxis = new vec3(0, 1, 0)
    const q1 = quat.rotationFromTo(df, zAxis)
    const v = q1.multiplyVec3(du)
    const ang = Math.atan2(v.cross(yAxis).dot(zAxis), v.dot(yAxis))
    this.scanOrientTarget = quat.angleAxis(ang, zAxis).multiply(q1)
  }

  clearScanOrient() {
    this.scanOrientTarget = null
  }

  // After a scan, face the cube the way the user holds it: GREEN toward them,
  // white up, RED on the right. Green is now built at +z (the user-facing side),
  // so the reference pose is simply identity — no turn, no mirror.
  orientForLearn() {
    this.scanOrientTarget = quat.quatIdentity()
  }

  // ASolver-style scan look: the whole cube goes neutral grey while scanning,
  // so the ONLY colors on it are the ones read from the user's REAL cube.
  setScanDim(on: boolean) {
    const letters = ["U", "D", "F", "B", "R", "L"]
    for (const l of letters) {
      if (!this.matCache[l]) continue
      this.matCache[l].mainPass.baseColor = on
        ? new vec4(0.30, 0.30, 0.34, 1)
        : this.colorFor(l)
    }
  }

  // A colored overlay tile on one face of one cubie: the scanner "paints" the
  // colors it reads from the REAL cube onto the demo cube, cell by cell, LIVE.
  // Upserts: calling again for the same cell just updates its color.
  // Expects the cube in reset (solved) pose, so cubie-local == cube-local.
  private scanTileMats: {[key: string]: Material} = {}
  private scanTileObjs: SceneObject[] = []

  setScanTile(pos: number[], dir: number[], color: vec4) {
    const key = pos.join(",") + "|" + dir.join(",")
    const existing = this.scanTileMats[key]
    if (existing) {
      existing.mainPass.baseColor = color
      return
    }
    for (const c of this.cubies) {
      const g = this.gridCoord(c)
      if (g.x !== pos[0] || g.y !== pos[1] || g.z !== pos[2]) continue
      const tile = global.scene.createSceneObject("ScanTile")
      tile.setParent(c)
      const off = 0.5 + 0.1 / this.cubieSize + 0.02 // just above the sticker
      tile.getTransform().setLocalPosition(new vec3(dir[0] * off, dir[1] * off, dir[2] * off))
      const th = 0.06 / this.cubieSize
      const st = 0.68
      tile.getTransform().setLocalScale(new vec3(
        dir[0] !== 0 ? th : st, dir[1] !== 0 ? th : st, dir[2] !== 0 ? th : st))
      const rmv = tile.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = this.boxMesh
      const m = this.baseMaterial.clone()
      m.mainPass.baseColor = color
      rmv.mainMaterial = m
      this.scanTileMats[key] = m
      this.scanTileObjs.push(tile)
      return
    }
  }

  // Remove the live tiles of ONE face (used when the reading was tentative).
  clearScanTilesOfFace(dir: number[]) {
    // tiles are keyed by "pos|dir": rebuilds are cheap, so just recolor to grey
    for (const key in this.scanTileMats) {
      if (key.split("|")[1] === dir.join(",")) {
        this.scanTileMats[key].mainPass.baseColor = new vec4(0.30, 0.30, 0.34, 1)
      }
    }
  }

  clearScanTiles() {
    for (const t of this.scanTileObjs) t.destroy()
    this.scanTileObjs = []
    this.scanTileMats = {}
  }

  // --- real-cube scan: replace the whole cube state with a scanned one ---------

  // facelets: 54 entries of {pos, dir, letter} in grid coordinates (pos = the
  // piece cell, dir = the sticker's outward axis, letter = its color as a face
  // letter U/D/F/B/R/L). Everything is validated BEFORE anything moves.
  // Returns null on success, or an error code:
  //   "busy" | "incomplete" | "badPieces"
  applyScannedState(facelets: {pos: number[], dir: number[], letter: string}[]): string | null {
    if (this.animating || this.scrambleQueue > 0) return "busy"
    if (!facelets || facelets.length !== 54) return "incomplete"
    const key = (v: number[]) => v[0] + "," + v[1] + "," + v[2]
    const byPos: {[k: string]: {pos: number[], dir: number[], letter: string}[]} = {}
    for (const f of facelets) {
      // a sticker's direction must be the outward axis of its own cell
      if (f.dir[0] * f.pos[0] + f.dir[1] * f.pos[1] + f.dir[2] * f.pos[2] !== 1) return "incomplete"
      const k = key(f.pos)
      if (!byPos[k]) byPos[k] = []
      byPos[k].push(f)
    }
    // the solved-cube faces that live at a given cell
    const solvedFaces = (x: number, y: number, z: number): {letter: string, n: number[]}[] => {
      const out: {letter: string, n: number[]}[] = []
      if (x === 1) out.push({letter: "R", n: [1, 0, 0]})
      if (x === -1) out.push({letter: "L", n: [-1, 0, 0]})
      if (y === 1) out.push({letter: "U", n: [0, 1, 0]})
      if (y === -1) out.push({letter: "D", n: [0, -1, 0]})
      if (z === 1) out.push({letter: "F", n: [0, 0, 1]})
      if (z === -1) out.push({letter: "B", n: [0, 0, -1]})
      return out
    }
    // match every scanned cell to the unique physical piece with those colors,
    // and compute the rotation that carries each sticker onto its scanned side
    const plan: {cubie: SceneObject, pos: vec3, rot: quat}[] = []
    const used: {[k: string]: boolean} = {}
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (x === 0 && y === 0 && z === 0) continue
      const cell = byPos[x + "," + y + "," + z]
      const expected = Math.abs(x) + Math.abs(y) + Math.abs(z)
      if (!cell || cell.length !== expected) return "incomplete"
      const wanted = cell.map((f) => f.letter).sort().join("")
      let srcFaces: {letter: string, n: number[]}[] | null = null
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const faces = solvedFaces(a, b, c)
        if (faces.length !== expected) continue
        if (faces.map((f) => f.letter).sort().join("") !== wanted) continue
        srcFaces = faces
      }
      if (!srcFaces || used[wanted]) return "badPieces" // impossible color combo, or twice
      used[wanted] = true
      const cubie = this.cubieWithLetters(wanted)
      if (!cubie) return "badPieces"
      let rot: quat | null
      if (srcFaces.length >= 2) {
        // corner/edge: build the rotation matrix straight from where each face
        // axis lands (columns), then convert. The old quat.rotationFromTo path
        // DEGENERATED when a face was antiparallel to its scanned side (a
        // flipped edge), and rejected perfectly valid cubes as "badPieces".
        rot = this.rotForCubie(srcFaces, cell)
      } else {
        // center: one sticker, aligns directly — no degeneracy possible
        const t1 = cell.filter((f) => f.letter === srcFaces[0].letter)[0]
        const n1 = new vec3(srcFaces[0].n[0], srcFaces[0].n[1], srcFaces[0].n[2])
        const d1 = new vec3(t1.dir[0], t1.dir[1], t1.dir[2])
        rot = quat.rotationFromTo(n1, d1)
      }
      if (!rot) return "badPieces"
      // every sticker must land EXACTLY on its scanned side (catches genuine
      // impossibilities — a corner scanned "twisted the wrong way")
      for (const f of srcFaces) {
        const target = cell.filter((g) => g.letter === f.letter)[0]
        const landed = rot.multiplyVec3(new vec3(f.n[0], f.n[1], f.n[2]))
        if (Math.abs(landed.x - target.dir[0]) + Math.abs(landed.y - target.dir[1]) +
            Math.abs(landed.z - target.dir[2]) > 0.1) return "badPieces"
      }
      plan.push({cubie: cubie, pos: new vec3(x, y, z), rot: rot})
    }
    // all valid: commit — rearrange the visual cube and reset the bookkeeping
    for (const a of plan) {
      const t = a.cubie.getTransform()
      t.setLocalPosition(a.pos.uniformScale(this.spacing))
      t.setLocalRotation(a.rot)
    }
    for (const c of this.cubies) {
      if (this.stickersOf(c).length === 0) { // the hidden core
        c.getTransform().setLocalPosition(vec3.zero())
        c.getTransform().setLocalRotation(quat.quatIdentity())
      }
    }
    this.history = []
    this.histIdx = 0
    this.userMoves = 0
    this.hideMoveArrow()
    this.setHighlight("none")
    return null
  }

  // Rotation for a corner/edge cubie, built directly from where each of its
  // solved face-axes lands (matrix columns) — robust to the antiparallel case
  // that broke quat.rotationFromTo. Returns null if the columns are degenerate.
  private rotForCubie(
    srcFaces: {letter: string, n: number[]}[],
    cell: {pos: number[], dir: number[], letter: string}[]
  ): quat | null {
    const cols: {[k: string]: vec3} = {}
    for (const f of srcFaces) {
      const t = cell.filter((g) => g.letter === f.letter)[0]
      if (!t) return null
      const d = new vec3(t.dir[0], t.dir[1], t.dir[2])
      // f.n is a signed unit axis; column for +axis is d, for -axis is -d
      if (Math.abs(f.n[0]) === 1) cols["x"] = f.n[0] > 0 ? d : d.uniformScale(-1)
      else if (Math.abs(f.n[1]) === 1) cols["y"] = f.n[1] > 0 ? d : d.uniformScale(-1)
      else if (Math.abs(f.n[2]) === 1) cols["z"] = f.n[2] > 0 ? d : d.uniformScale(-1)
      else return null
    }
    // an edge leaves one axis free: fill it right-handed so R is a rotation
    if (!cols["x"] && cols["y"] && cols["z"]) cols["x"] = cols["y"].cross(cols["z"])
    else if (!cols["y"] && cols["x"] && cols["z"]) cols["y"] = cols["z"].cross(cols["x"])
    else if (!cols["z"] && cols["x"] && cols["y"]) cols["z"] = cols["x"].cross(cols["y"])
    if (!cols["x"] || !cols["y"] || !cols["z"]) return null
    const m = new mat3()
    m.column0 = cols["x"]; m.column1 = cols["y"]; m.column2 = cols["z"]
    // matrix->quat; hedge the column/row convention by verifying, else transpose
    let q = quat.fromRotationMat(m)
    if (this.landsOK(q, srcFaces, cell)) return q
    q = quat.fromRotationMat(m.transpose())
    if (this.landsOK(q, srcFaces, cell)) return q
    return null
  }

  private landsOK(
    q: quat,
    srcFaces: {letter: string, n: number[]}[],
    cell: {pos: number[], dir: number[], letter: string}[]
  ): boolean {
    for (const f of srcFaces) {
      const target = cell.filter((g) => g.letter === f.letter)[0]
      const landed = q.multiplyVec3(new vec3(f.n[0], f.n[1], f.n[2]))
      if (Math.abs(landed.x - target.dir[0]) + Math.abs(landed.y - target.dir[1]) +
          Math.abs(landed.z - target.dir[2]) > 0.1) return false
    }
    return true
  }

  // The (unique) cubie whose sticker letters, sorted and joined, equal `sorted`.
  private cubieWithLetters(sorted: string): SceneObject | null {
    for (const c of this.cubies) {
      const ls: string[] = []
      for (let i = 0; i < c.getChildrenCount(); i++) {
        const ch = c.getChild(i)
        if (ch.name.indexOf("Sticker_") === 0) ls.push(ch.name.substring(8))
      }
      if (ls.sort().join("") === sorted) return c
    }
    return null
  }

  // The line found by the finished search, flattened to executable turns (or null).
  getFoundLine(): {axis: string, layer: number, dir: number}[] | null {
    const ps = this.ps
    if (!ps || !ps.found) return null
    const axesN = ["x", "y", "z"]
    const out: {axis: string, layer: number, dir: number}[] = []
    for (const i of ps.found) {
      for (const m of ps.moves[i]) {
        out.push({axis: axesN[m.a], layer: m.l, dir: m.d})
      }
    }
    return out
  }

  // --- the arrow on the cube: swipe this row, this way -------------------------

  private arrowRoot: SceneObject | null = null
  private arrowMat: Material | null = null

  hideMoveArrow() {
    if (this.arrowRoot) {
      this.arrowRoot.destroy()
      this.arrowRoot = null
    }
  }

  showMoveArrow(mv: {axis: string, layer: number, dir: number}, camPos: vec3 | null) {
    this.hideMoveArrow()
    const aUnit = mv.axis === "x" ? vec3.right() : mv.axis === "y" ? vec3.up() : vec3.forward()

    // pick the display face: the cube-local axis pointing most toward the camera,
    // excluding the rotation axis itself
    let faceN = vec3.forward().uniformScale(-1) // default: user-facing front
    if (camPos) {
      const inv = this.sceneObject.getTransform().getInvertedWorldTransform()
      const toCam = inv.multiplyPoint(camPos).normalize()
      let bestDot = -2
      const candidates = [vec3.right(), vec3.right().uniformScale(-1), vec3.up(),
        vec3.up().uniformScale(-1), vec3.forward(), vec3.forward().uniformScale(-1)]
      for (const c of candidates) {
        if (Math.abs(c.dot(aUnit)) > 0.5) continue // face parallel to rotation axis: useless
        const dd = c.dot(toCam)
        if (dd > bestDot) { bestDot = dd; faceN = c }
      }
    }

    const surface = this.spacing * 1.5 + 2.5
    const p0 = faceN.uniformScale(surface).add(aUnit.uniformScale(mv.layer * this.spacing))
    let dirVec = aUnit.cross(p0).uniformScale(mv.dir)
    dirVec = dirVec.sub(faceN.uniformScale(dirVec.dot(faceN))) // keep it on the face
    if (dirVec.length < 0.001) return
    dirVec = dirVec.normalize()

    this.arrowRoot = global.scene.createSceneObject("MoveArrow")
    this.arrowRoot.setParent(this.sceneObject)
    const t = this.arrowRoot.getTransform()
    t.setLocalPosition(p0)
    // exact basis: local +x points along the swipe, local +z sticks out of the face
    const q1 = quat.rotationFromTo(vec3.forward(), faceN)
    const x1 = q1.multiplyVec3(vec3.right())
    t.setLocalRotation(quat.rotationFromTo(x1, dirVec).multiply(q1))

    if (this.arrowTexture) {
      // custom arrow artwork (drawn pointing right)
      const o = global.scene.createSceneObject("art")
      o.setParent(this.arrowRoot)
      o.getTransform().setLocalScale(new vec3(this.arrowSize, this.arrowSize, 1))
      const img = o.createComponent("Component.Image") as Image
      const mat = this.baseMaterial.clone()
      img.mainMaterial = mat
      try {
        mat.mainPass.blendMode = BlendMode.Normal // respect PNG transparency
        mat.mainPass.depthTest = false // draw on top: never slice into the cube
        mat.mainPass.twoSided = true
        mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
        mat.mainPass.baseTex = this.arrowTexture
      } catch (e) {
        print("CubeCoachPort: arrow texture failed (" + e + ")")
      }
      return
    }

    if (!this.arrowMat) {
      this.arrowMat = this.baseMaterial.clone()
      this.arrowMat.mainPass.baseColor = new vec4(0.35, 0.95, 1, 1) // bright cyan
    }
    const mk = (pos: vec3, scale: vec3, rotZ: number) => {
      const o = global.scene.createSceneObject("part")
      o.setParent(this.arrowRoot!)
      o.getTransform().setLocalPosition(pos)
      o.getTransform().setLocalScale(scale)
      o.getTransform().setLocalRotation(quat.angleAxis(rotZ, vec3.forward()))
      const r = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      r.mesh = this.boxMesh
      r.mainMaterial = this.arrowMat!
    }
    mk(new vec3(0, 0, 0), new vec3(7, 1.1, 0.8), 0) // shaft
    mk(new vec3(2.9, 1.15, 0), new vec3(3.2, 1.1, 0.8), -0.7854) // head, upper wing
    mk(new vec3(2.9, -1.15, 0), new vec3(3.2, 1.1, 0.8), 0.7854) // head, lower wing
  }

  // --- teaching aids ----------------------------------------------------------

  // Pieces that matter for each lesson stage.
  private targetsFor(kind: string): SceneObject[] {
    switch (kind) {
      case "whiteEdges":
        return this.cubiesByStickerCount(2).filter((c) =>
          this.stickersOf(c).some((s) => s.letter === "U"))
      case "whiteCorners":
        return this.cubiesByStickerCount(3).filter((c) =>
          this.stickersOf(c).some((s) => s.letter === "U"))
      case "midEdges":
        return this.cubiesByStickerCount(2).filter((c) =>
          !this.stickersOf(c).some((s) => s.letter === "U" || s.letter === "D"))
      case "yellowEdges":
        return this.cubiesByStickerCount(2).filter((c) =>
          this.stickersOf(c).some((s) => s.letter === "D"))
      case "lastLayer":
        return this.cubies.filter((c) => {
          const n = this.stickersOf(c)
          return n.length >= 2 && n.some((s) => s.letter === "D")
        })
      default:
        return []
    }
  }

  // Pulse-highlight the current stage's targets; placed pieces stop pulsing.
  setHighlight(kind: string) {
    // restore scales of previously highlighted pieces
    for (const c of this.highlightTargets) {
      c.getTransform().setLocalScale(new vec3(this.cubieSize, this.cubieSize, this.cubieSize))
    }
    this.highlightKind = kind
    this.highlightTargets = []
    this.highlightRefresh = 0
    this.pulseT = 0
  }

  // Shows a move: turns a layer slowly and turns it back. Never changes the cube.
  showTurn(axis: string, layer: number, dir: number): boolean {
    if (this.busy || this.showPhase !== 0) return false
    this.showMove = {axis: axis, layer: layer, dir: dir}
    this.showPhase = 1
    this.rotateLayer(axis, layer, dir, 1.2)
    return true
  }

  get showing(): boolean {
    return this.showPhase !== 0
  }

  // A layer worth demonstrating: one containing a not-yet-placed target piece.
  findShowMove(kind: string): {axis: string, layer: number, dir: number} | null {
    const pending = this.targetsFor(kind).filter((c) => !this.isPlaced(c))
    if (pending.length === 0) return null
    const g = this.gridCoord(pending[0])
    if (g.x !== 0) return {axis: "x", layer: g.x, dir: 1}
    if (g.y !== 0) return {axis: "y", layer: g.y, dir: 1}
    return {axis: "z", layer: g.z, dir: 1}
  }

  // Full demonstration: first rotates the whole cube so the target piece faces
  // `faceDir` (usually toward the user — solves "I can't see all the faces"),
  // then turns its layer and turns it back. Skips the orientation if the user
  // is holding the cube.
  showPiece(kind: string, faceDir: vec3 | null): boolean {
    if (this.busy || this.showPhase !== 0) return false
    const pending = this.targetsFor(kind).filter((c) => !this.isPlaced(c))
    if (pending.length === 0) return false
    const g = this.gridCoord(pending[0])
    this.showMove = g.x !== 0 ? {axis: "x", layer: g.x, dir: 1}
      : g.y !== 0 ? {axis: "y", layer: g.y, dir: 1}
      : {axis: "z", layer: g.z, dir: 1}

    if (faceDir && !this.orbiter && (g.x !== 0 || g.y !== 0 || g.z !== 0)) {
      const rot = this.sceneObject.getTransform().getWorldRotation()
      const worldD = rot.multiplyVec3(new vec3(g.x, g.y, g.z).normalize())
      this.orientTarget = quat.rotationFromTo(worldD, faceDir).multiply(rot)
      this.orientT = 0
      this.showPhase = 4
    } else {
      this.showPhase = 1
      this.rotateLayer(this.showMove.axis, this.showMove.layer, this.showMove.dir, 1.2)
    }
    return true
  }

  private updateTeachingAids(dt: number) {
    // demo state machine: (orient whole cube) -> turn -> pause -> turn back
    if (this.showPhase === 4) {
      const t = this.sceneObject.getTransform()
      this.orientT += dt
      if (this.orbiter || !this.orientTarget || this.orientT > 1.4) {
        if (this.orientTarget && !this.orbiter) t.setWorldRotation(this.orientTarget)
        this.orientTarget = null
        this.showPhase = 1
        if (this.showMove) {
          this.rotateLayer(this.showMove.axis, this.showMove.layer, this.showMove.dir, 1.2)
        }
      } else {
        t.setWorldRotation(quat.slerp(t.getWorldRotation(), this.orientTarget, 1 - Math.exp(-4 * dt)))
      }
      return
    }
    if (this.showPhase === 1 && !this.animating) {
      this.showPhase = 2
      this.showPause = 0
    } else if (this.showPhase === 2) {
      this.showPause += dt
      if (this.showPause > 0.8 && this.showMove) {
        this.showPhase = 3
        this.rotateLayer(this.showMove.axis, this.showMove.layer, -this.showMove.dir, 1.2)
      }
    } else if (this.showPhase === 3 && !this.animating) {
      this.showPhase = 0
      this.showMove = null
    }

    // pulse highlight
    if (this.highlightKind === "none") return
    this.highlightRefresh -= dt
    if (this.highlightRefresh <= 0) {
      this.highlightRefresh = 0.25
      // reset pieces that just got placed, keep pulsing the pending ones
      for (const c of this.highlightTargets) {
        c.getTransform().setLocalScale(new vec3(this.cubieSize, this.cubieSize, this.cubieSize))
      }
      this.highlightTargets = this.targetsFor(this.highlightKind).filter((c) => !this.isPlaced(c))
    }
    this.pulseT += dt
    const f = this.cubieSize * (1 + 0.09 * Math.sin(this.pulseT * 5))
    for (const c of this.highlightTargets) {
      c.getTransform().setLocalScale(new vec3(f, f, f))
    }
    if (this.focusTimer > 0 && this.focusTarget && !isNull(this.focusTarget)) {
      this.focusTimer -= dt
      const ff = this.cubieSize * (1 + 0.2 * Math.sin(this.pulseT * 6))
      this.focusTarget.getTransform().setLocalScale(new vec3(ff, ff, ff))
      if (this.focusTimer <= 0) {
        this.focusTarget.getTransform().setLocalScale(new vec3(this.cubieSize, this.cubieSize, this.cubieSize))
        this.focusTarget = null
      }
    }
  }

  // Trackball orbit: while pinching, hand movement rotates the cube in place.
  // Drag right -> spins around the vertical axis; drag up -> tilts toward you.
  private updateOrbit() {
    if (!this.orbiter || this.showPhase !== 0) return
    const pos: vec3 | null = this.orbiter.startPoint
    if (!pos) {
      // hand tracking lost mid-rotation: release after a moment so the cube
      // never stays glued to a ghost hand
      this.orbitLostT += getDeltaTime()
      if (this.orbitLostT > 0.4) {
        this.orbiter = null
        this.lastOrbitPos = null
        this.orbitLostT = 0
      }
      return
    }
    this.orbitLostT = 0
    // OPEN PALM = emergency stop: if neither hand is actually pinching,
    // the grab is stale (missed release event) — let go immediately.
    try {
      const hands = HandInputData.getInstance()
      const l = hands.getHand("left" as any)
      const r = hands.getHand("right" as any)
      const someonePinching = (l.isTracked() && l.isPinching()) || (r.isTracked() && r.isPinching())
      const anyTracked = l.isTracked() || r.isTracked()
      if (anyTracked && !someonePinching) {
        this.orbiter = null
        this.lastOrbitPos = null
        return
      }
    } catch (e) {}
    if (!this.lastOrbitPos) { this.lastOrbitPos = pos; return }
    const delta = pos.sub(this.lastOrbitPos)
    this.lastOrbitPos = pos

    // axes from the parent rig so "right" and "up" match what the user sees
    const parent = this.sceneObject.getParent()
    const pRot = parent ? parent.getTransform().getWorldRotation() : quat.quatIdentity()
    const upAxis = vec3.up()
    const rightAxis = pRot.multiplyVec3(vec3.right())
    const dx = delta.dot(rightAxis)
    const dy = delta.dot(upAxis)

    const k = 0.12 // radians per cm of hand travel
    const t = this.sceneObject.getTransform()
    const q = quat.angleAxis(dx * k, upAxis).multiply(quat.angleAxis(-dy * k, rightAxis))
    t.setWorldRotation(q.multiply(t.getWorldRotation()))
  }

  // --- gesture --------------------------------------------------------------

  private onTriggerStart(ev: any) {
    if (this.activeInteractors.indexOf(ev.interactor) < 0) {
      this.activeInteractors.push(ev.interactor)
    }

    if (ev.interactor.activeTargetingMode === TargetingMode.Poke) {
      // Index finger touching a face: swipe turns that layer. Never rotates the cube.
      this.beginLayerGesture(ev.interactor)
      return
    }

    // Pinch ONLY rotates the whole cube in place — layers turn with the index finger.
    if (!this.orbiter) {
      this.orbiter = ev.interactor
      this.lastOrbitPos = ev.interactor.startPoint
    }
  }

  private beginLayerGesture(interactor: any) {
    if (this.showPhase !== 0) return // hands off while the coach is demonstrating
    const inv = this.sceneObject.getTransform().getInvertedWorldTransform()
    const hitInfo = interactor ? interactor.targetHitInfo : null
    if (hitInfo && hitInfo.hit) {
      this.hitLocal = inv.multiplyPoint(hitInfo.hit.position)
      this.faceNormal = this.principalAxis(this.toLocalDir(hitInfo.hit.normal))
    } else if (interactor && interactor.startPoint) {
      // Poke may not carry hit info: derive face from where the finger is.
      this.hitLocal = inv.multiplyPoint(interactor.startPoint)
      this.faceNormal = this.principalAxis(this.hitLocal)
    } else {
      return
    }
    this.accumDrag = vec3.zero()
    this.lastLayerPos = interactor.startPoint
    this.layerInteractor = interactor
    this.turned = false
  }

  // Called every frame: accumulates the layer finger/hand movement and fires the turn.
  private trackLayerSwipe() {
    const it = this.layerInteractor
    if (!it || this.turned) return
    const pos: vec3 | null = it.startPoint
    if (!pos || !this.lastLayerPos) { this.lastLayerPos = pos; return }
    const deltaWorld = pos.sub(this.lastLayerPos)
    this.lastLayerPos = pos

    const local = this.toLocalDir(deltaWorld)
    const n = this.faceNormal
    this.accumDrag = this.accumDrag.add(local.sub(n.uniformScale(local.dot(n))))
    if (this.accumDrag.length < this.dragThreshold) return

    const dragDir = this.principalAxis(this.accumDrag)
    const rotAxis = n.cross(dragDir)
    const axisName = Math.abs(rotAxis.x) > 0.5 ? "x" : Math.abs(rotAxis.y) > 0.5 ? "y" : "z"
    const axisUnit = axisName === "x" ? vec3.right() : axisName === "y" ? vec3.up() : vec3.forward()
    const layerCoord = axisName === "x" ? this.hitLocal.x : axisName === "y" ? this.hitLocal.y : this.hitLocal.z
    const layer = Math.max(-1, Math.min(1, Math.round(layerCoord / this.spacing)))
    const dir = axisUnit.cross(this.hitLocal).dot(dragDir) >= 0 ? 1 : -1
    print("CubeCoachPort: turn " + axisName + " layer " + layer + " dir " + dir)
    this.rotateLayer(axisName, layer, dir)
    this.history.length = this.histIdx // a new move clears the redo tail
    this.history.push({axis: axisName, layer: layer, dir: dir})
    this.histIdx++
    this.userMoves++
    this.turned = true // one turn per touch; lift the finger to turn again
  }

  // Undo the student's last layer turn (guided lesson: wrong-path correction).
  // Removes the move from history so it cannot be redone.
  undoLastMove(): boolean {
    if (this.histIdx === 0 || this.busy) return false
    this.histIdx--
    const m = this.history[this.histIdx]
    this.history.length = this.histIdx
    this.rotateLayer(m.axis, m.layer, -m.dir, 0.8)
    return true
  }

  // The user's most recent executed turn (for coach-recommendation matching).
  get lastTurn(): {axis: string, layer: number, dir: number} | null {
    return this.histIdx > 0 ? this.history[this.histIdx - 1] : null
  }

  // User-facing undo/redo buttons. They count as moves and stay redoable.
  undo(): boolean {
    if (this.histIdx === 0 || this.busy) return false
    this.histIdx--
    const m = this.history[this.histIdx]
    this.rotateLayer(m.axis, m.layer, -m.dir, 0.45)
    this.userMoves++
    return true
  }

  redo(): boolean {
    if (this.histIdx >= this.history.length || this.busy) return false
    const m = this.history[this.histIdx]
    this.histIdx++
    this.rotateLayer(m.axis, m.layer, m.dir, 0.45)
    this.userMoves++
    return true
  }

  // Count of current-stage target pieces already placed (for the progress display).
  countPlaced(kind: string): number {
    return this.targetsFor(kind).filter((c) => this.isPlaced(c)).length
  }

  targetsTotal(kind: string): number {
    return this.targetsFor(kind).length
  }

  // Brief full-cube color feedback: green = progress, red = breaking your work.
  flashFeedback(good: boolean) {
    const body = this.matCache["body"]
    if (!body) return
    body.mainPass.baseColor = good ? new vec4(0.1, 0.7, 0.25, 1) : new vec4(0.8, 0.1, 0.1, 1)
    this.flashTimer = 0.45
  }

  private onTriggerEnd(ev: any) {
    const idx = this.activeInteractors.indexOf(ev.interactor)
    if (idx >= 0) this.activeInteractors.splice(idx, 1)

    if (ev.interactor === this.layerInteractor) {
      this.layerInteractor = null
      this.turned = false
      this.accumDrag = vec3.zero()
      this.lastLayerPos = null
    }
    if (ev.interactor === this.orbiter) {
      this.orbiter = null
      this.lastOrbitPos = null
    }
  }

  private toLocalDir(worldDir: vec3): vec3 {
    return this.sceneObject.getTransform().getInvertedWorldTransform().multiplyDirection(worldDir)
  }

  private principalAxis(v: vec3): vec3 {
    const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z)
    if (ax >= ay && ax >= az) return new vec3(Math.sign(v.x), 0, 0)
    if (ay >= az) return new vec3(0, Math.sign(v.y), 0)
    return new vec3(0, 0, Math.sign(v.z))
  }
}
