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
  canAim: boolean;
  power: number;
  resetKey: number;
  strokeRef: React.RefObject<CueStroke | null>;
  /** Turn the camera 90° when the container is taller than wide (Telegram phone screen). */
  portraitFit?: boolean;
};
function ballTexture(id: number) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = id > 8 ? "#faf5e8" : BALL_COLORS[id];
  ctx.fillRect(0, 0, 512, 256);
  if (id > 8) {
    ctx.fillStyle = BALL_COLORS[id];
    ctx.fillRect(0, 69, 512, 118);
  }
  if (id > 0)
    for (const x of [128, 384]) {
      ctx.fillStyle = "#fff9e8";
      ctx.beginPath();
      ctx.arc(x, 128, 37, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#182121";
      ctx.font = "bold 48px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(id), x, 130);
    }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export default function Table({
  gameRef,
  angleRef,
  onAim,
  canAim,
  power,
  resetKey,
  strokeRef,
  portraitFit = false,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    refit = useRef<() => void>(() => {}),
    flags = useRef({ canAim, power, onAim, portraitFit });
  flags.current = { canAim, power, onAim, portraitFit };
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
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, host.clientWidth < 600 ? 1.5 : 2),
    );
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "3D-бильярдный стол. Нажми на сукно, чтобы выбрать направление удара.",
    );
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    // Long side horizontal on a wide screen, vertical on a tall one: the camera
    // itself turns, so pointer picking, cue and aim stay in real world space.
    const landscapeView = new THREE.Vector3(0.18, 12.5, 10).normalize();
    // Steeper on a tall screen: the long side then fills the phone vertically.
    const portraitView = new THREE.Vector3(5.6, 12.5, -0.12).normalize();
    const viewDirection = landscapeView.clone();
    const pmrem = new THREE.PMREMGenerator(renderer),
      envScene = new RoomEnvironment(),
      env = pmrem.fromScene(envScene, 0.06);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.5;
    scene.add(new THREE.HemisphereLight(0xdbe9ef, 0x15100c, 0.55));
    const key = new THREE.DirectionalLight(0xfff4df, 3.1);
    key.position.set(-3.5, 8, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(
      host.clientWidth < 600 ? 1024 : 2048,
      host.clientWidth < 600 ? 1024 : 2048,
    );
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.normalBias = 0.006;
    key.shadow.bias = -0.00008;
    key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa6c9d6, 0.65);
    fill.position.set(5, 5, -5);
    scene.add(fill);
    const overhead = new THREE.SpotLight(
      0xf8ffe9,
      85,
      25,
      Math.PI * 0.38,
      0.9,
      2,
    );
    overhead.position.set(0, 7, 0);
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
        new THREE.SphereGeometry(RADIUS, 36, 24),
        new THREE.MeshPhysicalMaterial({
          map: ballTexture(b.id),
          roughness: 0.17,
          metalness: 0,
          clearcoat: 0.65,
          clearcoatRoughness: 0.12,
          envMapIntensity: 0.7,
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
    const setAim = (e: PointerEvent) => {
      if (!flags.current.canAim || gameRef.current.moving || strokeRef.current)
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      const rotated =
        host.closest(".is-expanded") &&
        window.matchMedia("(max-width:760px) and (orientation:portrait)")
          .matches;
      const u = (e.clientX - rect.left) / rect.width,
        v = (e.clientY - rect.top) / rect.height;
      mouse.set(
        rotated ? v * 2 - 1 : u * 2 - 1,
        rotated ? u * 2 - 1 : -v * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(plane, point)) {
        const b = gameRef.current.balls.find((b) => b.id === 0)!;
        flags.current.onAim(Math.atan2(point.z - b.y, point.x - b.x));
      }
    };
    let dragging = false;
    const down = (e: PointerEvent) => {
      dragging = true;
      renderer.domElement.setPointerCapture(e.pointerId);
      setAim(e);
    };
    const move = (e: PointerEvent) => {
      if (dragging || e.pointerType === "mouse") setAim(e);
    };
    const up = () => {
      dragging = false;
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", up);
    let sceneDirty = true,
      lastAngle = Infinity,
      lastPower = -1,
      lastVisible = false;
    const resize = () => {
      sceneDirty = true;
      const w = host.clientWidth,
        h = host.clientHeight;
      const portrait = flags.current.portraitFit && h > w * 1.08;
      viewDirection.copy(portrait ? portraitView : landscapeView);
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3()
        .crossVectors(viewDirection, right)
        .normalize();
      const corners: THREE.Vector3[] = [];
      for (const x of [-6.2, 6.2])
        for (const y of [-0.8, 0.3])
          for (const z of [-3.5, 3.5]) corners.push(new THREE.Vector3(x, y, z));
      let distance = 0;
      for (const corner of corners)
        distance = Math.max(
          distance,
          Math.abs(corner.dot(right)) / (tan * camera.aspect) +
            corner.dot(viewDirection),
          Math.abs(corner.dot(up)) / tan + corner.dot(viewDirection),
        );
      distance *= portrait ? 1.015 : 1.06;
      const target = new THREE.Vector3(0, -0.05, 0);
      camera.position.copy(viewDirection).multiplyScalar(distance);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      // The tilt leaves the table off-centre; recentre it in the viewport.
      const ndc = new THREE.Vector3();
      let top = -Infinity,
        bottom = Infinity;
      for (const corner of corners) {
        ndc.copy(corner).project(camera);
        top = Math.max(top, ndc.y);
        bottom = Math.min(bottom, ndc.y);
      }
      const shift = ((top + bottom) / 2) * tan * distance;
      if (Math.abs(shift) > 0.002) {
        camera.position.addScaledVector(up, shift);
        target.addScaledVector(up, shift);
        camera.lookAt(target);
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    refit.current = resize;
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
        lastVisible !== visible
      ) {
        sceneDirty = true;
        renderer.shadowMap.needsUpdate = true;
        lastAngle = angle;
        lastPower = flags.current.power;
        lastVisible = visible;
      }
      cue.visible = aim.visible = ghost.visible = visible;
      if (strokeRef.current) {
        sceneDirty = true;
        renderer.shadowMap.needsUpdate = true;
      }
      if (visible && sceneDirty) {
        const gap = cueGap(strokeRef.current, now, flags.current.power);
        cue.position.set(b.x - dx * gap, RADIUS + 0.035, b.y - dz * gap);
        cue.rotation.y = -angle;
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
      env.dispose();
      envScene.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [resetKey]);
  useEffect(() => {
    refit.current();
  }, [portraitFit]);
  return <div className="table-canvas" ref={container} />;
}
