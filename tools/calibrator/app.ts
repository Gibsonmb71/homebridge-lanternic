// @ts-nocheck
const state = {
  targetAddress: '',
  requested: { red: 255, green: 0, blue: 0 },
  profile: {
    brightness: 1,
    saturation: 1,
    gain: { red: 1, green: 1, blue: 1 },
    gamma: { red: 1, green: 1, blue: 1 },
  },
};

const swatches = [
  ['Red', '#ff0000'],
  ['Orange', '#ff8000'],
  ['Yellow', '#ffff00'],
  ['Green', '#00ff00'],
  ['Blue', '#0000ff'],
  ['Purple', '#8000ff'],
  ['Cyan', '#00ffff'],
  ['Magenta', '#ff00ff'],
  ['White', '#ffffff'],
];

const sequence = [
  ['Red', '#ff0000'],
  ['Orange', '#ff8000'],
  ['Yellow', '#ffff00'],
  ['Green', '#00ff00'],
  ['Blue', '#0000ff'],
  ['Purple', '#8000ff'],
];

const $ = selector => document.querySelector(selector);

const elements = {
  colorPicker: $('#colorPicker'),
  correctedHex: $('#correctedHex'),
  correctedSwatch: $('#correctedSwatch'),
  downloadProfileButton: $('#downloadProfileButton'),
  gainControls: $('#gainControls'),
  globalControls: $('#globalControls'),
  powerOffButton: $('#powerOffButton'),
  powerOnButton: $('#powerOnButton'),
  profileOutput: $('#profileOutput'),
  requestedHex: $('#requestedHex'),
  requestedSwatch: $('#requestedSwatch'),
  resetButton: $('#resetButton'),
  rgbControls: $('#rgbControls'),
  saveProfileButton: $('#saveProfileButton'),
  saveTargetButton: $('#saveTargetButton'),
  sendButton: $('#sendButton'),
  sequenceButton: $('#sequenceButton'),
  sequenceList: $('#sequenceList'),
  statusText: $('#statusText'),
  swatchGrid: $('#swatchGrid'),
  targetAddress: $('#targetAddress'),
  gammaControls: $('#gammaControls'),
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampByte(value) {
  return Math.round(clamp(value, 0, 255));
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    red: parseInt(clean.slice(0, 2), 16),
    green: parseInt(clean.slice(2, 4), 16),
    blue: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex({ red, green, blue }) {
  return `#${[red, green, blue].map(value => clampByte(value).toString(16).padStart(2, '0')).join('')}`;
}

function correctedColor(input) {
  const profile = state.profile;
  const luma = (input.red * 0.2126) + (input.green * 0.7152) + (input.blue * 0.0722);
  const saturated = {
    red: luma + ((input.red - luma) * profile.saturation),
    green: luma + ((input.green - luma) * profile.saturation),
    blue: luma + ((input.blue - luma) * profile.saturation),
  };

  return {
    red: channelCorrection(saturated.red, profile.gain.red, profile.gamma.red, profile.brightness),
    green: channelCorrection(saturated.green, profile.gain.green, profile.gamma.green, profile.brightness),
    blue: channelCorrection(saturated.blue, profile.gain.blue, profile.gamma.blue, profile.brightness),
  };
}

function channelCorrection(value, gain, gamma, brightness) {
  const normalized = clamp(value / 255, 0, 1);
  const gammaAdjusted = normalized ** gamma;
  return clampByte(gammaAdjusted * gain * brightness * 255);
}

function setStatus(text) {
  elements.statusText.textContent = text;
}

function setRequested(color, send = false) {
  state.requested = {
    red: clampByte(color.red),
    green: clampByte(color.green),
    blue: clampByte(color.blue),
  };
  render();

  if (send) {
    void sendCurrentColor();
  }
}

function makeSlider(container, options) {
  const row = document.createElement('div');
  row.className = 'control';

  const label = document.createElement('label');
  label.textContent = options.label;

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(options.min);
  range.max = String(options.max);
  range.step = String(options.step);
  range.value = String(options.get());

  const number = document.createElement('input');
  number.type = 'number';
  number.min = String(options.min);
  number.max = String(options.max);
  number.step = String(options.step);
  number.value = String(options.get());

  const update = value => {
    const numeric = clamp(Number(value), options.min, options.max);
    options.set(numeric);
    range.value = String(numeric);
    number.value = String(numeric);
    render();
    if (options.live) {
      scheduleSend();
    }
  };

  range.addEventListener('input', () => update(range.value));
  number.addEventListener('change', () => update(number.value));

  row.append(label, range, number);
  container.append(row);
}

let sendTimer;

function scheduleSend() {
  if (sendTimer) {
    clearTimeout(sendTimer);
  }
  sendTimer = setTimeout(() => {
    void sendCurrentColor();
  }, 140);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? response.statusText);
  }

  return data;
}

async function sendCurrentColor() {
  const corrected = correctedColor(state.requested);
  try {
    const result = await api('/api/color', corrected);
    setStatus(`Sent ${rgbToHex(corrected)} · ${result.frames?.[0] ?? ''}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function setPower(on) {
  try {
    await api('/api/power', { on });
    setStatus(on ? 'Power on sent' : 'Power off sent');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function runSequence() {
  const colors = sequence.map(([, hex]) => correctedColor(hexToRgb(hex)));
  try {
    await api('/api/sequence', { colors, delayMs: 900 });
    setStatus('Sequence complete');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function profileJson() {
  return {
    targetAddress: state.targetAddress,
    protocol: {
      serviceUuid: 'fff0',
      characteristicUuid: 'fff3',
      colorFrame: '7e070503RRGGBB10ef',
    },
    colorCalibration: state.profile,
  };
}

function saveLocalProfile() {
  localStorage.setItem('lanternic-calibration-profile', JSON.stringify(state.profile));
}

function loadLocalProfile() {
  const saved = localStorage.getItem('lanternic-calibration-profile');
  if (!saved) {
    return;
  }

  try {
    state.profile = { ...state.profile, ...JSON.parse(saved) };
  } catch {
    localStorage.removeItem('lanternic-calibration-profile');
  }
}

function render() {
  const corrected = correctedColor(state.requested);
  const requestedHex = rgbToHex(state.requested);
  const correctedHex = rgbToHex(corrected);

  elements.colorPicker.value = requestedHex;
  elements.requestedHex.textContent = requestedHex;
  elements.correctedHex.textContent = `sending ${correctedHex}`;
  elements.requestedSwatch.style.background = requestedHex;
  elements.correctedSwatch.style.background = correctedHex;
  elements.profileOutput.value = JSON.stringify(profileJson(), null, 2);
  saveLocalProfile();
}

function buildControls() {
  for (const channel of ['red', 'green', 'blue']) {
    makeSlider(elements.rgbControls, {
      label: channel,
      min: 0,
      max: 255,
      step: 1,
      live: true,
      get: () => state.requested[channel],
      set: value => {
        state.requested[channel] = value;
      },
    });
  }

  makeSlider(elements.globalControls, {
    label: 'brightness',
    min: 0.1,
    max: 1.5,
    step: 0.01,
    live: true,
    get: () => state.profile.brightness,
    set: value => {
      state.profile.brightness = value;
    },
  });

  makeSlider(elements.globalControls, {
    label: 'saturation',
    min: 0,
    max: 1.6,
    step: 0.01,
    live: true,
    get: () => state.profile.saturation,
    set: value => {
      state.profile.saturation = value;
    },
  });

  for (const channel of ['red', 'green', 'blue']) {
    makeSlider(elements.gainControls, {
      label: channel,
      min: 0.2,
      max: 2,
      step: 0.01,
      live: true,
      get: () => state.profile.gain[channel],
      set: value => {
        state.profile.gain[channel] = value;
      },
    });
  }

  for (const channel of ['red', 'green', 'blue']) {
    makeSlider(elements.gammaControls, {
      label: channel,
      min: 0.4,
      max: 3,
      step: 0.01,
      live: true,
      get: () => state.profile.gamma[channel],
      set: value => {
        state.profile.gamma[channel] = value;
      },
    });
  }
}

function buildSwatches() {
  for (const [name, hex] of swatches) {
    const button = document.createElement('button');
    button.className = 'swatch-button';
    button.type = 'button';
    button.innerHTML = `<span class="mini-swatch" style="background:${hex}"></span><span>${name}</span>`;
    button.addEventListener('click', () => setRequested(hexToRgb(hex), true));
    elements.swatchGrid.append(button);
  }

  for (const [name, hex] of sequence) {
    const item = document.createElement('div');
    item.className = 'swatch-button';
    item.innerHTML = `<span class="mini-swatch" style="background:${hex}"></span><span>${name}</span>`;
    elements.sequenceList.append(item);
  }
}

function resetProfile() {
  state.profile = {
    brightness: 1,
    saturation: 1,
    gain: { red: 1, green: 1, blue: 1 },
    gamma: { red: 1, green: 1, blue: 1 },
  };
  localStorage.removeItem('lanternic-calibration-profile');
  window.location.reload();
}

async function init() {
  loadLocalProfile();

  const status = await fetch('/api/status').then(response => response.json());
  state.targetAddress = status.targetAddress;
  elements.targetAddress.value = status.targetAddress;
  if (status.savedProfile?.colorCalibration) {
    state.profile = status.savedProfile.colorCalibration;
  }

  buildControls();
  buildSwatches();

  elements.colorPicker.addEventListener('input', () => setRequested(hexToRgb(elements.colorPicker.value), true));
  elements.sendButton.addEventListener('click', () => void sendCurrentColor());
  elements.powerOnButton.addEventListener('click', () => void setPower(true));
  elements.powerOffButton.addEventListener('click', () => void setPower(false));
  elements.sequenceButton.addEventListener('click', () => void runSequence());
  elements.resetButton.addEventListener('click', resetProfile);
  elements.saveTargetButton.addEventListener('click', async () => {
    const result = await api('/api/target', { address: elements.targetAddress.value });
    state.targetAddress = result.targetAddress;
    setStatus(`Target set to ${state.targetAddress}`);
    render();
  });
  elements.saveProfileButton.addEventListener('click', async () => {
    const result = await api('/api/profile', profileJson());
    setStatus(`Saved ${result.path}`);
  });
  elements.downloadProfileButton.addEventListener('click', () => {
    const blob = new Blob([`${JSON.stringify(profileJson(), null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lanternic-calibration.json';
    link.click();
    URL.revokeObjectURL(url);
  });

  render();
  setStatus(`Ready · ${status.binding} · ${status.serviceUuid}/${status.characteristicUuid}`);
}

init().catch(error => {
  setStatus(error instanceof Error ? error.message : String(error));
});
