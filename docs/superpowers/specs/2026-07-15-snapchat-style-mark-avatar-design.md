# Snapchat-style Mark avatar (markai-frontend-new) — design

**Date:** 2026-07-15
**Scope:** Replace the realistic Rocketbox human in the landing page's chat section
(`components/ui/Avatar3D.tsx`) with a Snapchat/Bitmoji-style stylized cartoon avatar
that performs readable gestures per state (idle / thinking). Avatar only — no other
chat-section changes.

## Why the current avatar fails

`Avatar3D.tsx` renders `public/avatar/human.glb` — Microsoft Rocketbox
`Male_Adult_08`, a *photoreal* scanned-style human. At 36–44 px in the chat card it
reads uncanny rather than friendly, and its Biped rig (irregular bone frames, facial
bones instead of blendshapes) makes every pose a fragile hand-tuned hack. The user
wants the Snapchat Bitmoji look: smooth, stylized, big-headed cartoon human.

## Options considered

1. **Ready Player Me avatar + RPM animation library** — the standard "Bitmoji-like"
   pipeline. **Dead end, verified 2026-07-15:** Netflix acquired RPM (Dec 2025) and
   shut the whole platform on Jan 31, 2026. `models.readyplayer.me` is NXDOMAIN, no
   avatar can be created, and the old avatars were CC BY-NC-SA (non-commercial) with
   no surviving path to a commercial license. The animation library on GitHub is
   licensed "RPM avatars only" — orphaned. Rejected.
2. **KayKit character packs (CC0)** — rigged, GLTF, but blocky chibi low-poly
   (Crossy-Road style); weak match for the smooth Bitmoji look. Rejected on style.
3. **VRoid/VRM** — anime style (wrong look) and `@pixiv/three-vrm` needs three ≥
   0.137 (repo pins three 0.128). Rejected.
4. **Quaternius Universal Base Characters + procedural gestures (CHOSEN)** — CC0
   (free commercial use, no attribution), 6 smooth stylized cartoon humans with 20
   hairstyles, ~13k tris, clean humanoid rig, official glTF exports. The closest
   open-source match to the Snapchat style (the pack's own promo art literally shows
   a character in the hand-on-chin thinking pose).

## Asset sourcing (verified)

- itch.io (the only official download channel) rate-limits this network (HTTP 429),
  so files come from a public GitHub mirror of the Standard pack —
  `BoQsc/gpu-marching-cubes`, branch `48-world-mapping`,
  `models/entities/player/Universal Base Characters[Standard]/`. CC0 makes
  mirroring/redistribution unrestricted and legal.
- The mirror vendors the **Superhero Male** glTF (Blender I/O 4.3 export, glTF 2.0,
  **no extensions** → three r128-safe) + textures, and the hairstyle glTFs
  ("Origin at 0" variants). Verified contents:
  - Rig: UE-convention bone names (`root, pelvis, spine_01..03, neck_01, Head,
    clavicle_l/r, upperarm_l/r, lowerarm_l/r, hand_l/r`, per-finger chains) — far
    friendlier than the old Biped rig.
  - Meshes: body (`SuperHero_Male`), `Eyes`, `Eyebrows` (already included — no
    separate eyebrow asset needed). No facial blendshapes in the free tier: the
    face is a fixed, pleasant neutral. Acceptable — gestures carry the expression.
  - `Hair_SimpleParted` (neat professional style): static mesh, pivot at origin,
    geometry at head height (y 1.66–1.84) matching the character's rest pose.
  - Body texture is skin + black briefs (base characters are in underwear); UV
    atlas is scattered/painterly, so texture-space clothing is not viable.

## Design

### Asset pipeline (one-time, offline)

1. Patch the two texture URIs the character glTF references with a `_png.png`
   suffix (mirror stores them without it) — done by copying the files.
2. `npx @gltf-transform/cli`: resize textures (body/hair base color → 512,
   normal/roughness → 256; they're 2–4 MB PNGs today), `prune`, `dedup`, pack to:
   - `public/avatar/mark.glb` (body + eyes + eyebrows)
   - `public/avatar/mark-hair.glb` (Hair_SimpleParted)
3. Replace `public/avatar/human.glb` (delete) and rewrite
   `public/avatar/LICENSE.md` for Quaternius CC0.

### Avatar3D rewrite (same public API — `size`, `mood: "idle" | "thinking"`,
`className`; `ChatDemo.tsx` and the SVG fallback stay untouched)

- **Load** both GLBs with r128 `GLTFLoader`; attach the hair with
  `headBone.attach(hairMesh)` (preserves world transform, then follows head
  motion). Keep per-instance load + full dispose (same leak discipline as today).
- **Bitmoji big-head:** scale the `Head` bone ~1.18× — bone scale propagates
  through the skinning matrices and to the attached hair.
- **Shirt (shader tee):** the skinned mesh's `position` attribute is bind-space
  T-pose, so inject a crew-neck tee in the body material via `onBeforeCompile`:
  fragment pixels whose bind position is between waist (~y 0.98) and neckline
  (~y 1.52) and within |x| < ~0.33 (sleeve cut at mid-upper-arm) are tinted the
  brand ink shirt color (same `#101a2e` as the flat SVG avatar), preserving
  shading. It deforms perfectly with every pose — no clipping, no extra mesh.
  Exact thresholds tuned visually on `/avatar-test`.
- **Framing:** camera targets the `Head` bone world position (portrait crop, same
  spans logic as today: tighter under 80 px; pulls back in thinking mode so the
  hand is in frame).
- **Gestures (procedural, no animation clips):** eased 0→1 mood blend as today.
  - *idle:* breathing rise, gentle head yaw/pitch wander, slow body sway.
  - *thinking:* right arm sweeps up — `clavicle_r` lift, `upperarm_r` forward,
    `lowerarm_r` deep bend, `hand_r` settle, finger curl — hand under chin; head
    tilts down/toward the hand with slow gaze wander. On this rig these are plain
    local-axis rotations (no character-space quaternion gymnastics needed).
- **No blink/smile animation** (no blendshapes in the free tier) — out of scope;
  the sculpted face is already friendly.

### Testing / verification

- `/avatar-test` harness (already exists) at 380 px idle + thinking, and ×4-scaled
  44 px / 36 px — verify the face reads at chat size, the tee covers the crop, and
  the thinking gesture is legible.
- `npm run build` passes; headless screenshot check of `/avatar-test` if a browser
  driver is available.

## Out of scope

- ChatDemo script/layout, section copy, the flat SVG fallback, facial animation,
  the legacy `markai-frontend` site.
