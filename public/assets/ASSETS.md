# Asset Credits & Verification

All files in this directory were downloaded as real binary assets and verified on 2026-11-21:
- Every `.glb` starts with the `glTF` magic (`0x46546C67`), reports `glTF binary model, version 2` from `file`, has a valid GLB length, and contains **no external URI references** (textures/buffers are embedded).
- `city_sunset.hdr` starts with `#?RADIANCE` and its MD5 (`a5ec4d30fc3421c214a17b208fb66d5f`) matches the Poly Haven API manifest.

## Credits

| Local file | Source URL | Creator | License |
| --- | --- | --- | --- |
| `models/soldier.glb` | https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb (three.js example: https://threejs.org/examples/webgl_animation_skinning_blending.html) | "Vanguard" character & animations from Mixamo (Adobe); distributed with the three.js examples | Mixamo/Adobe royalty-free use terms (three.js repository is MIT; no separate license file for this model). Not CC0 — do not repackage as a standalone asset pack. |
| `models/robot.glb` | https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb | Tomás Laulhé (Quaternius); three.js modifications by Don McCurdy (see upstream `RobotExpressive/README.md`) | CC0 1.0 |
| `env/cyberpunk_platform_a.glb` | https://poly.pizza/m/s0rwPHWMpY (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/cyberpunk_platform_b.glb` | https://poly.pizza/m/dHymLbsOMY (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/cyberpunk_platform_c.glb` | https://poly.pizza/m/J3AJSwqmBJ (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/cyberpunk_platform_d.glb` | https://poly.pizza/m/ctQ5CDmraQ (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/streetlight_a.glb` | https://poly.pizza/m/Bq1Qj4DAre (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/streetlight_b.glb` | https://poly.pizza/m/Wp6Eh4r9VX (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/cyberpunk_signs.glb` | https://poly.pizza/m/rsZJjigt1X (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/lootbox_crate.glb` | https://poly.pizza/m/LNQWE3LzNf (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/tv_tower.glb` | https://poly.pizza/m/R8DtfW6Nx5 (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/barrier_support.glb` | https://poly.pizza/m/Z1TYxDMXMx (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/rail.glb` | https://poly.pizza/m/I9LDZrsr1C (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/antenna.glb` | https://poly.pizza/m/l5Oc9swvKk (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/turret_gun.glb` | https://poly.pizza/m/hThPXDCbwl (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `env/air_conditioner.glb` | https://poly.pizza/m/0MdE89Ijtt (bundle: https://poly.pizza/bundle/Cyberpunk-Pack-Hkfxa8K8zF) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `models/anims.json` | Retargeted from https://opengameart.org/content/universal-animation-library and https://opengameart.org/content/universal-animation-library-2 (Standard packs) | Quaternius (Tomás Laulhé) | CC0 1.0 |
| `hdr/city_sunset.hdr` | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr (asset: https://polyhaven.com/a/venice_sunset) | Greg Zaal / Poly Haven | CC0 1.0 |

Environment GLBs were fetched from the bundle's direct static URLs of the form
`https://static.poly.pizza/<resource-uuid>.glb`; the model page URLs above are the human-readable
source pages for each piece.

## Technical notes for game code

Inspected with `npx @gltf-transform/cli inspect` (rest-pose scene bounds):

| Model | Animation clips (exact names) | Bounding box (min → max) | Approx. height |
| --- | --- | --- | --- |
| `models/soldier.glb` | `Idle`, `Run`, `TPose`, `Walk` | (-0.92388, -0.00037, -0.21904) → (0.92407, 1.83183, 0.22482) | ~1.83 units, feet at y≈0 |
| `models/robot.glb` | `Dance`, `Death`, `Idle`, `Jump`, `No`, `Punch`, `Running`, `Sitting`, `Standing`, `ThumbsUp`, `Walking`, `WalkJump`, `Wave`, `Yes` | (-3.31199, -0.0203, -1.26915) → (3.30656, 4.44092, 1.41604) | ~4.46 units, feet at y≈0 (scale ~0.41 to match soldier height) |

Environment pieces (all static, no animations) have bounds:

| File | Approx. size (units, x/y/z) |
| --- | --- |
| `env/cyberpunk_platform_a.glb` | 3.86 × 2.81 × 1.73 |
| `env/cyberpunk_platform_b.glb` | 3.31 × 3.84 × 2.16 |
| `env/cyberpunk_platform_c.glb` | 5.32 × 6.16 × 2.71 |
| `env/cyberpunk_platform_d.glb` | 4.47 × 3.76 × 3.90 |
| `env/streetlight_a.glb` | 0.18 × 2.87 × 0.67 |
| `env/streetlight_b.glb` | 1.35 × 2.65 × 1.19 |
| `env/cyberpunk_signs.glb` | 5.11 × 3.50 × 1.77 |
| `env/lootbox_crate.glb` | 0.59 × 0.51 × 0.61 |
| `env/tv_tower.glb` | 0.73 × 2.38 × 0.63 |
| `env/barrier_support.glb` | 1.11 × 3.56 × 0.09 |
| `env/rail.glb` | 2.29 × 0.24 × 0.06 |
| `env/antenna.glb` | 0.40 × 1.66 × 0.06 |
| `env/turret_gun.glb` | 1.16 × 0.59 × 1.16 |
| `env/air_conditioner.glb` | 1.62 × 0.85 × 0.77 |

Note: several "Cyberpunk Platform" pieces are large modular facade/platform chunks with geometry
extending below y=0; offset them when placing on a street grid.

## Mocap clips (`models/anims.json`)

Three.js `AnimationClip.toJSON` array, baked offline from the Quaternius Universal Animation Library
GLBs onto the soldier's `mixamorig` skeleton (world-space rest-delta retarget, T-pose to T-pose,
per-bone rest direction alignment, hips translation scaled by hip height). Clip names:
`death_a` (Death01), `death_b` (Death01 mirrored), `death_c` (LayToIdle reversed), `hit_chest`,
`hit_head`, `knockback`, `crouch_idle`, `crouch_walk`, `throw` (OverhandThrow), `takedown`
(Melee_Hook), `getup` (LayToIdle), `roll`. Only the 22 body bones are keyed (no fingers).
