import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { type Game, WIDTH, HEIGHT, RADIUS, POCKETS } from "../shared/game";
import { createTableBody } from "./tableScene";
import { CUSHION_SEGMENTS, POCKET_CAPTURE_RADIUS } from "../shared/table";
import {
  sampleSnapshots,
  cueGap,
  type VisualSnapshot,
  type CueStroke,
} from "../shared/rendering";

export const BALL_COLORS = [
  "#f9f5e8",
  "#efbe28",
  "#2868b5",
  "#df493a",
  "#824eaa",
  "#e98b28",
  "#2e8e6c",
  "#a13236",
  "#14191b",
  "#efbe28",
  "#2868b5",
  "#df493a",
  "#824eaa",
  "#e98b28",
  "#2e8e6c",
  "#a13236",
];
type Props = {
  gameRef: React.RefObject<Game>;
  angleRef: React.RefObject<number>;
  onAim: (angle: number) => void;
  /** Live power while the cue is held back (0..1), null once it is released. */
  onCharge: (power: number | null) => void;
  /** Fired when a pulled cue is released, with the power it was charged to. */
  onShoot: (power: number) => void;
  canAim: boolean;
  power: number;
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
      ctx.fillStyle = "#fffdf4";
      ctx.beginPath();
      ctx.arc(x, 256, 74, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#161c1e";
      ctx.font = "bold 96px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(id), x, 262);
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
  onCharge,
  onShoot,
  canAim,
  power,
  resetKey,
  strokeRef,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    // How far the player is currently pulling the cue back, 0..1.
    pull = useRef(0),
    flags = useRef({ canAim, power, onAim, onCharge, onShoot });
  flags.current = { canAim, power, onAim, onCharge, onShoot };
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
    // ACES washed the cloth and the balls out; neutral keeps them saturated.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.12;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "3D-бильярдный стол. Потяни по сукну, чтобы повернуть кий, и оттяни кий назад, чтобы ударить.",
    );
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    // The table is always shown along its long side; a portrait phone rotates
    // the whole screen instead (see .is-rotated), so the view never changes.
    const viewDirection = new THREE.Vector3(0.18, 12.5, 10).normalize();
    const pmrem = new THREE.PMREMGenerator(renderer),
      envScene = new RoomEnvironment(),
      env = pmrem.fromScene(envScene, 0.06);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.6;
    scene.add(new THREE.HemisphereLight(0xdbe9ef, 0x15100c, 0.42));
    const key = new THREE.DirectionalLight(0xfff4df, 3.1);
    key.position.set(-3.5, 8, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.normalBias = 0.006;
    key.shadow.bias = -0.00008;
    key.shadow.radius = 2.2;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa6c9d6, 0.7);
    fill.position.set(5, 5, -5);
    scene.add(fill);
    // Rim light along the far rail: the balls get a bright edge and read as
    // spheres instead of flat discs.
    const rim = new THREE.DirectionalLight(0xfff0cf, 1.5);
    rim.position.set(2, 2.4, -9);
    scene.add(rim);
    // A real hall lamp hangs low over the cloth: bright centre, darker rails.
    const overhead = new THREE.SpotLight(
      0xfffbe8,
      190,
      26,
      Math.PI * 0.33,
      0.68,
      2,
    );
    overhead.position.set(0, 6.4, 0);
    overhead.target.position.set(0, 0, 0);
    scene.add(overhead, overhead.target);
    const material = (color: string, roughness = 0.55, metalness = 0) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness });
    createTableBody(scene);
    const balls = new Map<number, THREE.Mesh>();
    const falling = new Map<
      number,
      { time: number; x: number; z: number; px: number; pz: number }
    >();
    for (const b of gameRef.current.balls) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(RADIUS, 48, 32),
        new THREE.MeshPhysicalMaterial({
          map: ballTexture(b.id, renderer.capabilities.getMaxAnisotropy()),
          roughness: 0.12,
          metalness: 0,
          clearcoat: 0.8,
          clearcoatRoughness: 0.06,
          envMapIntensity: 0.95,
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
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.027, 0.048, 2.2, 16),
      material("#d9c29a", 0.35),
    );
    shaft.rotation.z = -Math.PI / 2;
    shaft.position.x = -RADIUS - 0.04 - 1.1;
    cue.add(shaft);
    const butt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.048, 0.062, 1.35, 16),
      material("#3d2520", 0.3),
    );
    butt.rotation.z = -Math.PI / 2;
    butt.position.x = -RADIUS - 0.04 - 2.2 - 0.675;
    cue.add(butt);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.065, 12),
      material("#5caaa3"),
    );
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = -RADIUS - 0.0325;
    cue.add(tip);
    scene.add(cue);
    const aimGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const aim = new THREE.Line(
      aimGeo,
      new THREE.LineDashedMaterial({
        color: 0xd6f4dc,
        dashSize: 0.1,
        gapSize: 0.11,
        transparent: true,
        opacity: 0.7,
      }),
    );
    scene.add(aim);
    const ghost = new THREE.Mesh(
      new THREE.RingGeometry(RADIUS * 0.91, RADIUS, 40),
      new THREE.MeshBasicMaterial({
        color: 0xe1ffe3,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    ghost.rotation.x = -Math.PI / 2;
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
    let drag: {
      id: number;
      mode: "aim" | "pull";
      grabAngle: number;
      startAim: number;
      startDistance: number;
    } | null = null;
    const down = (e: PointerEvent) => {
      // One hand on the cue: a second finger must not hijack the stroke.
      if (drag || idle()) return;
      const p = clothPoint(e);
      if (!p) return;
      const b = cueBall();
      const dx = p.x - b.x,
        dz = p.z - b.y,
        angle = Math.atan2(dz, dx),
        distance = Math.hypot(dx, dz);
      // Taking hold of the cue behind the ball pulls it back for a shot;
      // grabbing anywhere else swings the cue around the ball.
      const onCue =
        Math.abs(wrap(angle - angleRef.current - Math.PI)) < 0.5 &&
        distance > RADIUS &&
        distance < 4.2;
      drag = {
        id: e.pointerId,
        mode: onCue ? "pull" : "aim",
        grabAngle: angle,
        startAim: angleRef.current,
        startDistance: distance,
      };
      renderer.domElement.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (idle()) {
        drag = null;
        pull.current = 0;
        flags.current.onCharge(null);
        return;
      }
      const p = clothPoint(e);
      if (!p) return;
      const b = cueBall();
      const dx = p.x - b.x,
        dz = p.z - b.y,
        angle = Math.atan2(dz, dx),
        distance = Math.hypot(dx, dz);
      // Right on top of the ball a pixel of travel is a huge angle: ignore it.
      if (distance > RADIUS * 2.5)
        flags.current.onAim(wrap(drag.startAim + wrap(angle - drag.grabAngle)));
      if (drag.mode === "aim") return;
      // The cue slides through the hand: how far back it went is the power.
      const next = Math.max(
        0,
        Math.min(1, (distance - drag.startDistance) / PULL_RANGE),
      );
      if (Math.abs(next - pull.current) < 0.002) return;
      pull.current = next;
      flags.current.onCharge(next);
    };
    const up = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const mode = drag.mode,
        charged = pull.current;
      drag = null;
      pull.current = 0;
      if (mode !== "pull") return;
      flags.current.onCharge(null);
      if (charged > 0.07 && !idle())
        flags.current.onShoot(Math.max(0.08, charged));
    };
    const cancel = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      pull.current = 0;
      flags.current.onCharge(null);
    };
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", cancel);
    let sceneDirty = true,
      lastAngle = Infinity,
      lastPower = -1,
      lastPull = -1,
      lastVisible = false;
    const resize = () => {
      sceneDirty = true;
      const w = host.clientWidth,
        h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
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
      for (const x of [-6.1, 6.1])
        for (const y of [-0.2, 0.18])
          for (const z of [-3.4, 3.4]) corners.push(new THREE.Vector3(x, y, z));
      // Perspective makes the near rail project wider than the far one, so the
      // fit is iterative: centre the table in the frame, then zoom to it.
      const ndc = new THREE.Vector3(),
        target = new THREE.Vector3(0, -0.02, 0);
      let distance = 14;
      for (let pass = 0; pass < 5; pass++) {
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
    const observer = new ResizeObserver(resize);
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
      if (!g.solo && g !== previousGame) {
        snapshots.push({ time: now, balls: g.balls.map((b) => ({ ...b })) });
        if (snapshots.length > 14) snapshots.shift();
        previousGame = g;
      }
      const visualBalls = g.solo
        ? g.balls
        : sampleSnapshots(snapshots, now - 70);
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
      const b = g.balls.find((b) => b.id === 0)!,
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
        lastPull !== pull.current ||
        lastVisible !== visible
      ) {
        sceneDirty = true;
        renderer.shadowMap.needsUpdate = true;
        lastAngle = angle;
        lastPower = flags.current.power;
        lastPull = pull.current;
        lastVisible = visible;
      }
      cue.visible = aim.visible = ghost.visible = visible;
      if (!visible && renderer.domElement.dataset.grip)
        delete renderer.domElement.dataset.grip;
      if (strokeRef.current) {
        sceneDirty = true;
        renderer.shadowMap.needsUpdate = true;
      }
      if (visible && sceneDirty) {
        const gap = cueGap(
          strokeRef.current,
          now,
          flags.current.power,
          pull.current,
        );
        cue.position.set(b.x - dx * gap, RADIUS + 0.035, b.y - dz * gap);
        cue.rotation.y = -angle;
        // Publish where the cue grip sits on screen: the hint layer and the
        // end-to-end tests use it to grab the stick exactly like a finger does.
        const grip = toClient(b.x - dx * (gap + 1.9), b.y - dz * (gap + 1.9)),
          centre = toClient(b.x, b.y);
        renderer.domElement.dataset.grip = [...grip, ...centre]
          .map((n) => Math.round(n))
          .join(",");
        let dist = WIDTH;
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
            g.balls.some(
              (o) =>
                o.id !== 0 &&
                !o.pocketed &&
                Math.hypot(o.x - x, o.y - z) < RADIUS * 2,
            )
          ) {
            dist = t;
            break;
          }
        }
        const arr = aim.geometry.attributes.position as THREE.BufferAttribute;
        arr.setXYZ(0, b.x, 0.06, b.y);
        arr.setXYZ(1, b.x + dx * dist, 0.06, b.y + dz * dist);
        arr.needsUpdate = true;
        aim.computeLineDistances();
        ghost.position.set(b.x + dx * dist, 0.062, b.y + dz * dist);
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
      renderer.domElement.removeEventListener("pointercancel", cancel);
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
      env.dispose();
      envScene.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [resetKey]);
  return <div className="table-canvas" ref={container} />;
}
