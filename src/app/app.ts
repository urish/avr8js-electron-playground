import {
  LEDElement,
  BuzzerElement,
  ServoElement,
  SSD1306Element,
  LCD1602Element,
  PushbuttonElement,
  NeopixelMatrixElement
} from '@wokwi/elements';

import { PinState } from 'avr8js';
import { buildHex } from "../shared/compile";
import { CPUPerformance } from '../shared/cpu-performance';
import { AVRRunner } from "../shared/execute";
import { formatTime } from "../shared/format-time";
import { EditorHistoryUtil } from '../shared/editor-history.util';
import { SSD1306Controller, SSD1306_ADDR_OTHER } from "../shared/ssd1306";
import { WS2812Controller } from "../shared/ws2812";
import { LCD1602Controller, LCD1602_ADDR } from "../shared/lcd1602";
import { I2CBus } from "../shared/i2c-bus";

import * as fs from "fs";

// Get Monaco Editor
declare function getEditor(): any;
declare function getProjectPath(): any;
declare function getProjectName(ext: any): any;
declare function getProjectHex(): any;
declare function setProjectHex(folder: any, fileHex: any): any;

// Add events to the buttons
const compileButton = document.querySelector("#compile-button");
compileButton.addEventListener("click", compileAndRun);

const runButton = document.querySelector("#run-button");
runButton.addEventListener("click", onlyRun);

const stopButton = document.querySelector("#stop-button");
stopButton.addEventListener("click", stopCode);

const clearButton = document.querySelector("#clear-button");
clearButton.addEventListener("click", clearOutput);

const loadHexButton = document.querySelector("#loadhex-button");
loadHexButton.addEventListener("click", loadHex);

const fileInput = document.querySelector<HTMLInputElement>('#file-input');
fileInput.addEventListener('change', changeFileInput);

const statusLabel = document.querySelector("#status-label");
const statusLabelTimer = document.querySelector("#status-label-timer");
const statusLabelSpeed = document.querySelector("#status-label-speed");
const runnerOutputText = document.querySelector<HTMLElement>('#runner-output-text');

const serialInput = document.querySelector<HTMLInputElement>('#serial-input');
serialInput.addEventListener("keypress", serialKeyPress);

const serialSend = document.querySelector('#serial-send');
serialSend.addEventListener("click", serialTransmit);

// Set up LEDs
const leds = document.querySelectorAll<LEDElement>("wokwi-led");
const led11 = document.querySelector<LEDElement & Element>('wokwi-led[color=blue]');

// Set up the LCD1602
const lcd1602 = document.querySelector<LCD1602Element>(
  "wokwi-lcd1602"
);

// Set up the SSD1306
const ssd1306 = document.querySelector<SSD1306Element>(
  "wokwi-ssd1306"
);

// Set up the NeoPixel matrix
const matrix = document.querySelector<NeopixelMatrixElement>(
  "wokwi-neopixel-matrix"
);

const matrixPin = parseInt(matrix.getAttribute("pin"), 10);

// Set up the servo
const servo = document.querySelector<ServoElement>(
  "wokwi-servo"
);

// Set up the NeoPixel matrix
const buzzer = document.querySelector<BuzzerElement>(
  "wokwi-buzzer"
);

const buzzerPin = parseInt(buzzer.getAttribute("pin"), 10);

// Set up the push button
const pushButton = document.querySelector<PushbuttonElement & HTMLElement>(
  "wokwi-pushbutton"
);

// Set up the NeoPixel canvas
const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");

const pixSize = canvas.height / matrix.rows;

// Set up toolbar
let runner: AVRRunner;

let board = 'uno';

let hasLEDsPortB: boolean;
let hasLEDsPortD: boolean;

function executeProgram(hex: string) {

  runner = new AVRRunner(hex);

  const cpuNanos = () => Math.round((runner.cpu.cycles / runner.frequency) * 1000000000);
  const cpuMillis = () => Math.round((runner.cpu.cycles / runner.frequency) * 1000);

  const cpuPerf = new CPUPerformance(runner.cpu, runner.frequency);

  const i2cBus = new I2CBus(runner.twi);

  const ssd1306Controller = new SSD1306Controller(cpuMillis);
  const lcd1602Controller = new LCD1602Controller(cpuMillis);
  const matrixController = new WS2812Controller(matrix.cols * matrix.rows);

  // LED PWM
  const PWM_LED = false;
  const pin11State = runner.portB.pinState(3);

  let lastState = PinState.Input;
  let lastStateCycles = 0;
  let lastUpdateCycles = 0;
  let ledHighCycles = 0;

  i2cBus.registerDevice(SSD1306_ADDR_OTHER, ssd1306Controller);
  i2cBus.registerDevice(LCD1602_ADDR, lcd1602Controller);

  // Enable as default
  hasLEDsPortB = true;
  hasLEDsPortD = true;

  // Hook to PORTB register
  runner.portB.addListener(value => {
    // Port B starts at pin 8 to 13
    if (hasLEDsPortB) {
      hasLEDsPortB = false;
      updateLEDs(value, 8);
    }

    // PWM
    if (PWM_LED && (lastState !== pin11State)) {
      const delta = runner.cpu.cycles - lastStateCycles;

      if (lastState === PinState.High) {
        ledHighCycles += delta;
      }

      lastState = pin11State;
      lastStateCycles = runner.cpu.cycles;
    }

    // Feed the speaker
    // runner.speaker.feed(runner.portB.pinState(buzzerPin));
    // buzzer.hasSignal = runner.portB.pinState(buzzerPin) == PinState.High;
  });

  // Hook to PORTC register
  runner.portC.addListener((value) => {
    // Analog input pins
  });

  // Hook to PORTD register
  runner.portD.addListener((value) => {
    // Port D starts at pin 0 to 7
    // Feed the matrix
    matrixController.feedValue(runner.portD.pinState(matrixPin), cpuNanos());
  });

  // Set up the push button
  pushButton.addEventListener('button-press', () => {
    const pushButtonPin = parseInt(pushButton.getAttribute("pin"), 10);
    runner.portD.setPin(pushButtonPin, true);
  });

  pushButton.addEventListener('button-release', () => {
    const pushButtonPin = parseInt(pushButton.getAttribute("pin"), 10);
    runner.portD.setPin(pushButtonPin, false);
  });

  // Connect to Serial port
  runner.usart.onByteTransmit = (value: number) => {
    runnerOutputText.textContent += String.fromCharCode(value);
  };

  // Connect to SPI
  runner.spi.onTransfer = (value: number) => {
    runnerOutputText.textContent += "SPI: 0x" + value.toString(16) + "\n";
    return value;
  };

  runner.execute((cpu) => {
    const time = formatTime(cpu.cycles / runner.frequency);
    const speed = (cpuPerf.update() * 100).toFixed(0);
    const pixels = matrixController.update(cpuNanos());
    const frame = ssd1306Controller.update();
    const lcd = lcd1602Controller.update();

    if (pixels) {
    // Update NeoPixel matrix
      redrawMatrix(pixels);
    }

    if (frame) {
      // Update SSD1306
      ssd1306Controller.toImageData(ssd1306.imageData);
      ssd1306.redraw();
    }

    if (lcd) {
      // Update LCD1602
      lcd1602.blink = lcd.blink;
      lcd1602.cursor = lcd.cursor;
      lcd1602.cursorX = lcd.cursorX;
      lcd1602.cursorY = lcd.cursorY;
      lcd1602.characters = lcd.characters;
      lcd1602.backlight = lcd.backlight;
    }

    // PWM
    if (PWM_LED) {
      const cyclesSinceUpdate = cpu.cycles - lastUpdateCycles;
      const pin11State = runner.portB.pinState(3);

      if (pin11State === PinState.High) {
        ledHighCycles += cpu.cycles - lastStateCycles;
      }

      led11.value = ledHighCycles > 0;
      led11.brightness = ledHighCycles / cyclesSinceUpdate;

      lastUpdateCycles = cpu.cycles;
      lastStateCycles = cpu.cycles;
      ledHighCycles = 0;
    }

    // Update status
    statusLabel.textContent = 'Simulation time: ';
    statusLabelTimer.textContent = `${time}`;
    statusLabelSpeed.textContent = `${speed}%`;
  });
}

async function compileAndRun() {

  storeUserSnippet();

  // Disable buttons
  compileButton.setAttribute('disabled', '1');
  runButton.setAttribute('disabled', '1');

  clearOutput();

  try {
    statusLabel.textContent = 'Compiling...';
    statusLabelTimer.textContent = '00:00.000';
    statusLabelSpeed.textContent = '0%';

    const result = await buildHex(getEditor().getValue(), [
      // { name: "pitches.h", content: PITCHES_H  } // Other files
    ], board);

    runnerOutputText.textContent = result.stderr || result.stdout;

    if (result.hex) {
      // Set project hex filename
      setProjectHex(getProjectPath(), getProjectName('.hex'));

      // Save hex
      fs.writeFile(getProjectHex(), result.hex, function (err) {
          if (err) return console.log(err)
      });

      stopButton.removeAttribute('disabled');

      clearLeds();
      executeProgram(result.hex);
    } else {
      runButton.removeAttribute('disabled');
    }
  } catch (err) {
    runButton.removeAttribute('disabled');
    alert('Failed: ' + err);
  } finally {
    statusLabel.textContent = '';
  }
}

function storeUserSnippet() {
  EditorHistoryUtil.clearSnippet();
  EditorHistoryUtil.storeSnippet(getEditor().getValue());
}

function onlyRun() {
  fs.readFile(getProjectHex(), 'utf8', function(err, data) {
    if (err) {
      runnerOutputText.textContent += err + "\n";
    }

    if (data) {
      stopButton.removeAttribute('disabled');
      runButton.setAttribute('disabled', '1');

      clearLeds();
      executeProgram(data);
    }
  });
}

function stopCode() {
  stopButton.setAttribute('disabled', '1');
  compileButton.removeAttribute('disabled');
  runButton.removeAttribute('disabled');

  if (runner) {
    runner.stop();
    runner = null;

    // Set backlight off
    lcd1602.characters.fill(32);
    lcd1602.backlight = false;
    lcd1602.blink = false;
    lcd1602.cursor = false;

    statusLabel.textContent = 'Stop simulation: ';
  }
}

function serialKeyPress(event: any) {
  // Ckeck Enter
  if (event.charCode == 13) {
    serialTransmit();
  }
}

function serialTransmit() {
  // Serial transmit
  if (runner) {
    runner.serialWrite(serialInput.value + "\n");
    serialInput.value = "";
  } else {
    runnerOutputText.textContent += "Warning: AVR is not running!\n";
  }
}

function redrawMatrix(pixels: any) {
  for (let row = 0; row < matrix.rows; row++) {
    for (let col = 0; col < matrix.cols; col++) {
      const value = pixels[row * matrix.cols + col];

      const b = value & 0xff;
      const r = (value >> 8) & 0xff;
      const g = (value >> 16) & 0xff;

      // Canvas update
      context.fillStyle = `rgb(${r}, ${g}, ${b})`;
      context.fillRect(col * pixSize, row * pixSize, pixSize, pixSize);

      // NeoPixel update
      matrix.setPixel(row, col, {
        b: (value & 0xff) / 255,
        r: ((value >> 8) & 0xff) / 255,
        g: ((value >> 16) & 0xff) / 255
      });
    }
  }
}

function clearLeds() {
  leds.forEach(function(led) {
    const pin = parseInt(led.getAttribute("pin"), 10);
    led.value = false;
  });
}

function updateLEDs(value: number, startPin: number) {
  leds.forEach(function(led) {
    const pin = parseInt(led.getAttribute("pin"), 10);
    // Check pin
    if (pin >= startPin && pin <= startPin + 8) {
      // Check LED in portB
      if (startPin == 8)
        hasLEDsPortB = true;

      // Check LED in portD
      if (startPin == 0)
        hasLEDsPortD = true;

      // Set LED
      led.value = value & (1 << (pin - startPin)) ? true : false;
    }
  });
}

function clearOutput() {
  runnerOutputText.textContent = '';
}

function loadHex() {
  fileInput.click();
}

function changeFileInput() {
  let file = fileInput.files[0];

  if (file.name.match(/\.(hex)$/)) {
    // Set project hex filename
    setProjectHex(file.path, '');
    runnerOutputText.textContent += "Load HEX: " + file.path + "\n";
  } else {
    runnerOutputText.textContent += "File not supported, .hex files only!\n";
  }
}

function printChars(value: string) {
  return [...value].map(char => char.charCodeAt(0));
}
