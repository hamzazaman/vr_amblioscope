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
  WebXRState,
} from '@babylonjs/core'
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

const leftMask = 0x10000000
const rightMask = 0x20000000
const commonMask = 0x0fffffff

const defaultLeft: ImageState = {
  position: { x: 0, y: 1.6, z: 2.0 },
  rotation: { x: 0, y: 0, z: 0 },
}

const defaultRight: ImageState = {
  position: { x: 0, y: 1.6, z: 2.0 },
  rotation: { x: 0, y: 0, z: 0 },
}

const toRadians = (deg: number) => (deg * Math.PI) / 180
const toDegrees = (rad: number) => (rad * 180) / Math.PI

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

const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
light.intensity = 0.85

const leftPlane = MeshBuilder.CreatePlane('leftPlane', { size: 0.6 }, scene)
const rightPlane = MeshBuilder.CreatePlane('rightPlane', { size: 0.6 }, scene)
leftPlane.layerMask = leftMask
rightPlane.layerMask = rightMask

const leftMaterial = new StandardMaterial('leftMaterial', scene)
const rightMaterial = new StandardMaterial('rightMaterial', scene)
leftMaterial.disableLighting = true
rightMaterial.disableLighting = true
leftMaterial.emissiveColor = Color3.White()
rightMaterial.emissiveColor = Color3.White()

leftMaterial.diffuseTexture = createPlaceholderTexture(scene, 'LEFT', '#3ee78b')
rightMaterial.diffuseTexture = createPlaceholderTexture(scene, 'RIGHT', '#ffb347')
leftPlane.material = leftMaterial
rightPlane.material = rightMaterial

applyState(leftPlane, defaultLeft)
applyState(rightPlane, defaultRight)

const { setStatus, attachXRButtons } = buildUI(uiRoot)
setStatus(engine.webGLVersion === 2 ? 'WebGL2 ready.' : 'WebGL2 not detected.')

engine.runRenderLoop(() => {
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

scene
  .createDefaultXRExperienceAsync({
    disableDefaultUI: true,
    optionalFeatures: true,
  })
  .then((xrHelper) => {
    attachXRButtons(xrHelper)

    xrHelper.baseExperience.onStateChangedObservable.add((state) => {
      if (state === WebXRState.IN_XR) {
        const rigCameras = xrHelper.baseExperience.camera?.rigCameras ?? []
        if (rigCameras.length >= 2) {
          rigCameras[0].layerMask = leftMask | commonMask
          rigCameras[1].layerMask = rightMask | commonMask
        }
        setStatus('In XR session.')
      }

      if (state === WebXRState.NOT_IN_XR) {
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

  const leftPanel = createPanel(root, 'Left Eye Image')
  const rightPanel = createPanel(root, 'Right Eye Image')

  const leftState = cloneState(defaultLeft)
  const rightState = cloneState(defaultRight)

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
  })

  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.textContent =
    'Use the sliders to align each image. Enter VR for headset view; changes apply live.'
  root.appendChild(hint)

  return {
    statusText: status,
    setStatus: (text: string) => {
      status.textContent = text
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

  controls.push(
    createRangeControl(panel, 'Pos X', -1.5, 1.5, 0.01, state.position.x, (value) => {
      state.position.x = value
      onChange(state)
    }),
  )
  controls.push(
    createRangeControl(panel, 'Pos Y', 0.5, 2.5, 0.01, state.position.y, (value) => {
      state.position.y = value
      onChange(state)
    }),
  )
  controls.push(
    createRangeControl(panel, 'Pos Z', 0.5, 4, 0.01, state.position.z, (value) => {
      state.position.z = value
      onChange(state)
    }),
  )

  controls.push(
    createRangeControl(panel, 'Rot X', -45, 45, 0.5, toDegrees(state.rotation.x), (value) => {
      state.rotation.x = toRadians(value)
      onChange(state)
    }),
  )
  controls.push(
    createRangeControl(panel, 'Rot Y', -45, 45, 0.5, toDegrees(state.rotation.y), (value) => {
      state.rotation.y = toRadians(value)
      onChange(state)
    }),
  )
  controls.push(
    createRangeControl(panel, 'Rot Z', -90, 90, 0.5, toDegrees(state.rotation.z), (value) => {
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

  return { reset }
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
      if (label === 'Pos X') return state.position.x
      if (label === 'Pos Y') return state.position.y
      if (label === 'Pos Z') return state.position.z
      if (label === 'Rot X') return toDegrees(state.rotation.x)
      if (label === 'Rot Y') return toDegrees(state.rotation.y)
      return toDegrees(state.rotation.z)
    },
  }
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
