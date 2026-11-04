/**
 * Robot3D — the assistant's animated 3D mascot (Three.js via React Three Fiber).
 *
 * The model is built from primitives (no downloaded assets): a glossy white
 * shell, a dark glass visor with glowing eyes, a blue cap/collar and two
 * arms on a round base. Everything moves in one useFrame loop:
 *   - idle bob and sway, random blinks (sometimes a double blink)
 *   - head and eyes follow the pointer anywhere on the page
 *   - moods: listening (tilt, wide eyes), thinking (looks up, pulsing glow),
 *     talking (eye "speech" squash, nods), happy (bounce, wave, ∩ eyes),
 *     error (red eyes, head shake)
 *   - clicking the robot (when interactive) makes it wave and bounce
 *
 * Lazy-loaded by ChatCopilot so three.js never sits in the main bundle.
 * With prefers-reduced-motion the scene renders a single still frame.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RobotMood } from './types';

const SHELL = '#F6F8FC';
const ACCENT = '#2F86F6';
const ACCENT_SOFT = '#A9D0FF';
const VISOR = '#0A1020';
const EYE = new THREE.Color('#62D8FF');
const EYE_ERROR = new THREE.Color('#FF6B7A');

/* One window-level pointer shared by every robot, so a robot in a corner
   can still look at the cursor wherever it is on the page. */
const pointer = { x: -1, y: -1, bound: false };
function bindPointer() {
  if (pointer.bound || typeof window === 'undefined') return;
  pointer.bound = true;
  pointer.x = window.innerWidth / 2;
  pointer.y = window.innerHeight / 2;
  window.addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });
}

const damp = (cur: number, target: number, lambda: number, dt: number) => THREE.MathUtils.damp(cur, target, lambda, dt);

function RobotModel({ mood, interactive, onPoke }: { mood: RobotMood; interactive: boolean; onPoke?: () => void }) {
  const root = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const eyes = useRef<THREE.Group>(null!);
  const openEyes = useRef<THREE.Group>(null!);
  const happyEyes = useRef<THREE.Group>(null!);
  const eyeL = useRef<THREE.Mesh>(null!);
  const eyeR = useRef<THREE.Mesh>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const eyeLight = useRef<THREE.PointLight>(null!);
  const { gl } = useThree();

  const anim = useRef({
    nextBlink: 1.2, blinkStart: -10, doubleAt: 0,
    pokeStart: -10, pokePending: false,
    shakeStart: -10, shakePending: false,
    hovered: false,
    eyeSx: 1, eyeSy: 1,
    rect: null as DOMRect | null, rectAt: -1,
  });
  const tmp = useMemo(() => new THREE.Color(), []);

  const mats = useMemo(() => ({
    shell: new THREE.MeshPhysicalMaterial({ color: SHELL, roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.16 }),
    accent: new THREE.MeshPhysicalMaterial({ color: ACCENT, roughness: 0.28, clearcoat: 0.7, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.18 }),
    accentSoft: new THREE.MeshPhysicalMaterial({ color: ACCENT_SOFT, roughness: 0.4, clearcoat: 0.4 }),
    visor: new THREE.MeshPhysicalMaterial({ color: VISOR, roughness: 0.1, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04 }),
    earInner: new THREE.MeshStandardMaterial({ color: '#3A4458', roughness: 0.55 }),
    eye: new THREE.MeshBasicMaterial({ color: EYE.clone(), toneMapped: false }),
    ring: new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35, toneMapped: false, side: THREE.DoubleSide }),
    shadow: new THREE.MeshBasicMaterial({ color: '#0A1020', transparent: true, opacity: 0.1 }),
  }), []);
  useEffect(() => () => { Object.values(mats).forEach(m => m.dispose()); }, [mats]);

  useEffect(() => { if (mood === 'error') anim.current.shakePending = true; }, [mood]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const a = anim.current;
    if (a.pokePending) { a.pokeStart = t; a.pokePending = false; }
    if (a.shakePending) { a.shakeStart = t; a.shakePending = false; }
    const m: RobotMood = t - a.pokeStart < 1.8 ? 'happy' : mood;

    // Where is the pointer relative to this canvas? (rect refreshed twice a second)
    if (!a.rect || t - a.rectAt > 0.5) { a.rect = gl.domElement.getBoundingClientRect(); a.rectAt = t; }
    const r = a.rect;
    const dx = THREE.MathUtils.clamp((pointer.x - (r.left + r.width / 2)) / (window.innerWidth * 0.45), -1, 1);
    const dy = THREE.MathUtils.clamp((pointer.y - (r.top + r.height / 2)) / (window.innerHeight * 0.45), -1, 1);

    // Body: gentle float, bouncy when happy
    const bob = m === 'happy' ? Math.abs(Math.sin(t * 7)) * 0.11 : Math.sin(t * 1.8) * 0.035;
    root.current.position.y = damp(root.current.position.y, bob, 14, dt);
    root.current.rotation.z = damp(root.current.rotation.z, m === 'happy' ? Math.sin(t * 7) * 0.05 : Math.sin(t * 0.9) * 0.02, 8, dt);
    root.current.rotation.y = damp(root.current.rotation.y, dx * 0.18, 4, dt);

    // Head: follow the pointer, with mood-specific poses
    let yaw = dx * 0.55, pitch = dy * 0.32, roll = -dx * 0.08;
    if (m === 'thinking') { yaw = Math.sin(t * 0.9) * 0.3; pitch = -0.26; roll = 0.14; }
    if (m === 'listening') { roll = 0.14; pitch += 0.04; }
    if (m === 'talking') pitch += Math.sin(t * 9) * 0.05;
    if (m === 'happy') { roll = Math.sin(t * 7) * 0.1; pitch = -0.08; }
    if (a.hovered && m === 'idle') roll = -0.16;
    const shakeT = t - a.shakeStart;
    if (shakeT < 0.9) yaw += Math.sin(shakeT * 30) * 0.28 * (1 - shakeT / 0.9);
    head.current.rotation.y = damp(head.current.rotation.y, yaw, 7, dt);
    head.current.rotation.x = damp(head.current.rotation.x, pitch, 7, dt);
    head.current.rotation.z = damp(head.current.rotation.z, roll, 7, dt);

    // Blink every 2–5.5s, sometimes twice
    if (t > a.nextBlink) {
      a.blinkStart = t;
      a.nextBlink = t + 2 + Math.random() * 3.5;
      if (Math.random() < 0.22) a.doubleAt = t + 0.24;
    }
    if (a.doubleAt && t > a.doubleAt) { a.blinkStart = t; a.doubleAt = 0; }
    const bp = (t - a.blinkStart) / 0.15;
    const lid = bp >= 0 && bp < 1 ? 1 - Math.sin(bp * Math.PI) * 0.93 : 1;

    let sx = 1, sy = 1;
    if (m === 'talking') sy = 0.68 + 0.32 * Math.abs(Math.sin(t * 11));
    if (m === 'listening' || a.hovered) { sx = 1.12; sy = 1.12; }
    if (m === 'thinking') sy = 0.82;
    if (m === 'error') sy = 0.6;
    // Mood shape is eased; the blink is applied on top so it stays crisp.
    a.eyeSx = damp(a.eyeSx, sx, 10, dt);
    a.eyeSy = damp(a.eyeSy, sy, 10, dt);
    for (const eye of [eyeL.current, eyeR.current]) eye.scale.set(1.2 * a.eyeSx, a.eyeSy * lid, 0.3);
    openEyes.current.visible = m !== 'happy';
    happyEyes.current.visible = m === 'happy';
    eyes.current.position.x = damp(eyes.current.position.x, dx * 0.045 + (m === 'thinking' ? 0.04 : 0), 8, dt);
    eyes.current.position.y = damp(eyes.current.position.y, -dy * 0.03 + (m === 'thinking' ? 0.05 : 0), 8, dt);

    // Glow: eye colour, pulse while thinking, a soft light on the visor
    const pulse = m === 'thinking' ? 0.85 + 0.4 * Math.sin(t * 5) : 1.1;
    tmp.copy(m === 'error' ? EYE_ERROR : EYE).multiplyScalar(pulse);
    mats.eye.color.lerp(tmp, 1 - Math.exp(-8 * dt));
    eyeLight.current.color.copy(mats.eye.color);
    eyeLight.current.intensity = 0.7 * pulse;
    mats.accent.emissiveIntensity = m === 'thinking' ? 0.35 + 0.3 * Math.sin(t * 6) : 0.18;

    // Arms: sway; wave hello when happy; little gestures while talking
    const talk = m === 'talking' ? Math.sin(t * 4) * 0.18 : 0;
    const left = m === 'happy' ? -2.35 + Math.sin(t * 12) * 0.35 : -0.2 - Math.sin(t * 1.8) * 0.04 - talk;
    const right = m === 'thinking' ? 0.7 : 0.2 + Math.sin(t * 1.8 + 1) * 0.04 + talk;
    armL.current.rotation.z = damp(armL.current.rotation.z, left, 9, dt);
    armR.current.rotation.z = damp(armR.current.rotation.z, right, 9, dt);

    // Glow ring under the base
    const speed = m === 'thinking' ? 6 : 2;
    const s = 1 + Math.sin(t * speed) * 0.05;
    ring.current.scale.set(s, s, 1);
    mats.ring.opacity = (m === 'thinking' ? 0.5 : 0.3) + Math.sin(t * speed) * 0.1;
  });

  const events = interactive ? {
    onPointerDown: (e: { stopPropagation: () => void }) => { e.stopPropagation(); anim.current.pokePending = true; onPoke?.(); },
    onPointerOver: () => { anim.current.hovered = true; document.body.style.cursor = 'pointer'; },
    onPointerOut: () => { anim.current.hovered = false; document.body.style.cursor = ''; },
  } : {};

  return (
    <group ref={root} {...events}>
      {/* Base, contact shadow and glow ring */}
      <mesh position={[0, -1.4, 0]} material={mats.shell}>
        <cylinderGeometry args={[1.0, 1.06, 0.1, 64]} />
      </mesh>
      <mesh position={[0, -1.344, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.shadow}>
        <circleGeometry args={[0.55, 48]} />
      </mesh>
      <mesh ref={ring} position={[0, -1.338, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.ring}>
        <ringGeometry args={[0.86, 0.94, 64]} />
      </mesh>

      {/* Body */}
      <group position={[0, -0.58, 0]}>
        <mesh scale={[0.95, 1.12, 0.9]} material={mats.shell}>
          <sphereGeometry args={[0.62, 48, 48]} />
        </mesh>
        <mesh position={[0, 0.62, 0.02]} scale={[1.15, 0.28, 1.05]} material={mats.accent}>
          <sphereGeometry args={[0.36, 32, 24]} />
        </mesh>
        <mesh position={[0.08, 0.43, 0.44]} rotation={[0.35, 0, 0]} scale={[1, 1, 0.6]} material={mats.accent}>
          <capsuleGeometry args={[0.075, 0.2, 8, 16]} />
        </mesh>

        {/* Arms pivot at the shoulders */}
        <group ref={armL} position={[-0.56, 0.22, 0]}>
          <mesh position={[0, -0.3, 0]} scale={[1, 1, 0.6]} material={mats.shell}>
            <capsuleGeometry args={[0.12, 0.38, 8, 16]} />
          </mesh>
          <mesh position={[0.05, -0.3, 0.02]} scale={[1, 1, 0.55]} material={mats.accentSoft}>
            <capsuleGeometry args={[0.085, 0.3, 8, 16]} />
          </mesh>
        </group>
        <group ref={armR} position={[0.56, 0.22, 0]}>
          <mesh position={[0, -0.3, 0]} scale={[1, 1, 0.6]} material={mats.shell}>
            <capsuleGeometry args={[0.12, 0.38, 8, 16]} />
          </mesh>
          <mesh position={[-0.05, -0.3, 0.02]} scale={[1, 1, 0.55]} material={mats.accentSoft}>
            <capsuleGeometry args={[0.085, 0.3, 8, 16]} />
          </mesh>
        </group>
      </group>

      {/* Head pivots at the neck */}
      <group ref={head} position={[0, 0.08, 0]}>
        <mesh position={[0, 0.6, 0]} scale={[1.1, 0.95, 0.95]} material={mats.shell}>
          <sphereGeometry args={[0.62, 64, 64]} />
        </mesh>
        <mesh position={[0, 1.15, 0.02]} scale={[1.5, 0.32, 1.15]} material={mats.accent}>
          <sphereGeometry args={[0.27, 32, 24]} />
        </mesh>
        {[-1, 1].map(side => (
          <group key={side} position={[side * 0.66, 0.58, -0.02]} rotation={[0, 0, Math.PI / 2]}>
            <mesh material={mats.shell}><cylinderGeometry args={[0.18, 0.18, 0.12, 32]} /></mesh>
            <mesh position={[0, side * 0.01, 0]} material={mats.earInner}><cylinderGeometry args={[0.115, 0.115, 0.135, 32]} /></mesh>
          </group>
        ))}

        {/* Visor and glowing eyes */}
        <mesh position={[0, 0.58, 0.34]} scale={[1, 0.76, 0.56]} material={mats.visor}>
          <sphereGeometry args={[0.5, 48, 48]} />
        </mesh>
        <group ref={eyes}>
          <group ref={openEyes}>
            <mesh ref={eyeL} position={[-0.17, 0.6, 0.63]} scale={[1.2, 1, 0.3]} material={mats.eye}>
              <sphereGeometry args={[0.085, 24, 24]} />
            </mesh>
            <mesh ref={eyeR} position={[0.17, 0.6, 0.63]} scale={[1.2, 1, 0.3]} material={mats.eye}>
              <sphereGeometry args={[0.085, 24, 24]} />
            </mesh>
          </group>
          <group ref={happyEyes} visible={false}>
            {[-0.17, 0.17].map(x => (
              <mesh key={x} position={[x, 0.57, 0.63]} scale={[1.15, 1, 0.4]} material={mats.eye}>
                <torusGeometry args={[0.075, 0.028, 12, 32, Math.PI]} />
              </mesh>
            ))}
          </group>
        </group>
        <pointLight ref={eyeLight} position={[0, 0.6, 1.0]} distance={2.2} intensity={0.7} color={EYE} />
      </group>
    </group>
  );
}

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export interface Robot3DProps {
  mood?: RobotMood;
  /** Clicking the robot makes it wave; off for the launcher, whose button owns the click. */
  interactive?: boolean;
  onPoke?: () => void;
  className?: string;
}

export default function Robot3D({ mood = 'idle', interactive = false, onPoke, className = '' }: Robot3DProps) {
  useEffect(bindPointer, []);
  const still = useMemo(prefersReducedMotion, []);
  return (
    <div className={className} style={interactive ? undefined : { pointerEvents: 'none' }}>
      <Canvas
        dpr={[1, 2]}
        frameloop={still ? 'demand' : 'always'}
        camera={{ position: [0, 0.02, 6.4], fov: 30 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.55} />
        <hemisphereLight args={['#ffffff', '#cfe3ff', 1.6]} />
        <directionalLight position={[2.5, 4, 5]} intensity={2.4} />
        <directionalLight position={[-3, 1.5, -2]} intensity={1} color="#BFD8FF" />
        <RobotModel mood={mood} interactive={interactive} onPoke={onPoke} />
      </Canvas>
    </div>
  );
}
