import * as T from "three";
import type { Control } from "../../shared/control";
import type { Settings } from "./settings";
import { sweptHit } from "./collision";
import { ResolutionGovernor } from "./performance";
class RandomSequence {
  state = 0;
  next() {
    this.state += 0x6d2b79f5;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
export function seeded(seed: number) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export class FlightScene {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(60, 1, 0.1, 700);
  ship = new T.Group();
  speed = 0;
  distance = 0;
  hits = 0;
  fps = 60;
  prepared = false;
  resolutionScale = 1;
  recycleMs = 0;
  flash = 0;
  private chunks: { mesh: T.InstancedMesh; z: number; boxes: T.Box3[] }[] = [];
  private stars: T.Points;
  private grid: T.GridHelper;
  private dummy = new T.Object3D();
  private random = new RandomSequence();
  private color = new T.Color();
  private cubeGeometry = new T.BoxGeometry();
  private cubeMaterial = new T.MeshStandardMaterial({
    roughness: 0.65,
    metalness: 0.25,
  });
  private exhausts: T.Object3D[] = [];
  private governor = new ResolutionGovernor();
  private previousPosition = new T.Vector3();
  private basePixelRatio: number;
  private target = new T.Vector3();
  private shipSphere = new T.Sphere(new T.Vector3(), 0.8);
  private cooldown = 0;
  private smooth = { x: 0, y: 0 };
  constructor(
    container: HTMLElement,
    public settings: Settings,
    private onHit: () => void,
  ) {
    this.renderer = new T.WebGLRenderer({
      antialias: settings.quality === "high",
      powerPreference: "high-performance",
    });
    this.basePixelRatio = Math.min(
      devicePixelRatio,
      settings.quality === "high" ? 2 : 1.25,
    );
    this.renderer.setPixelRatio(this.basePixelRatio);
    container.append(this.renderer.domElement);
    this.scene.background = new T.Color("#080e1c");
    this.scene.fog = new T.FogExp2("#080e1c", 0.006);
    this.scene.add(new T.HemisphereLight("#a2dcff", "#16132b", 2.4));
    const light = new T.DirectionalLight("#ffffff", 3);
    light.position.set(8, 20, 10);
    this.scene.add(light);
    this.buildShip();
    this.ship.position.set(0, 8, 0);
    this.scene.add(this.ship);
    this.camera.position.set(0, 12, 24);
    this.grid = new T.GridHelper(800, 80, "#23555d", "#122530");
    this.grid.position.y = -3;
    this.scene.add(this.grid);
    const rand = seeded(99),
      positions = new Float32Array(1800);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (rand() - 0.5) * 650;
      positions[i + 1] = rand() * 240;
      positions[i + 2] = -rand() * 650;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(positions, 3));
    this.stars = new T.Points(
      geo,
      new T.PointsMaterial({
        color: "#9bbbc8",
        size: 0.6,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(this.stars);
    this.rebuild();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }
  private buildShip() {
    const hull = new T.MeshStandardMaterial({
      color: "#c6d6dc",
      metalness: 0.5,
      roughness: 0.45,
    });
    const dark = new T.MeshStandardMaterial({
      color: "#18303e",
      metalness: 0.6,
      roughness: 0.4,
    });
    const glow = new T.MeshBasicMaterial({ color: "#68f5d4" });
    const body = new T.Mesh(new T.ConeGeometry(1.1, 5, 4), hull);
    body.rotation.x = -Math.PI / 2;
    this.ship.add(body);
    for (const side of [-1, 1]) {
      const wing = new T.Mesh(new T.BoxGeometry(2.8, 0.18, 2.3), hull);
      wing.position.set(side * 1.8, -0.2, 0.8);
      wing.rotation.y = side * 0.3;
      this.ship.add(wing);
      const engine = new T.Mesh(
        new T.CylinderGeometry(0.33, 0.42, 1.8, 8),
        dark,
      );
      engine.rotation.x = Math.PI / 2;
      engine.position.set(side * 1.5, 0, 1.4);
      this.ship.add(engine);
      const flame = new T.Mesh(new T.ConeGeometry(0.3, 2, 8), glow);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(side * 1.5, 0, 3);
      flame.name = "exhaust";
      this.exhausts.push(flame);
      this.ship.add(flame);
    }
    const cockpit = new T.Mesh(
      new T.SphereGeometry(0.65, 12, 8),
      new T.MeshStandardMaterial({
        color: "#64e4d9",
        metalness: 0.8,
        roughness: 0.2,
      }),
    );
    cockpit.scale.set(0.65, 0.7, 1.6);
    cockpit.position.set(0, 0.45, -0.25);
    this.ship.add(cockpit);
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
  rebuild() {
    for (let i = 0; i < 8; i++) {
      const z = Math.floor(this.ship.position.z / 100) * 100 - i * 100;
      if (!this.chunks[i]) this.makeChunk(z);
      else {
        this.chunks[i].mesh.count = this.settings.density;
        this.fillChunk(this.chunks[i], z);
      }
    }
  }
  private makeChunk(z: number) {
    // Fixed capacity: changing density and recycling never reallocates instance buffers or boxes.
    const mesh = new T.InstancedMesh(this.cubeGeometry, this.cubeMaterial, 80);
    mesh.count = this.settings.density;
    const chunk = {
      mesh,
      z,
      boxes: Array.from({ length: 80 }, () => new T.Box3()),
    };
    this.fillChunk(chunk, z);
    this.chunks.push(chunk);
    this.scene.add(mesh);
  }
  private fillChunk(c: (typeof this.chunks)[number], z: number) {
    c.z = z;
    this.random.state = (this.settings.seed + Math.round(z) * 137) >>> 0;
    const rand = this.random;
    const col = this.color;
    for (let i = 0; i < c.mesh.count; i++) {
      const size = 1.5 + rand.next() * 6;
      let x = (rand.next() - 0.5) * 120;
      if (Math.abs(x) < 4) x += Math.sign(x || 1) * 5;
      this.dummy.position.set(x, rand.next() * 36 - 2, z - rand.next() * 100);
      this.dummy.scale.set(size, size * (0.7 + rand.next()), size);
      this.dummy.rotation.set(
        rand.next() * 0.4,
        rand.next() * Math.PI,
        rand.next() * 0.3,
      );
      this.dummy.updateMatrix();
      c.mesh.setMatrixAt(i, this.dummy.matrix);
      c.mesh.setColorAt(
        i,
        col.setHSL(0.46 + rand.next() * 0.14, 0.22, 0.16 + rand.next() * 0.15),
      );
      c.boxes[i].min.set(-0.5, -0.5, -0.5);
      c.boxes[i].max.set(0.5, 0.5, 0.5);
      c.boxes[i].applyMatrix4(this.dummy.matrix);
    }
    c.mesh.instanceMatrix.needsUpdate = true;
    if (c.mesh.instanceColor) c.mesh.instanceColor.needsUpdate = true;
    c.mesh.computeBoundingSphere();
  }
  async prepare() {
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.prepared = true;
  }
  adapt(rawMs: number) {
    const scale = this.settings.adaptive ? this.governor.update(rawMs) : 1;
    if (scale !== this.resolutionScale) {
      this.resolutionScale = scale;
      this.renderer.setPixelRatio(this.basePixelRatio * scale);
      this.resize();
    }
  }
  resetTiming() {
    this.governor.reset();
  }
  update(
    dt: number,
    input: Control,
    running: boolean,
    source: "camera" | "phone" | "demo" = "demo",
  ) {
    if (!this.prepared) return;
    dt = Math.max(0, Math.min(dt, 0.05));
    const a = 1 - Math.exp(-dt * 10);
    // Phone is already filtered at the source. Avoid stacking another slow control filter.
    const steering =
      1 -
      Math.exp(-dt * (source === "phone" ? 35 : source === "camera" ? 24 : 14));
    this.smooth.x = T.MathUtils.lerp(this.smooth.x, input.x, steering);
    this.smooth.y = T.MathUtils.lerp(this.smooth.y, input.y, steering);
    this.speed = T.MathUtils.lerp(
      this.speed,
      running
        ? (this.settings.minSpeed +
            (this.settings.maxSpeed - this.settings.minSpeed) *
              input.throttle) *
            (input.turbo ? 1.65 : 1)
        : 0,
      a,
    );
    this.previousPosition.copy(this.ship.position);
    if (running) {
      this.ship.position.x = T.MathUtils.clamp(
        this.ship.position.x + this.smooth.x * dt * 22,
        -55,
        55,
      );
      this.ship.position.y = T.MathUtils.clamp(
        this.ship.position.y + this.smooth.y * dt * 17,
        0,
        35,
      );
      this.ship.position.z -= this.speed * dt;
      this.distance += this.speed * dt;
    }
    this.ship.rotation.z = T.MathUtils.lerp(
      this.ship.rotation.z,
      -this.smooth.x * 0.55,
      a,
    );
    this.ship.rotation.x = T.MathUtils.lerp(
      this.ship.rotation.x,
      this.smooth.y * 0.22,
      a,
    );
    const exhaustScale =
      0.7 + this.speed / 50 + Math.sin(performance.now() * 0.03) * 0.08;
    for (const c of this.exhausts) c.scale.y = exhaustScale;
    this.target.set(
      this.ship.position.x * 0.6,
      this.ship.position.y + 6,
      this.ship.position.z + 22,
    );
    this.camera.position.lerp(this.target, a);
    this.target.copy(this.ship.position);
    this.target.z -= 14;
    this.camera.lookAt(this.target);
    this.grid.position.z = Math.floor(this.ship.position.z / 80) * 80;
    this.stars.position.z = this.ship.position.z;
    for (const c of this.chunks)
      if (c.z > this.ship.position.z + 130) {
        let front = Infinity;
        for (const other of this.chunks) front = Math.min(front, other.z);
        const begin = performance.now();
        this.fillChunk(c, front - 100);
        this.recycleMs = performance.now() - begin;
      }
    this.cooldown -= dt;
    if (running && this.settings.collisions && this.cooldown <= 0) {
      this.shipSphere.center.copy(this.ship.position);
      outer: for (const c of this.chunks)
        if (Math.abs(c.z - this.ship.position.z) < 130)
          for (let i = 0; i < c.mesh.count; i++)
            if (
              sweptHit(
                this.previousPosition,
                this.ship.position,
                c.boxes[i],
                this.shipSphere.radius,
              ) !== null
            ) {
              this.hits++;
              this.cooldown = 1.2;
              this.speed *= 0.35;
              this.flash = 1;
              this.onHit();
              break outer;
            }
    }
    this.flash = Math.max(0, this.flash - dt * 2);
    this.renderer.render(this.scene, this.camera);
  }
}
