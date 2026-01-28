import './style.css'
import {
  AbstractMesh,
  Color3,
  Color4,
  DynamicTexture,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  UniversalCamera,
  Vector3,
  Viewport,
  WebXRFeatureName,
  WebXRState,
} from '@babylonjs/core'
import type { Camera, Nullable, Observer, WebXRInputSource } from '@babylonjs/core'
import { AdvancedDynamicTexture, Control, Rectangle, TextBlock } from '@babylonjs/gui'
import '@babylonjs/loaders'

type AxisGroup = {
  x: number
  y: number
  z: number
}

type ImageState = {
  position: AxisGroup
  rotation: AxisGroup
}

type ImageSet = {
  id: string
  name: string
  createLeftTexture: (scene: Scene) => DynamicTexture
  createRightTexture: (scene: Scene) => DynamicTexture
}

const imageSets: ImageSet[] = [
  {
    id: 'car-garage',
    name: 'Car & Garage',
    createLeftTexture: (scene) => createCarTexture(scene),
    createRightTexture: (scene) => createGarageTexture(scene),
  },
  {
    id: 'bunny-flowers',
    name: 'Bunny & Flowers',
    createLeftTexture: (scene) => createBunnyWithFlowersTexture(scene),
    createRightTexture: (scene) => createBunnyEmptyTexture(scene),
  },
  {
    id: 'stereopsis',
    name: 'Stereopsis Test',
    createLeftTexture: (scene) => createStereopsisLeftTexture(scene),
    createRightTexture: (scene) => createStereopsisRightTexture(scene),
  },
  {
    id: 'grid',
    name: 'Grid Pattern',
    createLeftTexture: (scene) => createPlaceholderTexture(scene, 'LEFT', '#3ee78b'),
    createRightTexture: (scene) => createPlaceholderTexture(scene, 'RIGHT', '#ffb347'),
  },
]

let currentImageSetId = 'car-garage'

const leftMask = 0x10000000
const rightMask = 0x20000000
const commonMask = 0x0fffffff

const defaultLeft: ImageState = {
  position: { x: 0, y: 0, z: 2 },
  rotation: { x: 0, y: 0, z: 0 },
}

const defaultRight: ImageState = {
  position: { x: 0, y: 0, z: 2 },
  rotation: { x: 0, y: 0, z: 0 },
}

const toRadians = (deg: number) => (deg * Math.PI) / 180
const toDegrees = (rad: number) => (rad * 180) / Math.PI

// Viewing distance in meters (z position of planes)
const viewingDistance = 2

// Prism diopters = (displacement in cm) / (distance in m) = displacement * 100 / distance
const metersToDiopters = (m: number) => (m * 100) / viewingDistance
const dioptersToMeters = (d: number) => (d * viewingDistance) / 100

const canvas = document.querySelector<HTMLCanvasElement>('#renderCanvas')
const uiRoot = document.querySelector<HTMLDivElement>('#ui')

if (!canvas || !uiRoot) {
  throw new Error('Missing render canvas or UI root')
}

const engine = new Engine(canvas, true, {
  disableWebGL2Support: false,
  preserveDrawingBuffer: true,
  stencil: true,
})

const scene = new Scene(engine)
scene.clearColor = new Color4(0.04, 0.05, 0.07, 1)

const camera = new UniversalCamera('camera', new Vector3(0, 1.6, -2.2), scene)
camera.setTarget(new Vector3(0, 1.6, 1.5))
camera.attachControl(canvas, true)
camera.layerMask = leftMask | rightMask | commonMask

const leftPreviewCamera = new UniversalCamera('leftPreview', camera.position.clone(), scene)
const rightPreviewCamera = new UniversalCamera('rightPreview', camera.position.clone(), scene)
leftPreviewCamera.layerMask = leftMask | commonMask
rightPreviewCamera.layerMask = rightMask | commonMask

const previewLabels = createPreviewLabels()

function createPreviewLabels() {
  const container = document.createElement('div')
  container.id = 'preview-labels'
  container.innerHTML = `
    <div class="preview-label preview-label-left">LEFT</div>
    <div class="preview-label preview-label-right">RIGHT</div>
  `
  document.body.appendChild(container)
  return {
    container,
    left: container.querySelector('.preview-label-left') as HTMLDivElement,
    right: container.querySelector('.preview-label-right') as HTMLDivElement,
  }
}

const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
light.intensity = 0.85

const defaultImageSize = 0.6
let currentImageSize = defaultImageSize

const leftPlane = MeshBuilder.CreatePlane('leftPlane', { size: 1 }, scene)
const rightPlane = MeshBuilder.CreatePlane('rightPlane', { size: 1 }, scene)
leftPlane.scaling.setAll(currentImageSize)
rightPlane.scaling.setAll(currentImageSize)
leftPlane.layerMask = leftMask
rightPlane.layerMask = rightMask
leftPlane.parent = camera
rightPlane.parent = camera

function setImageSize(size: number) {
  currentImageSize = size
  leftPlane.scaling.setAll(size)
  rightPlane.scaling.setAll(size)
}

function setImageSet(setId: string) {
  const imageSet = imageSets.find((s) => s.id === setId)
  if (!imageSet) return

  currentImageSetId = setId

  // Dispose old textures
  leftMaterial.diffuseTexture?.dispose()
  rightMaterial.diffuseTexture?.dispose()

  // Create new textures
  leftMaterial.diffuseTexture = imageSet.createLeftTexture(scene)
  rightMaterial.diffuseTexture = imageSet.createRightTexture(scene)
}

const hudPlane = MeshBuilder.CreatePlane('xrHud', { width: 1.4, height: 0.36 }, scene)
hudPlane.layerMask = commonMask
hudPlane.isVisible = false

const hudTexture = AdvancedDynamicTexture.CreateForMesh(hudPlane, 1024, 256, false)
const hudBackground = new Rectangle('hudBackground')
hudBackground.width = 1
hudBackground.height = 1
hudBackground.cornerRadius = 12
hudBackground.thickness = 2
hudBackground.color = 'rgba(255,255,255,0.35)'
hudBackground.background = 'rgba(10,14,20,0.65)'
hudTexture.addControl(hudBackground)

const hudText = new TextBlock('hudText')
hudText.color = '#f4f6f8'
hudText.fontSize = 28
hudText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
hudText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
hudText.paddingLeft = '18px'
hudText.paddingRight = '18px'
hudText.text = ''
hudBackground.addControl(hudText)

const leftState = cloneState(defaultLeft)
const rightState = cloneState(defaultRight)

let xrCamera: Nullable<Camera> = null
let inXrSession = false
let beforeCameraObserver: Nullable<Observer<Camera>> = null
let xrRigCameras: Camera[] = []
let lastControlSyncMs = 0
let showControllers = false
let showHudInVR = true
const controllerMap = new Map<'left' | 'right', WebXRInputSource>()

const leftMaterial = new StandardMaterial('leftMaterial', scene)
const rightMaterial = new StandardMaterial('rightMaterial', scene)
leftMaterial.disableLighting = true
rightMaterial.disableLighting = true
leftMaterial.emissiveColor = Color3.White()
rightMaterial.emissiveColor = Color3.White()
leftMaterial.backFaceCulling = false
rightMaterial.backFaceCulling = false
leftMaterial.alpha = 0.5
rightMaterial.alpha = 0.5

leftMaterial.diffuseTexture = createCarTexture(scene)
rightMaterial.diffuseTexture = createGarageTexture(scene)
leftPlane.material = leftMaterial
rightPlane.material = rightMaterial

applyState(leftPlane, leftState)
applyState(rightPlane, rightState)

const {
  setStatus,
  attachXRButtons,
  setPreviewEnabled,
  onRecenterXr,
  syncControls,
  onControllerVisibilityChange,
  onHudVisibilityChange,
} = buildUI(uiRoot)
setStatus(engine.webGLVersion === 2 ? 'WebGL2 ready.' : 'WebGL2 not detected.')

let previewEnabled = true
setPreviewEnabled(previewEnabled)
updatePreviewViewports()
scene.activeCameras = previewEnabled ? [camera, leftPreviewCamera, rightPreviewCamera] : [camera]

engine.runRenderLoop(() => {
  if (previewEnabled) {
    leftPreviewCamera.position.copyFrom(camera.position)
    rightPreviewCamera.position.copyFrom(camera.position)
    leftPreviewCamera.rotation.copyFrom(camera.rotation)
    rightPreviewCamera.rotation.copyFrom(camera.rotation)
  }
  updateJoystickMovement()
  updateXrHud()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
  updatePreviewViewports()
})

scene
  .createDefaultXRExperienceAsync({
    disableDefaultUI: true,
    disablePointerSelection: true,
    disableNearInteraction: true,
    disableTeleportation: true,
    optionalFeatures: true,
  })
  .then((xrHelper) => {
    attachXRButtons(xrHelper)

    if (xrHelper.pointerSelection) {
      xrHelper.pointerSelection.displayLaserPointer = false
      xrHelper.pointerSelection.displaySelectionMesh = false
    }

    // Disable all XR features that might create visual artifacts
    xrHelper.baseExperience.featuresManager.disableFeature(WebXRFeatureName.POINTER_SELECTION)
    xrHelper.baseExperience.featuresManager.disableFeature(WebXRFeatureName.TELEPORTATION)
    xrHelper.baseExperience.featuresManager.disableFeature(WebXRFeatureName.ANCHOR_SYSTEM)
    xrHelper.baseExperience.featuresManager.disableFeature(WebXRFeatureName.HAND_TRACKING)

    // Dispose of any teleportation meshes that may have been created
    if (xrHelper.teleportation) {
      xrHelper.teleportation.dispose()
    }

    xrHelper.input.onControllerAddedObservable.add((xrController) => {
      const handedness = xrController.inputSource.handedness
      if (handedness !== 'left' && handedness !== 'right') return
      controllerMap.set(handedness, xrController)

      updateSingleControllerVisibility(xrController)

      xrController.onMotionControllerInitObservable.add(() => {
        updateSingleControllerVisibility(xrController)
      })
    })

    xrHelper.input.onControllerRemovedObservable.add((xrController) => {
      const handedness = xrController.inputSource.handedness
      if (handedness !== 'left' && handedness !== 'right') return
      controllerMap.delete(handedness)
    })

    onRecenterXr(() => {
      if (xrHelper.baseExperience.state === WebXRState.IN_XR) {
        resetHeadLockedPlanes()
        syncControls()
      }
    })

    onControllerVisibilityChange((visible) => {
      showControllers = visible
      updateControllerVisibility()
    })

    onHudVisibilityChange((visible) => {
      if (inXrSession) {
        hudPlane.isVisible = visible
      }
    })

    xrHelper.baseExperience.onStateChangedObservable.add((state) => {
      if (state === WebXRState.IN_XR) {
        const rigCameras = xrHelper.baseExperience.camera?.rigCameras ?? []
        xrRigCameras = rigCameras
        if (rigCameras.length >= 2) {
          rigCameras[0].layerMask = leftMask | commonMask
          rigCameras[1].layerMask = rightMask | commonMask
        } else if (xrHelper.baseExperience.camera) {
          xrHelper.baseExperience.camera.layerMask = leftMask | rightMask | commonMask
        }
        xrCamera = xrHelper.baseExperience.camera
        inXrSession = true
        previewEnabled = false
        scene.activeCameras = null
        setPreviewEnabled(previewEnabled)
        previewLabels.container.style.display = 'none'
        leftMaterial.alpha = 1
        rightMaterial.alpha = 1
        applyXrOverrides(true)
        syncControls()
        setStatus('In XR session.')
      }

      if (state === WebXRState.NOT_IN_XR) {
        inXrSession = false
        xrRigCameras = []
        applyXrOverrides(false)
        xrCamera = null
        previewEnabled = true
        scene.activeCameras = [camera, leftPreviewCamera, rightPreviewCamera]
        setPreviewEnabled(previewEnabled)
        previewLabels.container.style.display = 'block'
        leftMaterial.alpha = 0.5
        rightMaterial.alpha = 0.5
        setStatus('XR session ended.')
      }
    })
  })
  .catch(() => {
    setStatus('WebXR not available in this browser.')
  })

function applyState(mesh: AbstractMesh, state: ImageState) {
  mesh.position.set(state.position.x, state.position.y, state.position.z)
  mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z)
}

function createPlaceholderTexture(sceneRef: Scene, label: string, color: string) {
  const texture = new DynamicTexture(`tex-${label}`, { width: 512, height: 512 }, sceneRef, false)
  const ctx = texture.getContext() as CanvasRenderingContext2D
  ctx.fillStyle = '#11151c'
  ctx.fillRect(0, 0, 512, 512)

  ctx.strokeStyle = color
  ctx.lineWidth = 6
  ctx.strokeRect(20, 20, 472, 472)

  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  for (let i = 64; i < 512; i += 64) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, 512)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i)
    ctx.lineTo(512, i)
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(256, 80)
  ctx.lineTo(256, 432)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(80, 256)
  ctx.lineTo(432, 256)
  ctx.stroke()

  ctx.fillStyle = color
  ctx.font = 'bold 46px "IBM Plex Sans", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 256, 256)

  texture.update()
  return texture
}

function createCarTexture(sceneRef: Scene) {
  const texture = new DynamicTexture('tex-car', { width: 512, height: 512 }, sceneRef, false)
  const ctx = texture.getContext() as CanvasRenderingContext2D

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 512, 512)

  // Draw a pink vintage car (similar to the reference image)
  // Scale down and center to fit inside the garage opening
  ctx.save()
  ctx.translate(256, 330) // Center point - moved down to sit in middle of garage
  ctx.scale(0.65, 0.65)   // Scale down to fit in garage
  ctx.translate(-256, -290) // Translate back

  const carColor = '#e8a0b0' // Pink/magenta color
  const carOutline = '#c06080'
  const windowColor = '#87ceeb' // Light blue for windows

  // Car body - main shape
  ctx.fillStyle = carColor
  ctx.strokeStyle = carOutline
  ctx.lineWidth = 3

  // Main body (lower part)
  ctx.beginPath()
  ctx.moveTo(100, 320) // Bottom left
  ctx.lineTo(100, 280) // Left side up
  ctx.lineTo(120, 250) // Hood curve
  ctx.lineTo(180, 240) // Hood top
  ctx.lineTo(180, 200) // Windshield bottom
  ctx.lineTo(220, 170) // Windshield top left
  ctx.lineTo(300, 170) // Roof
  ctx.lineTo(340, 200) // Rear window top
  ctx.lineTo(340, 240) // Rear window bottom
  ctx.lineTo(400, 250) // Trunk
  ctx.lineTo(420, 280) // Right side
  ctx.lineTo(420, 320) // Bottom right
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Windows
  ctx.fillStyle = windowColor
  ctx.strokeStyle = carOutline
  ctx.lineWidth = 2

  // Front window
  ctx.beginPath()
  ctx.moveTo(190, 205)
  ctx.lineTo(215, 180)
  ctx.lineTo(255, 180)
  ctx.lineTo(255, 205)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Rear window
  ctx.beginPath()
  ctx.moveTo(265, 205)
  ctx.lineTo(265, 180)
  ctx.lineTo(305, 180)
  ctx.lineTo(330, 205)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Headlights
  ctx.fillStyle = '#ffff99'
  ctx.beginPath()
  ctx.arc(130, 270, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = carOutline
  ctx.stroke()

  // Taillights
  ctx.fillStyle = '#ff4444'
  ctx.beginPath()
  ctx.arc(400, 270, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = carOutline
  ctx.stroke()

  // Front wheel
  ctx.fillStyle = '#333333'
  ctx.beginPath()
  ctx.arc(170, 320, 35, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#888888'
  ctx.beginPath()
  ctx.arc(170, 320, 20, 0, Math.PI * 2)
  ctx.fill()

  // Rear wheel
  ctx.fillStyle = '#333333'
  ctx.beginPath()
  ctx.arc(350, 320, 35, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#888888'
  ctx.beginPath()
  ctx.arc(350, 320, 20, 0, Math.PI * 2)
  ctx.fill()

  // Chrome bumper details
  ctx.strokeStyle = '#888888'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(95, 300)
  ctx.lineTo(95, 280)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(425, 300)
  ctx.lineTo(425, 280)
  ctx.stroke()

  // Grille
  ctx.fillStyle = '#666666'
  ctx.fillRect(105, 255, 40, 25)
  ctx.strokeStyle = '#888888'
  ctx.lineWidth = 2
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(110 + i * 10, 255)
    ctx.lineTo(110 + i * 10, 280)
    ctx.stroke()
  }

  ctx.restore()

  texture.update()
  return texture
}

function createGarageTexture(sceneRef: Scene) {
  const texture = new DynamicTexture('tex-garage', { width: 512, height: 512 }, sceneRef, false)
  const ctx = texture.getContext() as CanvasRenderingContext2D

  // White background - keeps the interior white/open for the car to show through
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 512, 512)

  // Roof - yellow with peak
  ctx.fillStyle = '#f0d000' // Bright yellow
  ctx.strokeStyle = '#c0a000'
  ctx.lineWidth = 3

  // Roof shape (trapezoid with peak)
  ctx.beginPath()
  ctx.moveTo(60, 180)   // Left eave
  ctx.lineTo(256, 80)   // Peak
  ctx.lineTo(452, 180)  // Right eave
  ctx.lineTo(420, 180)  // Right inner
  ctx.lineTo(256, 100)  // Inner peak
  ctx.lineTo(92, 180)   // Left inner
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Small blue window/vent in the roof
  ctx.fillStyle = '#4488cc'
  ctx.strokeStyle = '#2266aa'
  ctx.lineWidth = 2
  ctx.fillRect(236, 110, 40, 30)
  ctx.strokeRect(236, 110, 40, 30)

  // Garage door frame - green
  ctx.fillStyle = '#228822' // Green
  ctx.strokeStyle = '#115511'
  ctx.lineWidth = 4

  // Left pillar
  ctx.fillRect(92, 180, 30, 240)
  ctx.strokeRect(92, 180, 30, 240)

  // Right pillar
  ctx.fillRect(390, 180, 30, 240)
  ctx.strokeRect(390, 180, 30, 240)

  // Top beam
  ctx.fillRect(92, 180, 328, 25)
  ctx.strokeRect(92, 180, 328, 25)

  // Floor/threshold
  ctx.fillStyle = '#228822'
  ctx.fillRect(92, 400, 328, 20)
  ctx.strokeRect(92, 400, 328, 20)

  texture.update()
  return texture
}

function drawBunnyBase(ctx: CanvasRenderingContext2D) {
  // Colors
  const bodyColor = '#f5deb3' // Tan/wheat color for bunny
  const bodyOutline = '#8b7355'
  const shirtColor = '#4a9fd4' // Blue shirt
  const shirtOutline = '#2a6f9f'
  const pantsColor = '#ff6b35' // Orange pants
  const pantsOutline = '#cc4411'
  const eyeColor = '#000000'
  const noseColor = '#ffb6c1' // Pink nose

  // Head
  ctx.fillStyle = bodyColor
  ctx.strokeStyle = bodyOutline
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(256, 180, 35, 40, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Ears
  ctx.beginPath()
  ctx.ellipse(235, 115, 12, 35, -0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(277, 115, 12, 35, 0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Inner ears (pink)
  ctx.fillStyle = noseColor
  ctx.beginPath()
  ctx.ellipse(235, 115, 6, 20, -0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(277, 115, 6, 20, 0.2, 0, Math.PI * 2)
  ctx.fill()

  // Eyes
  ctx.fillStyle = eyeColor
  ctx.beginPath()
  ctx.arc(243, 175, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(269, 175, 5, 0, Math.PI * 2)
  ctx.fill()

  // Nose
  ctx.fillStyle = noseColor
  ctx.beginPath()
  ctx.ellipse(256, 195, 6, 4, 0, 0, Math.PI * 2)
  ctx.fill()

  // Body/Shirt
  ctx.fillStyle = shirtColor
  ctx.strokeStyle = shirtOutline
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(256, 270, 45, 55, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Pants
  ctx.fillStyle = pantsColor
  ctx.strokeStyle = pantsOutline
  ctx.beginPath()
  ctx.ellipse(240, 340, 22, 30, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(272, 340, 22, 30, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Feet
  ctx.fillStyle = bodyColor
  ctx.strokeStyle = bodyOutline
  ctx.beginPath()
  ctx.ellipse(235, 385, 18, 10, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(277, 385, 18, 10, 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function drawBunnyArms(ctx: CanvasRenderingContext2D, holdingFlowers: boolean) {
  const shirtColor = '#4a9fd4'
  const shirtOutline = '#2a6f9f'
  const bodyColor = '#f5deb3'
  const bodyOutline = '#8b7355'

  if (holdingFlowers) {
    // Left arm extended forward holding flowers
    ctx.fillStyle = shirtColor
    ctx.strokeStyle = shirtOutline
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(190, 260, 35, 14, -0.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Left hand
    ctx.fillStyle = bodyColor
    ctx.strokeStyle = bodyOutline
    ctx.beginPath()
    ctx.arc(158, 245, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Right arm at side
    ctx.fillStyle = shirtColor
    ctx.strokeStyle = shirtOutline
    ctx.beginPath()
    ctx.ellipse(310, 280, 30, 12, 0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Right hand
    ctx.fillStyle = bodyColor
    ctx.strokeStyle = bodyOutline
    ctx.beginPath()
    ctx.arc(335, 295, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

  } else {
    // Left arm extended but empty
    ctx.fillStyle = shirtColor
    ctx.strokeStyle = shirtOutline
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(190, 260, 35, 14, -0.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Left hand (empty, open)
    ctx.fillStyle = bodyColor
    ctx.strokeStyle = bodyOutline
    ctx.beginPath()
    ctx.arc(158, 245, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Right arm at side
    ctx.fillStyle = shirtColor
    ctx.strokeStyle = shirtOutline
    ctx.beginPath()
    ctx.ellipse(310, 280, 30, 12, 0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Right hand
    ctx.fillStyle = bodyColor
    ctx.strokeStyle = bodyOutline
    ctx.beginPath()
    ctx.arc(335, 295, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

function drawFlowers(ctx: CanvasRenderingContext2D) {
  // Stems
  ctx.strokeStyle = '#228b22'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(145, 245)
  ctx.lineTo(130, 180)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(145, 245)
  ctx.lineTo(155, 175)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(145, 245)
  ctx.lineTo(120, 195)
  ctx.stroke()

  // Flower 1 - Yellow
  ctx.fillStyle = '#ffd700'
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    const angle = (i * Math.PI * 2) / 5
    ctx.ellipse(130 + Math.cos(angle) * 10, 170 + Math.sin(angle) * 10, 8, 5, angle, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#8b4513'
  ctx.beginPath()
  ctx.arc(130, 170, 6, 0, Math.PI * 2)
  ctx.fill()

  // Flower 2 - Orange
  ctx.fillStyle = '#ff8c00'
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    const angle = (i * Math.PI * 2) / 5 + 0.3
    ctx.ellipse(155 + Math.cos(angle) * 10, 165 + Math.sin(angle) * 10, 8, 5, angle, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#8b4513'
  ctx.beginPath()
  ctx.arc(155, 165, 6, 0, Math.PI * 2)
  ctx.fill()

  // Flower 3 - Red
  ctx.fillStyle = '#ff4500'
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    const angle = (i * Math.PI * 2) / 5 + 0.6
    ctx.ellipse(115 + Math.cos(angle) * 8, 190 + Math.sin(angle) * 8, 7, 4, angle, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#8b4513'
  ctx.beginPath()
  ctx.arc(115, 190, 5, 0, Math.PI * 2)
  ctx.fill()

  // Leaves
  ctx.fillStyle = '#32cd32'
  ctx.beginPath()
  ctx.ellipse(138, 220, 12, 6, -0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(152, 215, 10, 5, 0.5, 0, Math.PI * 2)
  ctx.fill()
}

function drawTail(ctx: CanvasRenderingContext2D) {
  const bodyColor = '#f5deb3'
  const bodyOutline = '#8b7355'

  // Fluffy tail on the right side (back of bunny)
  ctx.fillStyle = bodyColor
  ctx.strokeStyle = bodyOutline
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(320, 310, 18, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Add some fluff detail
  ctx.beginPath()
  ctx.arc(328, 302, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(325, 318, 10, 0, Math.PI * 2)
  ctx.fill()
}

function createBunnyWithFlowersTexture(sceneRef: Scene) {
  const texture = new DynamicTexture('tex-bunny-flowers', { width: 512, height: 512 }, sceneRef, false)
  const ctx = texture.getContext() as CanvasRenderingContext2D

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 512, 512)

  drawBunnyBase(ctx)
  drawBunnyArms(ctx, true)
  drawFlowers(ctx)

  texture.update()
  return texture
}

function createBunnyEmptyTexture(sceneRef: Scene) {
  const texture = new DynamicTexture('tex-bunny-empty', { width: 512, height: 512 }, sceneRef, false)
  const ctx = texture.getContext() as CanvasRenderingContext2D

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 512, 512)

  drawTail(ctx)  // Draw tail first so it's behind the body
  drawBunnyBase(ctx)
  drawBunnyArms(ctx, false)
  // No flowers drawn

  texture.update()
  return texture
}

function createStereopsisLeftTexture(sceneRef: Scene) {
  const texture = new DynamicTexture('tex-stereo-left', { width: 512, height: 512 }, sceneRef, false)
  const ctx = texture.getContext() as CanvasRenderingContext2D

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 512, 512)

  // Draw a frame/border
  ctx.strokeStyle = '#333333'
  ctx.lineWidth = 4
  ctx.strokeRect(50, 50, 412, 412)

  // Central fixation cross
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(246, 256)
  ctx.lineTo(266, 256)
  ctx.moveTo(256, 246)
  ctx.lineTo(256, 266)
  ctx.stroke()

  // Row 1 - Circle that will appear "in front" (shifted right in left eye)
  ctx.fillStyle = '#e74c3c' // Red
  ctx.beginPath()
  ctx.arc(156 + 8, 150, 25, 0, Math.PI * 2) // Shifted right
  ctx.fill()

  // Row 1 - Circle at screen depth (no shift)
  ctx.fillStyle = '#3498db' // Blue
  ctx.beginPath()
  ctx.arc(256, 150, 25, 0, Math.PI * 2)
  ctx.fill()

  // Row 1 - Circle that will appear "behind" (shifted left in left eye)
  ctx.fillStyle = '#2ecc71' // Green
  ctx.beginPath()
  ctx.arc(356 - 8, 150, 25, 0, Math.PI * 2) // Shifted left
  ctx.fill()

  // Row 2 - Different depths
  ctx.fillStyle = '#9b59b6' // Purple - far behind
  ctx.beginPath()
  ctx.arc(156 - 12, 280, 20, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f39c12' // Orange - slightly in front
  ctx.beginPath()
  ctx.arc(356 + 5, 280, 20, 0, Math.PI * 2)
  ctx.fill()

  // Row 3 - Small circles for fine stereopsis
  ctx.fillStyle = '#1abc9c' // Teal
  ctx.beginPath()
  ctx.arc(206 + 3, 380, 15, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#e91e63' // Pink
  ctx.beginPath()
  ctx.arc(306 - 3, 380, 15, 0, Math.PI * 2)
  ctx.fill()

  texture.update()
  return texture
}

function createStereopsisRightTexture(sceneRef: Scene) {
  const texture = new DynamicTexture('tex-stereo-right', { width: 512, height: 512 }, sceneRef, false)
  const ctx = texture.getContext() as CanvasRenderingContext2D

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 512, 512)

  // Draw a frame/border
  ctx.strokeStyle = '#333333'
  ctx.lineWidth = 4
  ctx.strokeRect(50, 50, 412, 412)

  // Central fixation cross
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(246, 256)
  ctx.lineTo(266, 256)
  ctx.moveTo(256, 246)
  ctx.lineTo(256, 266)
  ctx.stroke()

  // Row 1 - Circle that will appear "in front" (shifted left in right eye)
  ctx.fillStyle = '#e74c3c' // Red
  ctx.beginPath()
  ctx.arc(156 - 8, 150, 25, 0, Math.PI * 2) // Shifted left
  ctx.fill()

  // Row 1 - Circle at screen depth (no shift)
  ctx.fillStyle = '#3498db' // Blue
  ctx.beginPath()
  ctx.arc(256, 150, 25, 0, Math.PI * 2)
  ctx.fill()

  // Row 1 - Circle that will appear "behind" (shifted right in right eye)
  ctx.fillStyle = '#2ecc71' // Green
  ctx.beginPath()
  ctx.arc(356 + 8, 150, 25, 0, Math.PI * 2) // Shifted right
  ctx.fill()

  // Row 2 - Different depths
  ctx.fillStyle = '#9b59b6' // Purple - far behind
  ctx.beginPath()
  ctx.arc(156 + 12, 280, 20, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f39c12' // Orange - slightly in front
  ctx.beginPath()
  ctx.arc(356 - 5, 280, 20, 0, Math.PI * 2)
  ctx.fill()

  // Row 3 - Small circles for fine stereopsis
  ctx.fillStyle = '#1abc9c' // Teal
  ctx.beginPath()
  ctx.arc(206 - 3, 380, 15, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#e91e63' // Pink
  ctx.beginPath()
  ctx.arc(306 + 3, 380, 15, 0, Math.PI * 2)
  ctx.fill()

  texture.update()
  return texture
}

function buildUI(root: HTMLDivElement) {
  root.innerHTML = ''

  const header = document.createElement('div')
  header.className = 'panel-title'
  header.textContent = 'Amblyoscope Controls'
  root.appendChild(header)

  const status = document.createElement('div')
  status.className = 'status'
  status.textContent = 'Initializing...'
  root.appendChild(status)

  const previewStatus = document.createElement('div')
  previewStatus.className = 'status'
  previewStatus.textContent = 'Desktop eye preview: enabled'
  root.appendChild(previewStatus)

  const xrButtons = document.createElement('div')
  xrButtons.className = 'button-row'

  const enterButton = createButton('Enter VR')
  const exitButton = createButton('Exit VR')
  exitButton.disabled = true

  xrButtons.appendChild(enterButton)
  xrButtons.appendChild(exitButton)
  root.appendChild(xrButtons)

  const divider = document.createElement('div')
  divider.className = 'divider'
  root.appendChild(divider)

  const imageSetPanel = createPanel(root, 'Image Set')
  createSelectControl(imageSetPanel, 'Images', imageSets.map((s) => ({ id: s.id, name: s.name })), currentImageSetId, (setId) => {
    setImageSet(setId)
  })

  const commonPanel = createPanel(root, 'Image Size')
  const sizeControl = createRangeControl(commonPanel, 'Size', 0.1, 1.5, 0.01, currentImageSize, (value) => {
    setImageSize(value)
  })

  const leftPanel = createPanel(root, 'Left Eye Image')
  const rightPanel = createPanel(root, 'Right Eye Image')

  const leftBindings = buildControls(leftPanel, leftState, defaultLeft, (next) =>
    applyState(leftPlane, next),
  )
  const rightBindings = buildControls(rightPanel, rightState, defaultRight, (next) =>
    applyState(rightPlane, next),
  )

  const resetRow = document.createElement('div')
  resetRow.className = 'button-row'
  const resetAll = createButton('Reset Both')
  resetRow.appendChild(resetAll)
  root.appendChild(resetRow)

  resetAll.addEventListener('click', () => {
    leftBindings.reset(defaultLeft)
    rightBindings.reset(defaultRight)
    sizeControl.setValue(defaultImageSize)
  })

  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.textContent =
    'Use the sliders to align each image. Top-right mini windows show left (top) and right (bottom) eye previews.'
  root.appendChild(hint)

  const debugTitle = document.createElement('div')
  debugTitle.className = 'panel-title'
  debugTitle.textContent = 'XR Debug'
  root.appendChild(debugTitle)

  const debugPanel = document.createElement('div')
  debugPanel.className = 'panel'
  root.appendChild(debugPanel)

  let controllersVisible = false
  const controllerListeners: Array<(visible: boolean) => void> = []
  const hudListeners: Array<(visible: boolean) => void> = []

  createToggleControl(debugPanel, 'Show values in VR', showHudInVR, (next) => {
    showHudInVR = next
    hudListeners.forEach((handler) => handler(showHudInVR))
  })

  createToggleControl(debugPanel, 'Show controllers', controllersVisible, (next) => {
    controllersVisible = next
    controllerListeners.forEach((handler) => handler(controllersVisible))
  })

  const recenterRow = document.createElement('div')
  recenterRow.className = 'button-row'
  const recenterButton = createButton('Recenter in XR')
  recenterRow.appendChild(recenterButton)
  debugPanel.appendChild(recenterRow)

  const recenterListeners: Array<() => void> = []
  recenterButton.addEventListener('click', () => {
    recenterListeners.forEach((handler) => handler())
  })

  return {
    statusText: status,
    setStatus: (text: string) => {
      status.textContent = text
    },
    setPreviewEnabled: (enabled: boolean) => {
      previewStatus.textContent = `Desktop eye preview: ${enabled ? 'enabled' : 'disabled'}`
    },
    onRecenterXr: (handler: () => void) => {
      recenterListeners.push(handler)
    },
    onControllerVisibilityChange: (handler: (visible: boolean) => void) => {
      controllerListeners.push(handler)
      handler(controllersVisible)
    },
    onHudVisibilityChange: (handler: (visible: boolean) => void) => {
      hudListeners.push(handler)
      handler(showHudInVR)
    },
    syncControls: () => {
      leftBindings.sync(leftState)
      rightBindings.sync(rightState)
    },
    attachXRButtons: (xrHelper: Awaited<ReturnType<Scene['createDefaultXRExperienceAsync']>>) => {
      let sessionActive = false
      const updateButtons = () => {
        enterButton.disabled = sessionActive
        exitButton.disabled = !sessionActive
      }

      xrHelper.baseExperience.sessionManager
        .isSessionSupportedAsync('immersive-vr')
        .then((supported) => {
          enterButton.disabled = !supported
          if (!supported) {
            status.textContent = 'XR not supported on this device.'
          }
        })
        .catch(() => {
          enterButton.disabled = true
        })

      enterButton.addEventListener('click', () => {
        xrHelper.baseExperience
          .enterXRAsync('immersive-vr', 'local-floor')
          .then(() => {
            sessionActive = true
            updateButtons()
          })
          .catch(() => {
            status.textContent = 'Failed to enter XR.'
          })
      })

      exitButton.addEventListener('click', () => {
        xrHelper.baseExperience
          .exitXRAsync()
          .then(() => {
            sessionActive = false
            updateButtons()
          })
          .catch(() => {
            status.textContent = 'Failed to exit XR.'
          })
      })

      xrHelper.baseExperience.onStateChangedObservable.add((state) => {
        sessionActive = state === WebXRState.IN_XR
        updateButtons()
      })
    },
  }
}

function applyXrOverrides(inXr: boolean) {
  if (!inXr) {
    leftPlane.layerMask = leftMask
    rightPlane.layerMask = rightMask
    leftPlane.isVisible = true
    rightPlane.isVisible = true
    hudPlane.isVisible = false
    disablePerEyeVisibility()
    leftPlane.parent = camera
    rightPlane.parent = camera
    hudPlane.parent = null
    applyState(leftPlane, leftState)
    applyState(rightPlane, rightState)
    return
  }

  leftPlane.layerMask = commonMask
  rightPlane.layerMask = commonMask
  enablePerEyeVisibility()

  if (xrRigCameras.length >= 2) {
    leftPlane.parent = xrRigCameras[0]
    rightPlane.parent = xrRigCameras[1]
  } else if (xrCamera) {
    leftPlane.parent = xrCamera
    rightPlane.parent = xrCamera
  }

  if (xrCamera) {
    hudPlane.parent = xrCamera
    hudPlane.position.set(0, -0.8, 2.2)
    hudPlane.isVisible = showHudInVR
  }

  applyState(leftPlane, leftState)
  applyState(rightPlane, rightState)
}

function resetHeadLockedPlanes() {
  leftState.position = { ...defaultLeft.position }
  leftState.rotation = { ...defaultLeft.rotation }
  rightState.position = { ...defaultRight.position }
  rightState.rotation = { ...defaultRight.rotation }
  applyState(leftPlane, leftState)
  applyState(rightPlane, rightState)
}

function enablePerEyeVisibility() {
  if (beforeCameraObserver) return
  beforeCameraObserver = scene.onBeforeCameraRenderObservable.add((renderCamera) => {
    if (!inXrSession) return

    if (renderCamera.isLeftCamera) {
      leftPlane.isVisible = true
      rightPlane.isVisible = false
      return
    }

    if (renderCamera.isRightCamera) {
      leftPlane.isVisible = false
      rightPlane.isVisible = true
      return
    }

    leftPlane.isVisible = true
    rightPlane.isVisible = true
  })
}

function disablePerEyeVisibility() {
  if (!beforeCameraObserver) return
  scene.onBeforeCameraRenderObservable.remove(beforeCameraObserver)
  beforeCameraObserver = null
}

function updateJoystickMovement() {
  if (!inXrSession) return
  const deltaSeconds = engine.getDeltaTime() / 1000
  const speed = 0.2
  const rotSpeed = 0.15
  let didChange = false

  const leftSource = controllerMap.get('left')
  const rightSource = controllerMap.get('right')

  if (leftSource) {
    const leftMotion = leftSource.motionController
    const xButton = leftMotion?.getComponent('x-button')
    const yButton = leftMotion?.getComponent('y-button')

    if (xButton?.pressed) {
      leftState.rotation.z -= rotSpeed * deltaSeconds
      applyState(leftPlane, leftState)
      didChange = true
    }
    if (yButton?.pressed) {
      leftState.rotation.z += rotSpeed * deltaSeconds
      applyState(leftPlane, leftState)
      didChange = true
    }
  }

  if (leftSource?.inputSource.gamepad) {
    const { x, y } = getStickAxes(leftSource.inputSource.gamepad.axes)
    if (Math.abs(x) > 0.05 || Math.abs(y) > 0.05) {
      leftState.position.x += x * speed * deltaSeconds
      leftState.position.y += -y * speed * deltaSeconds
      applyState(leftPlane, leftState)
      didChange = true
    }

    const leftButtons = leftSource.inputSource.gamepad.buttons
    if (isPressedAny(leftButtons, [2, 0])) {
      leftState.rotation.z -= rotSpeed * deltaSeconds
      applyState(leftPlane, leftState)
      didChange = true
    }
    if (isPressedAny(leftButtons, [3, 1])) {
      leftState.rotation.z += rotSpeed * deltaSeconds
      applyState(leftPlane, leftState)
      didChange = true
    }
  }

  if (rightSource) {
    const rightMotion = rightSource.motionController
    const aButton = rightMotion?.getComponent('a-button')
    const bButton = rightMotion?.getComponent('b-button')

    if (aButton?.pressed) {
      rightState.rotation.z -= rotSpeed * deltaSeconds
      applyState(rightPlane, rightState)
      didChange = true
    }
    if (bButton?.pressed) {
      rightState.rotation.z += rotSpeed * deltaSeconds
      applyState(rightPlane, rightState)
      didChange = true
    }
  }

  if (rightSource?.inputSource.gamepad) {
    const { x, y } = getStickAxes(rightSource.inputSource.gamepad.axes)
    if (Math.abs(x) > 0.05 || Math.abs(y) > 0.05) {
      rightState.position.x += x * speed * deltaSeconds
      rightState.position.y += -y * speed * deltaSeconds
      applyState(rightPlane, rightState)
      didChange = true
    }

    const rightButtons = rightSource.inputSource.gamepad.buttons
    if (isPressedAny(rightButtons, [0, 2])) {
      rightState.rotation.z -= rotSpeed * deltaSeconds
      applyState(rightPlane, rightState)
      didChange = true
    }
    if (isPressedAny(rightButtons, [1, 3])) {
      rightState.rotation.z += rotSpeed * deltaSeconds
      applyState(rightPlane, rightState)
      didChange = true
    }
  }

  if (didChange) {
    const now = performance.now()
    if (now - lastControlSyncMs > 100) {
      syncControls()
      lastControlSyncMs = now
    }
  }
}

function getStickAxes(axes: readonly number[]) {
  if (axes.length >= 4) {
    return { x: axes[2] ?? 0, y: axes[3] ?? 0 }
  }
  return { x: axes[0] ?? 0, y: axes[1] ?? 0 }
}

function updateXrHud() {
  if (!inXrSession || !hudPlane.isVisible) return
  const left = formatState(leftState)
  const right = formatState(rightState)
  hudText.text = `Left  ${left}\nRight ${right}`
}

function formatState(state: ImageState) {
  const h = metersToDiopters(state.position.x).toFixed(1)
  const v = metersToDiopters(state.position.y).toFixed(1)
  const rot = toDegrees(state.rotation.z).toFixed(1)
  return `H ${h}Δ  V ${v}Δ  R ${rot}°`
}

function isPressedAny(buttons: readonly GamepadButton[], indices: number[]) {
  return indices.some((index) => {
    const button = buttons[index]
    if (!button) return false
    return button.pressed || button.value > 0.5
  })
}

function updateControllerVisibility() {
  controllerMap.forEach((controller) => {
    updateSingleControllerVisibility(controller)
  })
}

function updateSingleControllerVisibility(controller: WebXRInputSource) {
  const enabled = showControllers
  controller.pointer?.setEnabled(enabled)
  controller.grip?.setEnabled(enabled)
  controller.motionController?.rootMesh?.setEnabled(enabled)
}

function updatePreviewViewports() {
  const width = engine.getRenderWidth()
  const height = engine.getRenderHeight()
  const aspect = width / height

  const panelWidth = Math.min(0.2, 0.24 * (1 / aspect))
  const panelHeight = panelWidth * 0.75
  const margin = 0.015
  const gap = 0.01
  const top = 1 - margin - panelHeight

  // Left preview on left, right preview on right
  leftPreviewCamera.viewport = new Viewport(
    1 - margin - panelWidth * 2 - gap,
    top,
    panelWidth,
    panelHeight,
  )
  rightPreviewCamera.viewport = new Viewport(
    1 - margin - panelWidth,
    top,
    panelWidth,
    panelHeight,
  )

  camera.viewport = new Viewport(0, 0, 1, 1)

  // Update label positions to match viewports
  const leftX = (1 - margin - panelWidth * 2 - gap) * width
  const rightX = (1 - margin - panelWidth) * width
  const labelTop = margin * height
  const labelWidth = panelWidth * width
  const labelHeight = panelHeight * height

  previewLabels.left.style.left = `${leftX}px`
  previewLabels.left.style.top = `${labelTop}px`
  previewLabels.left.style.width = `${labelWidth}px`
  previewLabels.left.style.height = `${labelHeight}px`

  previewLabels.right.style.left = `${rightX}px`
  previewLabels.right.style.top = `${labelTop}px`
  previewLabels.right.style.width = `${labelWidth}px`
  previewLabels.right.style.height = `${labelHeight}px`
}

function createPanel(root: HTMLElement, title: string) {
  const panelTitle = document.createElement('div')
  panelTitle.className = 'panel-title'
  panelTitle.textContent = title
  root.appendChild(panelTitle)

  const panel = document.createElement('div')
  panel.className = 'panel'
  root.appendChild(panel)
  return panel
}

function buildControls(
  panel: HTMLElement,
  state: ImageState,
  initialState: ImageState,
  onChange: (next: ImageState) => void,
) {
  const controls: Array<ReturnType<typeof createRangeControl>> = []

  // Horizontal: -75Δ to +75Δ (corresponds to -1.5m to +1.5m at 2m distance)
  controls.push(
    createRangeControl(panel, 'Horiz (Δ)', -75, 75, 0.5, metersToDiopters(state.position.x), (diopters) => {
      state.position.x = dioptersToMeters(diopters)
      onChange(state)
    }),
  )
  // Vertical: -75Δ to +75Δ
  controls.push(
    createRangeControl(panel, 'Vert (Δ)', -75, 75, 0.5, metersToDiopters(state.position.y), (diopters) => {
      state.position.y = dioptersToMeters(diopters)
      onChange(state)
    }),
  )
  // Rotation in degrees (cyclorotation)
  controls.push(
    createRangeControl(panel, 'Rot (°)', -90, 90, 0.5, toDegrees(state.rotation.z), (value) => {
      state.rotation.z = toRadians(value)
      onChange(state)
    }),
  )

  const resetRow = document.createElement('div')
  resetRow.className = 'button-row'
  const resetButton = createButton('Reset')
  resetRow.appendChild(resetButton)
  panel.appendChild(resetRow)

  resetButton.addEventListener('click', () => {
    reset(cloneState(initialState))
  })

  const reset = (next: ImageState) => {
    state.position = { ...next.position }
    state.rotation = { ...next.rotation }
    controls.forEach((control) => control.setValue(control.getInitial(state)))
    onChange(state)
  }

  const sync = (next: ImageState) => {
    controls.forEach((control) => control.setValue(control.getInitial(next)))
  }

  return { reset, sync }
}

function createRangeControl(
  panel: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (next: number) => void,
) {
  const row = document.createElement('div')
  row.className = 'control-row'

  const text = document.createElement('div')
  text.textContent = label

  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)

  const valueLabel = document.createElement('div')
  valueLabel.className = 'value'
  valueLabel.textContent = value.toFixed(2)

  input.addEventListener('input', () => {
    const next = Number(input.value)
    valueLabel.textContent = next.toFixed(2)
    onChange(next)
  })

  row.appendChild(text)
  row.appendChild(input)
  row.appendChild(valueLabel)
  panel.appendChild(row)

  return {
    setValue: (next: number) => {
      input.value = String(next)
      valueLabel.textContent = next.toFixed(2)
      onChange(next)
    },
    getInitial: (state: ImageState) => {
      if (label === 'Horiz (Δ)') return metersToDiopters(state.position.x)
      if (label === 'Vert (Δ)') return metersToDiopters(state.position.y)
      return toDegrees(state.rotation.z)
    },
  }
}

function createToggleControl(
  panel: HTMLElement,
  label: string,
  value: boolean,
  onChange: (next: boolean) => void,
) {
  const row = document.createElement('div')
  row.className = 'control-row'
  row.style.gridTemplateColumns = '1fr auto'

  const text = document.createElement('div')
  text.textContent = label

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = value

  input.addEventListener('change', () => {
    onChange(input.checked)
  })

  row.appendChild(text)
  row.appendChild(input)
  panel.appendChild(row)
}

function createSelectControl(
  panel: HTMLElement,
  label: string,
  options: Array<{ id: string; name: string }>,
  value: string,
  onChange: (next: string) => void,
) {
  const row = document.createElement('div')
  row.className = 'control-row'
  row.style.gridTemplateColumns = '1fr 2fr'

  const text = document.createElement('div')
  text.textContent = label

  const select = document.createElement('select')
  select.className = 'select-control'

  options.forEach((option) => {
    const opt = document.createElement('option')
    opt.value = option.id
    opt.textContent = option.name
    if (option.id === value) {
      opt.selected = true
    }
    select.appendChild(opt)
  })

  select.addEventListener('change', () => {
    onChange(select.value)
  })

  row.appendChild(text)
  row.appendChild(select)
  panel.appendChild(row)
}

function createButton(label: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  return button
}

function cloneState(state: ImageState): ImageState {
  return {
    position: { ...state.position },
    rotation: { ...state.rotation },
  }
}
