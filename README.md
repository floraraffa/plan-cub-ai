<p align="center">
  <img src="Assets/LOGO.png" alt="Plan Cub AI logo" width="600">
</p>

# Plan Cub AI — a 3x3 puzzle cube coach for Spectacles

An AR lens for [Snap Spectacles (2024)](https://www.spectacles.com/) where a
floating AI coach **teaches you how to THINK your way through a 3x3 puzzle
cube** — it never just solves it for you (unless you ask it to).

**Try it:** [published lens](https://www.spectacles.com/lens/c7993aeab3dd4856affd0acaca25df15?type=SNAPCODE&metadata=01)

## What it does

- **Scan your REAL cube (new)**: aim the Spectacles camera at your physical
  3x3 and an AI vision model reads its colors face by face, then that exact
  scramble loads onto the AR cube — so the coach teaches you to solve *your*
  cube in your hand, not a random one. (See "Scan your real cube" below.)
- **Full 3D cube** you turn with your bare hands: index-finger swipes turn
  layers, pinch + drag orbits the whole cube. Undo/redo, open palm = stop.
- **Learn mode**: a 5-stage lesson (white cross → corners → middle layer →
  yellow cross → last layer). The coach highlights the exact piece to work on,
  judges every move (green/yellow flash), explains *why*, and escalates help
  when you're stuck: words → arrows on the cube → the coach moves it for you.
- **Help-to-solve**: one tap completes the WHOLE current stage, move by move,
  narrating the reasoning — powered by an exact staged solver that mixes
  brute-force search with the classic beginner-method algorithms (Sune,
  Niklas, edge 3-cycles…), auto-translated to the cube's current orientation.
- **Mix & Play** free mode with time records, and a seeded **Daily Challenge**
  with streaks (same scramble for everyone, every day).
- **Trilingual**: English, Spanish, French — buttons, texts and voice
  (OpenAI TTS via Snap's Remote Service Gateway), switchable live by voice.
- A floating **character** that talks (mouth flaps with the audio) and reacts
  with expressions: happy, wrong, thinking, waiting, "aha!".

## Scan your real cube → learn on it (new)

Tap **Scan my cube** and hold your real 3x3 up to the glasses. Instead of
fragile RGB color thresholds (which washed out under real lighting), the lens
sends each face to an **AI vision model** that names its 9 stickers. You show
the six faces in one guided order — always **white up, yellow down**, rotating
the cube to the left:

> **green → red → blue → orange**, then **white** (green facing down) and
> **yellow** (green facing up).

Every face you scan is painted live onto the 3D cube for **review**: if one
sticker read wrong, tap it to cycle its color, then **Confirm**. When the six
faces are in, the read is validated and that exact scramble drops onto the AR
cube — from there it's the same coach, teaching you to solve the cube in your
hand.

### What we fixed to make it solid

- **The mirror / handedness.** The 3D model was built with the *opposite
  chirality* of a real cube, so both the colors **and the turns** came out
  mirror-reversed (green in front showed red on the left). The cube is now
  rebuilt in standard handedness — green faces you, white up, **red on the
  right** — so the AR cube and every move match the cube in your hand. It was
  verified end-to-end with an offline geometry simulation before touching the
  device.
- **Self-correcting validation.** A single misread sticker makes a cube
  mathematically impossible to assemble, and it used to fail silently. Now, if
  the confirmed read isn't solvable, the lens re-reads all six faces in one
  pass under the strict *"exactly 9 of each color"* rule to fix ambiguous
  stickers — and if it still can't, it **tells you which color is miscounted**
  (e.g. *"green 10, blue 8"*) so you know exactly what to re-check.
- **Camera + AI reliability.** Reads a *fresh* camera frame (per the Spectacles
  rule that a still can't be pulled mid-stream), crops to the center guide
  square, and uses a strong vision model — robust across natural, warm and
  indoor light where color thresholds failed.
- **Per-language buttons & synced coaching.** Capture / Confirm / Cancel now use
  per-language artwork (EN/ES/FR) like Scan, and the scan window's text and
  voice stay in step with the cube's guided turns.

### APIs used by the scanner

| API | Used for | Notes |
|-----|----------|-------|
| **Spectacles Camera** (`CameraModule` → `requestCamera`, `Default_Color`, `onNewFrame`) | grabbing each face | camera frames come from the device, not the editor preview |
| **Remote Service Gateway** → `OpenAI.chatCompletions` (`image_url`, **gpt-4o**) | reading the 9 sticker colors of each face by vision | needs an RSG token |
| **Remote Service Gateway** → `OpenAI.speech` | the coach's trilingual voice (TTS) | needs an RSG token |
| `Base64.encodeTextureAsync` · `ProceduralTextureProvider` · `InternetModule` | frame → JPEG, center-crop/sample, network | standard Spectacles APIs |

This is the **same camera + Remote Service Gateway stack** used by our
[Lingo Specs](https://github.com/floraraffa/specslingo-spectacles-2024) lens —
`CameraModule` for the frames and RSG (OpenAI vision + TTS) for the AI. Nothing
experimental; it just needs an RSG token and the camera enabled, and the camera
part runs on the glasses rather than the editor preview.

## Requirements

- **Lens Studio 5.15.x** (the Spectacles release line for 2024 hardware —
  this project is NOT compatible with 5.2x)
- Spectacles (2024) for hand tracking; the editor preview works for most of it
- Packages already included: Spectacles Interaction Kit, Remote Service Gateway

## Setup

1. Open `EXP2-CUBO-REAL.esproj` in Lens Studio 5.15.
2. For the coach's voice **and the cube scanner**: get a [Remote Service Gateway](https://developers.snap.com/spectacles/about-spectacles-features/apis/remote-service-gateway)
   token and paste it into the `RemoteServiceGatewayCredentials` component.
3. Press play, pick a language, and follow the coach.
4. To scan a real cube, run **on the glasses** with the **camera enabled** —
   camera frames aren't available in the editor preview. Everything else (learn,
   mix & play, daily) works in preview too.

## Code tour (`Assets/Scripts/`)

| File | What it is |
|------|-----------|
| `CubeScanner.ts` | **The real-cube scanner (new):** camera capture, center-crop, AI-vision color reading (gpt-4o via RSG), per-face review/correction UI, self-correcting validation, and loading the scramble onto the AR cube. |
| `CubeCoachPort.ts` | The cube: 27 cubies built at runtime, hand interaction, move engine, teaching aids (highlights, arrows, demos), the exact staged solver (time-sliced IDDFS + classic algorithms as composite moves), and applying a scanned state. |
| `CubeTutor.ts` | The coach: head-follow rig, lesson engine, speech queue (clips → OpenAI TTS → text), rich-text panel, buttons, daily challenge, character expressions. |
| `CoachStrings.ts` | The full trilingual script (EN/ES/FR), frozen so voice clips can be pre-recorded. |

Built with [Claude Code](https://claude.com/claude-code) as pair programmer, by
Florencia Raffa. The teaching philosophy comes from solving the cube without ever
looking up a solution — the lens teaches you to see the cube, not to memorize it.
