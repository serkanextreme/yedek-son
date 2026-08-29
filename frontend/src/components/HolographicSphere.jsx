import React, { useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSettings, resolveQuality } from "../lib/settings";

// Görsellik / performans seviyeleri — Ayarlar → Performans'tan seçilir.
// high = mevcut hal; normal = 30fps + azaltılmış; low = 3B kapalı (CSS parıltı).
const QUALITY_PRESETS = {
  high: { nodes: 60, conns: 40, dpr: [1, 2], frameloop: "always", fps: 0 },
  normal: { nodes: 36, conns: 24, dpr: [1, 1.5], frameloop: "demand", fps: 30 },
};

// frameloop="demand" iken hedef FPS'te render tetikler → GPU tasarrufu.
const FpsCap = ({ fps }) => {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf;
    let last = 0;
    const interval = 1000 / fps;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= interval) {
        last = t;
        invalidate();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, invalidate]);
  return null;
};

// state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

// Distribute points on sphere surface using Fibonacci lattice
const generateNodes = (NODE_COUNT) => {
  const nodes = [];
  const radius = 1.9;
  const phi = Math.PI * (Math.sqrt(5) - 1); // golden angle
  for (let i = 0; i < NODE_COUNT; i++) {
    const y = 1 - (i / (NODE_COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    nodes.push([x * radius, y * radius, z * radius]);
  }
  return nodes;
};

// Pick pairs of nearby nodes for connections
const generateConnections = (nodes, CONNECTION_COUNT) => {
  const conns = [];
  const used = new Set();
  for (let i = 0; i < CONNECTION_COUNT; i++) {
    const a = Math.floor(Math.random() * nodes.length);
    // find a close-ish neighbor
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < nodes.length; j++) {
      if (j === a) continue;
      const key = `${Math.min(a, j)}-${Math.max(a, j)}`;
      if (used.has(key)) continue;
      const dx = nodes[a][0] - nodes[j][0];
      const dy = nodes[a][1] - nodes[j][1];
      const dz = nodes[a][2] - nodes[j][2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist && d > 0.4) {
        bestDist = d;
        best = j;
      }
    }
    if (best >= 0) {
      const key = `${Math.min(a, best)}-${Math.max(a, best)}`;
      used.add(key);
      conns.push([a, best, Math.random()]); // third value = phase offset
    }
  }
  return conns;
};

const NodesAndConnections = ({ state, color, nodeCount, connCount }) => {
  const groupRef = useRef();
  const nodesRef = useRef([]);
  const linesRef = useRef([]);

  const nodes = useMemo(() => generateNodes(nodeCount), [nodeCount]);
  const connections = useMemo(() => generateConnections(nodes, connCount), [nodes, connCount]);

  useFrame((clockState, delta) => {
    if (!groupRef.current) return;
    const t = clockState.clock.getElapsedTime();
    // orbit rotation
    const speedMul =
      state === "speaking" ? 1.8 : state === "thinking" ? 2.5 : state === "listening" ? 1.3 : 1;
    groupRef.current.rotation.y += delta * 0.12 * speedMul;
    groupRef.current.rotation.x += delta * 0.05 * speedMul;

    // Animate node dots (pulse individually)
    nodesRef.current.forEach((mesh, i) => {
      if (!mesh) return;
      const phase = (i * 0.37) % (Math.PI * 2);
      const pulse = 0.7 + Math.sin(t * 1.5 + phase) * 0.3;
      mesh.scale.setScalar(pulse);
      if (mesh.material) mesh.material.opacity = 0.5 + pulse * 0.4;
    });

    // Animate connection lines (firing effect)
    linesRef.current.forEach((line, i) => {
      if (!line || !line.material) return;
      const phase = connections[i][2] * Math.PI * 2;
      const fireIntensity = Math.max(0, Math.sin(t * 2 + phase));
      const boost = state === "thinking" || state === "speaking" ? 1.5 : 1;
      line.material.opacity = 0.08 + fireIntensity * 0.6 * boost;
    });
  });

  return (
    <group ref={groupRef}>
      {/* Node dots */}
      {nodes.map((pos, i) => (
        <mesh
          key={`node-${i}`}
          position={pos}
          ref={(el) => (nodesRef.current[i] = el)}
        >
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.9}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
      {/* Connection lines */}
      {connections.map(([a, b], i) => {
        const pa = nodes[a];
        const pb = nodes[b];
        const points = [new THREE.Vector3(...pa), new THREE.Vector3(...pb)];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        return (
          <line
            key={`line-${i}`}
            geometry={geom}
            ref={(el) => (linesRef.current[i] = el)}
          >
            <lineBasicMaterial
              color={color}
              transparent
              opacity={0.2}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </line>
        );
      })}
    </group>
  );
};

const InnerCore = ({ state, nodeCount, connCount }) => {
  const meshRef = useRef();
  const glowRef = useRef();
  const coreRef = useRef();
  const { colors } = useSettings();

  useFrame((clockState, delta) => {
    if (!meshRef.current) return;
    const t = clockState.clock.getElapsedTime();

    meshRef.current.rotation.y += delta * 0.15;
    meshRef.current.rotation.x += delta * 0.06;

    let scale = 1;
    if (state === "listening") {
      scale = 1 + Math.sin(t * 4) * 0.08;
    } else if (state === "thinking") {
      scale = 1 + Math.sin(t * 2) * 0.03;
      meshRef.current.rotation.y += delta * 0.6;
    } else if (state === "speaking") {
      scale = 1 + Math.sin(t * 8) * 0.1 + Math.sin(t * 13) * 0.04;
    } else {
      scale = 1 + Math.sin(t * 0.8) * 0.02;
    }
    meshRef.current.scale.setScalar(scale);
    if (glowRef.current) glowRef.current.scale.setScalar(scale * 1.35);
    if (coreRef.current) coreRef.current.scale.setScalar(scale * 0.95);
  });

  const color = useMemo(() => {
    if (state === "error") return colors.error;
    if (state === "speaking") return colors.speaking;
    if (state === "listening") return colors.listening;
    if (state === "thinking") return colors.thinking;
    return colors.idle;
  }, [state, colors]);

  return (
    <group>
      {/* Outer atmospheric glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[1.35, 32, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.14}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* Main wireframe globe */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[1.15, 24, 18]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.75} />
      </mesh>
      {/* Inner denser wireframe */}
      <mesh>
        <icosahedronGeometry args={[0.95, 3]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.4} />
      </mesh>
      {/* Inner glowing core */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.45, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={2.8}
          metalness={0.4}
          roughness={0.2}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Core halo */}
      <mesh>
        <sphereGeometry args={[0.6, 32, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.25}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* Neural nodes + connections orbiting around */}
      <NodesAndConnections state={state} color={color} nodeCount={nodeCount} connCount={connCount} />
    </group>
  );
};

const HolographicSphere = ({ state = "idle", onClick }) => {
  const { quality } = useSettings();
  const effQuality = resolveQuality(quality);

  const webglOk = useMemo(() => {
    try {
      const c = document.createElement("canvas");
      return !!(
        window.WebGLRenderingContext &&
        (c.getContext("webgl") || c.getContext("experimental-webgl"))
      );
    } catch {
      return false;
    }
  }, []);

  // Düşük seviye VEYA WebGL yok → hafif CSS parıltı (WebGL render yok, GPU ~0).
  if (!webglOk || effQuality === "low") {
    return (
      <div
        className="w-full h-full cursor-pointer flex items-center justify-center"
        onClick={onClick}
        data-testid="holographic-sphere-fallback"
      >
        <div
          style={{
            width: "58%",
            aspectRatio: "1 / 1",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,240,255,0.28), rgba(0,102,255,0.08) 60%, transparent 72%)",
            boxShadow: "0 0 60px rgba(0,240,255,0.35)",
          }}
        />
      </div>
    );
  }

  const preset = QUALITY_PRESETS[effQuality] || QUALITY_PRESETS.high;

  return (
    <div
      className="w-full h-full cursor-pointer"
      onClick={onClick}
      data-testid="holographic-sphere"
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 55 }}
        dpr={preset.dpr}
        frameloop={preset.frameloop}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
      >
        {preset.fps ? <FpsCap fps={preset.fps} /> : null}
        <ambientLight intensity={0.6} />
        <pointLight position={[3, 3, 3]} intensity={2} color="#00F0FF" />
        <pointLight position={[-3, -2, -3]} intensity={1.2} color="#0066FF" />
        <pointLight position={[0, 0, 2]} intensity={1.5} color="#66E5FF" />
        <InnerCore state={state} nodeCount={preset.nodes} connCount={preset.conns} />
      </Canvas>
    </div>
  );
};

export default HolographicSphere;
