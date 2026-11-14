import * as THREE from "three";

/**
 * Neon Runner — placeholder sahne (v0.1).
 * Gerçek oyun mantığı buraya yazılacak; imza korunacak:
 *   createGame(container) => { dispose() }
 * Faz 2 notu: createGame(container, onScore) şekline genişletilecek.
 */

export function createGame(container: HTMLElement) {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05060f, 10, 60);

  const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 100);
  camera.position.set(0, 4, 10);

  // Neon ızgara zemin
  const grid = new THREE.GridHelper(80, 40, 0x7c5cff, 0x2a2f55);
  grid.position.y = -1;
  scene.add(grid);

  // Uçan küreler
  const orbs = new THREE.Group();
  const orbGeo = new THREE.SphereGeometry(0.35, 24, 24);
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0x00e0ff,
    emissive: 0x00e0ff,
    emissiveIntensity: 0.6,
  });
  for (let i = 0; i < 12; i++) {
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.set(
      (Math.random() - 0.5) * 14,
      Math.random() * 5 + 0.5,
      -Math.random() * 40,
    );
    orbs.add(orb);
  }
  scene.add(orbs);

  scene.add(new THREE.AmbientLight(0x334466, 1.2));
  const key = new THREE.PointLight(0x7c5cff, 40, 50);
  key.position.set(3, 6, 4);
  scene.add(key);

  let raf = 0;
  let disposed = false;

  const onResize = () => {
    if (disposed || !container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener("resize", onResize);

  const clock = new THREE.Clock();
  const animate = () => {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // Kamera ileri "akar"
    camera.position.z = 10 - ((t * 2) % 8);
    grid.position.z = -((t * 2) % 2); // ızgarayı da kaydır = sonsuz pist hissi

    orbs.children.forEach((orb, i) => {
      orb.position.y += Math.sin(t * 2 + i) * 0.004;
      if (orb.position.z > 12) orb.position.z = -40; // geri dönüştür
      orb.position.z += 0.08;
    });

    renderer.render(scene, camera);
  };
  animate();

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      orbGeo.dispose();
      orbMat.dispose();
      grid.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
