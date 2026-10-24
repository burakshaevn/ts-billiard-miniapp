import { useEffect, useRef } from "react";
import * as THREE from "three";
import { type Game, WIDTH, HEIGHT, RADIUS, POCKETS } from "../shared/game";
import { createTableBody } from "./tableScene";
import { BALL_COLORS } from "./balls";
import { CUSHION_SEGMENTS, POCKET_CAPTURE_RADIUS } from "../shared/table";
import {
  sampleSnapshots,
  cueGap,
  type VisualSnapshot,
  type CueStroke,
} from "../shared/rendering";

/**
 * Aim marks on the cloth — the one place to tune them.
 *
 * Nothing is drawn between the cue ball and the object ball: only a short
 * rounded stripe arriving at the contact circle, the circle itself, and a
 * second stripe leaving the object ball. Lengths and widths are in table
 * units, where one ball is 0.243 wide (`RADIUS * 2`).
 */
const AIM = {
  /** Stripe that arrives at the ghost circle. */
  contactLength: 0.34,
  contactWidth: 0.075,
  contactOpacity: 0.85,
  /** Stripe that leaves the object ball, showing where it goes. */
  targetLength: 0.38,
  targetWidth: 0.07,
  targetOpacity: 0.72,
  /** Clearance between a ball edge and the start of a stripe. */
  gap: 0.035,
  /** The ghost circle drawn where the cue ball will stop. */
  ghostWidth: 0.042,
  ghostOpacity: 0.92,
  /** Height above the cloth: high enough to never z-fight with the felt. */
  y: 0.075,
};
type Props = {
  gameRef: React.RefObject<Game>;
  angleRef: React.RefObject<number>;
  onAim: (angle: number) => void;
  /** Camera: a raking three-quarter view or straight down on the cloth. */
  view?: "angled" | "top";
  canAim: boolean;
  power: number;
  /**
   * The game is being simulated right here (practice, a match against the
   * bot in the browser) rather than arriving from the server, so draw the
   * balls where they are instead of interpolating between snapshots.
   */
  live?: boolean;
  resetKey: number;
  strokeRef: React.RefObject<CueStroke | null>;
};
function ballTexture(id: number, anisotropy = 1) {
  // 1024x512 instead of 512x256: the numbers stay sharp on a high-DPI phone.
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = id > 8 ? "#fbf7ec" : BALL_COLORS[id];
  ctx.fillRect(0, 0, 1024, 512);
  if (id > 8) {
    ctx.fillStyle = BALL_COLORS[id];
    ctx.fillRect(0, 138, 1024, 236);
  }
  if (id > 0)
    for (const x of [256, 768]) {
      // Big, high-contrast digits: on a phone the ball is about the size of
      // a fingertip, and a timid number disappears into the highlight.
      ctx.fillStyle = "#fffdf4";
      ctx.beginPath();
      ctx.arc(x, 256, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0000001f";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = "#14191b";
      ctx.font = "bold 124px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(id), x, 264);
    }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}
export default function Table({
  gameRef,
  angleRef,
  onAim,
  view = "angled",
  canAim,
  power,
  live = false,
  resetKey,
  strokeRef,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    refit = useRef<(view: "angled" | "top") => void>(() => {}),
    flags = useRef({ canAim, power, onAim, view, live });
  flags.current = { canAim, power, onAim, view, live };
  useEffect(() => {
    const host = container.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      host.innerHTML =
        '<div class="webgl-error">Для 3D-стола нужен WebGL. Открой игру в современном браузере.</div>';
      return;
    }
    // Phones are high-DPI: rendering at 1.5x made the balls look soft.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    // No tone mapping: the cloth and the balls are painted in the exact
    // colours we want, and every curve pulled them off-tint.
    renderer.toneMapping = THREE.NoToneMapping;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "3D-бильярдный стол. Проведи по сукну, чтобы повернуть кий вокруг битка.",
    );
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    // The table is always shown along its long side; a portrait phone rotates
    // the whole screen instead (see .is-rotated).
    const VIEWS = {
      angled: new THREE.Vector3(0.18, 12.5, 10).normalize(),
      top: new THREE.Vector3(0, 1, 0.0001).normalize(),
    };
    // Straight down is shot through a long lens: the rails stay parallel and
    // the table reads like a board, not like a photo of a board.
    const FOV = { angled: 36, top: 15 };
    const viewDirection = VIEWS[view].clone();
    // Flat studio light: a wide ambient plus one soft lamp overhead. No
    // environment map, no spot, no rim — nothing that can glare.
    // Lambert divides by pi, so these numbers look large: together they add
    // up to roughly "the cloth is shown in the colour it was painted".
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(2.4, 11, 3.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.normalBias = 0.006;
    key.shadow.bias = -0.00008;
    key.shadow.radius = 2;
    scene.add(key);
    const material = (color: string) =>
      new THREE.MeshLambertMaterial({ color });
    createTableBody(scene);
    const balls = new Map<number, THREE.Mesh>();
    const falling = new Map<
      number,
      { time: number; x: number; z: number; px: number; pz: number }
    >();
    for (const b of gameRef.current.balls) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(RADIUS, 48, 32),
        // Matte: the shading only rounds the ball off, there is no highlight
        // to swallow the number.
        new THREE.MeshLambertMaterial({
          map: ballTexture(b.id, renderer.capabilities.getMaxAnisotropy()),
        }),
      );
      m.position.set(b.x, RADIUS + 0.04, b.y);
      m.rotation.set(-0.8, 0, -0.2);
      m.castShadow = true;
      m.receiveShadow = true;
      balls.set(b.id, m);
      scene.add(m);
    }
    const cue = new THREE.Group();
    // The butt rides above the cloth like a real cue, otherwise the stick
    // ploughs straight through balls and cushions while it turns.
    const stick = new THREE.Group();
    stick.rotation.z = -0.18;
    cue.add(stick);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.027, 0.046, 2.2, 16),
      material("#e4b07a"),
    );
    shaft.rotation.z = -Math.PI / 2;
    shaft.position.x = -RADIUS - 0.04 - 1.1;
    stick.add(shaft);
    const butt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.046, 0.058, 1.35, 16),
      material("#d2792f"),
    );
    butt.rotation.z = -Math.PI / 2;
    butt.position.x = -RADIUS - 0.04 - 2.2 - 0.675;
    stick.add(butt);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.065, 12),
      material("#f2f3f1"),
    );
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = -RADIUS - 0.0325;
    stick.add(tip);
    scene.add(cue);
    // Aim marks (see AIM above): two short rounded stripes next to the balls
    // and the ghost circle, painted as pieces of cloth instead of GL lines —
    // a GL line is always one pixel wide, whatever the screen.
    const stripeGeometry = (length: number, width: number) => {
      // A capsule: a rectangle closed by a half circle at each end. Built at
      // its final size and never scaled, so the round caps stay round.
      const r = width / 2,
        half = Math.max(0.0001, length / 2 - r);
      const shape = new THREE.Shape();
      shape.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false);
      shape.absarc(-half, 0, r, Math.PI / 2, Math.PI * 1.5, false);
      shape.closePath();
      return new THREE.ShapeGeometry(shape, 12);
    };
    const stripe = (length: number, width: number, opacity: number) => {
      const m = new THREE.Mesh(
        stripeGeometry(length, width),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      m.rotation.order = "YXZ";
      m.rotation.x = -Math.PI / 2;
      m.position.y = AIM.y;
      m.renderOrder = 3;
      scene.add(m);
      return m;
    };
    const contact = stripe(
      AIM.contactLength,
      AIM.contactWidth,
      AIM.contactOpacity,
    );
    const target = stripe(AIM.targetLength, AIM.targetWidth, AIM.targetOpacity);
    /** Lay a stripe along `angle`, with its far end at (x, z). */
    const placeStripe = (
      m: THREE.Mesh,
      x: number,
      z: number,
      dirX: number,
      dirZ: number,
      length: number,
    ) => {
      m.position.set(x - dirX * (length / 2), AIM.y, z - dirZ * (length / 2));
      m.rotation.y = -Math.atan2(dirZ, dirX);
    };
    const ghost = new THREE.Mesh(
      new THREE.RingGeometry(RADIUS - AIM.ghostWidth, RADIUS, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: AIM.ghostOpacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ghost.rotation.x = -Math.PI / 2;
    ghost.renderOrder = 4;
    ghost.position.y = AIM.y;
    scene.add(ghost);
    const raycaster = new THREE.Raycaster(),
      mouse = new THREE.Vector2(),
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.06),
      point = new THREE.Vector3();
    // Pulling the cue back this far (in table units) means full power.
    const PULL_RANGE = 2;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const cueBall = () => gameRef.current.balls.find((b) => b.id === 0)!;
    // A 90°-rotated frame (portrait phone showing a landscape table) swaps the
    // pointer axes: local x runs down the screen, local y runs to the left.
    const isRotated = () =>
      !!host.closest(".is-rotated") ||
      (!!host.closest(".is-expanded") &&
        window.matchMedia("(max-width:760px) and (orientation:portrait)")
          .matches);
    const clothPoint = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const rotated = isRotated();
      const u = (e.clientX - rect.left) / rect.width,
        v = (e.clientY - rect.top) / rect.height;
      mouse.set(
        rotated ? v * 2 - 1 : u * 2 - 1,
        rotated ? u * 2 - 1 : -v * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      return raycaster.ray.intersectPlane(plane, point) ? point : null;
    };
    const projected = new THREE.Vector3();
    /** Where a table point lands on screen, in client pixels. */
    const toClient = (x: number, z: number) => {
      projected.set(x, RADIUS + 0.035, z).project(camera);
      const rect = renderer.domElement.getBoundingClientRect(),
        lx = (projected.x + 1) / 2,
        ly = (1 - projected.y) / 2;
      return isRotated()
        ? [rect.left + (1 - ly) * rect.width, rect.top + lx * rect.height]
        : [rect.left + lx * rect.width, rect.top + ly * rect.height];
    };
    const idle = () =>
      !flags.current.canAim ||
      gameRef.current.moving ||
      gameRef.current.winner !== null ||
      strokeRef.current !== null;
    // Dragging the cloth only turns the cue around the ball. The shot is a
    // separate control, so a stray finger on the table can never fire one.
    let drag: { id: number; grabAngle: number; startAim: number } | null = null;
    const down = (e: PointerEvent) => {
      if (drag || idle()) return;
      const p = clothPoint(e);
      if (!p) return;
      const b = cueBall();
      drag = {
        id: e.pointerId,
        grabAngle: Math.atan2(p.z - b.y, p.x - b.x),
        startAim: angleRef.current,
      };
      renderer.domElement.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (idle()) {
        drag = null;
        return;
      }
      const p = clothPoint(e);
      if (!p) return;
      const b = cueBall();
      const dx = p.x - b.x,
        dz = p.z - b.y;
      // Right on top of the ball a pixel of travel is a huge angle: ignore it.
      if (Math.hypot(dx, dz) < RADIUS * 2.5) return;
      // Relative turn: the cue follows the finger instead of snapping to it.
      flags.current.onAim(
        wrap(drag.startAim + wrap(Math.atan2(dz, dx) - drag.grabAngle)),
      );
    };
    const up = (e: PointerEvent) => {
      if (drag && drag.id === e.pointerId) drag = null;
    };
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", up);
    let sceneDirty = true,
      lastAngle = Infinity,
      lastPower = -1,
      lastVisible = false;
    const resize = (next: "angled" | "top" = view) => {
      sceneDirty = true;
      viewDirection.copy(VIEWS[next]);
      const w = host.clientWidth,
        h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.fov = FOV[next];
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3()
        .crossVectors(viewDirection, right)
        .normalize();
      // Corners of the wooden body only: the soft floor shadow may be cropped,
      // the table itself never is.
      const corners: THREE.Vector3[] = [];
      for (const x of [-6.12, 6.12])
        for (const y of [-0.12, 0.27])
          for (const z of [-3.42, 3.42])
            corners.push(new THREE.Vector3(x, y, z));
      // Perspective makes the near rail project wider than the far one, so the
      // fit is iterative: centre the table in the frame, then zoom to it.
      const ndc = new THREE.Vector3(),
        target = new THREE.Vector3(0, -0.02, 0);
      let distance = 14 * (36 / camera.fov);
      for (let pass = 0; pass < 6; pass++) {
        camera.position.copy(target).addScaledVector(viewDirection, distance);
        camera.lookAt(target);
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        let left = Infinity,
          rightEdge = -Infinity,
          bottom = Infinity,
          top = -Infinity;
        for (const corner of corners) {
          ndc.copy(corner).project(camera);
          left = Math.min(left, ndc.x);
          rightEdge = Math.max(rightEdge, ndc.x);
          bottom = Math.min(bottom, ndc.y);
          top = Math.max(top, ndc.y);
        }
        target
          .addScaledVector(
            right,
            ((left + rightEdge) / 2) * tan * camera.aspect * distance,
          )
          .addScaledVector(up, ((bottom + top) / 2) * tan * distance);
        distance *= Math.max(rightEdge - left, top - bottom) / 2 / 0.985;
      }
      camera.position.copy(target).addScaledVector(viewDirection, distance);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
    };
    refit.current = resize;
    const observer = new ResizeObserver(() => resize(flags.current.view));
    observer.observe(host);
    resize();
    let frame = 0,
      lastTime = performance.now(),
      previousGame = gameRef.current;
    const snapshots: VisualSnapshot[] = [
      { time: lastTime, balls: previousGame.balls.map((b) => ({ ...b })) },
    ];
    const rotationAxis = new THREE.Vector3();
    const animate = (now: number) => {
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const g = gameRef.current;
      // Server states arrive ~30 times a second as whole new objects, so
      // they are buffered and replayed 70 ms late to look smooth. A game
      // stepped locally changes in place 120 times a second and must be
      // drawn directly — buffering it would freeze the table.
      const interpolated = !g.solo && !flags.current.live;
      if (interpolated && g !== previousGame) {
        snapshots.push({ time: now, balls: g.balls.map((b) => ({ ...b })) });
        if (snapshots.length > 14) snapshots.shift();
        previousGame = g;
      }
      const visualBalls = interpolated
        ? sampleSnapshots(snapshots, now - 70)
        : g.balls;
      for (const b of visualBalls) {
        const m = balls.get(b.id)!;
        if (b.pocketed) {
          if (!falling.has(b.id) && m.visible) {
            const pocket = POCKETS.reduce((a, p) =>
              Math.hypot(b.x - p[0], b.y - p[1]) <
              Math.hypot(b.x - a[0], b.y - a[1])
                ? p
                : a,
            );
            falling.set(b.id, {
              time: now,
              x: m.position.x,
              z: m.position.z,
              px: pocket[0],
              pz: pocket[1],
            });
          }
          const fall = falling.get(b.id);
          if (fall) {
            const t = Math.min(1, (now - fall.time) / 230);
            m.position.set(
              THREE.MathUtils.lerp(fall.x, fall.px, t),
              RADIUS + 0.035 - 0.72 * t * t,
              THREE.MathUtils.lerp(fall.z, fall.pz, t),
            );
            m.visible = t < 1;
            if (t < 1 || now - fall.time < 350) {
              sceneDirty = true;
              renderer.shadowMap.needsUpdate = true;
            }
          }
          continue;
        }
        if (
          !m.visible ||
          Math.abs(m.position.x - b.x) + Math.abs(m.position.z - b.y) >
            0.00001 ||
          Math.hypot(b.wx, b.wz) > 0.001
        ) {
          sceneDirty = true;
          renderer.shadowMap.needsUpdate = true;
        }
        falling.delete(b.id);
        m.visible = true;
        // No exponential damping: local position follows physics immediately.
        m.position.set(b.x, RADIUS + 0.035, b.y);
        const angularSpeed = Math.hypot(b.wx, b.wz);
        if (angularSpeed > 0.0001)
          m.rotateOnWorldAxis(
            rotationAxis.set(b.wx, 0, b.wz).normalize(),
            angularSpeed * delta,
          );
      }
      // The cue and the aim marks belong to the ball as it is DRAWN, not as
      // the state has it: online that is the interpolated position, locally
      // the live one. Its screen position is published in `data-grip`.
      const b = visualBalls.find((b) => b.id === 0) ?? g.balls[0],
        angle = angleRef.current,
        dx = Math.cos(angle),
        dz = Math.sin(angle);
      const visible =
        (flags.current.canAim || strokeRef.current !== null) &&
        !g.moving &&
        g.winner === null &&
        !b.pocketed;
      if (
        lastAngle !== angle ||
        lastPower !== flags.current.power ||
        lastVisible !== visible
      ) {
        sceneDirty = true;
        renderer.shadowMap.needsUpdate = true;
        lastAngle = angle;
        lastPower = flags.current.power;
        lastVisible = visible;
      }
      cue.visible = ghost.visible = visible;
      if (!visible) target.visible = contact.visible = false;
      if (!visible && renderer.domElement.dataset.grip)
        delete renderer.domElement.dataset.grip;
      if (strokeRef.current) {
        sceneDirty = true;
        renderer.shadowMap.needsUpdate = true;
      }
      if (visible && sceneDirty) {
        const gap = cueGap(strokeRef.current, now, flags.current.power);
        cue.position.set(b.x - dx * gap, RADIUS + 0.035, b.y - dz * gap);
        cue.rotation.y = -angle;
        // Publish where the cue grip sits on screen: the hint layer and the
        // end-to-end tests use it to grab the stick exactly like a finger does.
        const grip = toClient(b.x - dx * (gap + 1.9), b.y - dz * (gap + 1.9)),
          centre = toClient(b.x, b.y);
        renderer.domElement.dataset.grip = [...grip, ...centre]
          .map((n) => Math.round(n))
          .join(",");
        let dist = WIDTH,
          hit: (typeof g.balls)[number] | null = null;
        for (let t = RADIUS; t < WIDTH; t += 0.025) {
          const x = b.x + dx * t,
            z = b.y + dz * t;
          if (
            Math.abs(x) > WIDTH / 2 + 0.4 ||
            Math.abs(z) > HEIGHT / 2 + 0.4 ||
            POCKETS.some(
              ([px, pz]) => Math.hypot(x - px, z - pz) < POCKET_CAPTURE_RADIUS,
            ) ||
            CUSHION_SEGMENTS.some(([a, b]) => {
              const sx = b[0] - a[0],
                sz = b[1] - a[1];
              const u = Math.max(
                0,
                Math.min(
                  1,
                  ((x - a[0]) * sx + (z - a[1]) * sz) / (sx * sx + sz * sz),
                ),
              );
              return Math.hypot(x - a[0] - u * sx, z - a[1] - u * sz) < RADIUS;
            }) ||
            (hit =
              g.balls.find(
                (o) =>
                  o.id !== 0 &&
                  !o.pocketed &&
                  Math.hypot(o.x - x, o.y - z) < RADIUS * 2,
              ) ?? null)
          ) {
            dist = t;
            break;
          }
        }
        // The circle where the cue ball stops, with one short stripe coming
        // into it. Nothing is drawn next to the cue ball itself.
        const gx = b.x + dx * dist,
          gz = b.y + dz * dist;
        ghost.position.set(gx, AIM.y, gz);
        // Keep the stripe clear of both balls, and drop it when a near-touching
        // ball leaves no room for it.
        const room = dist - RADIUS * 2 - AIM.gap * 2;
        contact.visible = visible && room > AIM.contactLength;
        if (contact.visible)
          placeStripe(
            contact,
            gx - dx * (RADIUS + AIM.gap),
            gz - dz * (RADIUS + AIM.gap),
            dx,
            dz,
            AIM.contactLength,
          );
        // Where the object ball leaves the collision: centre to centre.
        if (hit) {
          const ox = hit.x - gx,
            oz = hit.y - gz,
            len = Math.hypot(ox, oz) || 1,
            ux = ox / len,
            uz = oz / len,
            reach = RADIUS + AIM.gap + AIM.targetLength;
          placeStripe(
            target,
            hit.x + ux * reach,
            hit.y + uz * reach,
            ux,
            uz,
            AIM.targetLength,
          );
        }
        target.visible = !!hit;
      }
      if (sceneDirty) {
        renderer.render(scene, camera);
        sceneDirty = false;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointercancel", up);
      const textures = new Set<THREE.Texture>();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((mat) => {
            Object.values(mat).forEach((value) => {
              if (value instanceof THREE.Texture) textures.add(value);
            });
            mat.dispose();
          });
        }
      });
      textures.forEach((t) => t.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [resetKey]);
  useEffect(() => {
    refit.current(view);
  }, [view]);
  return <div className="table-canvas" ref={container} />;
}
