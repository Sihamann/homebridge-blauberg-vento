import { CharacteristicValue, Formats, HAPStatus, PlatformAccessory, Service } from 'homebridge';

import { BlaubergVentoPlatform } from './platform.js';
import { VentoExpertClient } from './client.js';
import { AlarmWarningIndicator, SpeedNumber, UnitOnOff } from './packet.js';
import { Device, DeviceStatus } from './device.js';

const RESET_ALARM_INTERVAL = 300_000;
const SET_SPEED_TIMEOUT = 500;

export class VentoExpertAccessory {
  private service: Service;
  private filterService: Service;
  private humidityService?: Service;
  private client: VentoExpertClient;
  private setSpeedTimeout?: NodeJS.Timeout;
  private resetAlarmsInterval?: NodeJS.Timeout;
  private resettingAlarm = false;

  constructor(
    private readonly platform: BlaubergVentoPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: Device,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Blauberg Ventilatoren GmbH')
      .setCharacteristic(this.platform.Characteristic.Model, 'Vento Expert')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.deviceId);

    this.service = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);
    this.filterService = this.accessory.getService(this.platform.Service.FilterMaintenance)
      || this.accessory.addService(this.platform.Service.FilterMaintenance);

    const cachedHumidityService = this.accessory.getService(this.platform.Service.HumiditySensor);
    if (device.humidity) {
      this.humidityService = cachedHumidityService || this.accessory.addService(this.platform.Service.HumiditySensor);
    } else if (cachedHumidityService) {
      // Humidity sensor was disabled in config: remove the cached service
      this.accessory.removeService(cachedHumidityService);
    }

    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onSet(this.setRotationSpeed.bind(this))
      .setProps({
        minValue: 0,
        maxValue: 3,
        minStep: 1,
        unit: 'speed',
        format: Formats.UINT8,
      });

    this.service.getCharacteristic(this.platform.Characteristic.SwingMode)
      .onSet(this.setSwingMode.bind(this));

    this.filterService.getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .setProps({
        minValue: 0,
        maxValue: 181,
        minStep: 1,
        unit: 'days',
        format: Formats.UINT8,
      });

    this.client = new VentoExpertClient(this.device);

    if (this.device.resetAlarms !== AlarmWarningIndicator.NO) {
      this.resetAlarmsInterval = setInterval(this.resetAlarms.bind(this), RESET_ALARM_INTERVAL);
    }
  }

  public shutdown() {
    clearInterval(this.resetAlarmsInterval);
    clearTimeout(this.setSpeedTimeout);
  }

  async getActive(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.device.name}] Get status`);
    try {
      const status = await this.client.getStatus();
      this.platform.log.debug(`[${this.device.name}] Status:`, status);
      if (status.alarm !== undefined && status.alarm !== AlarmWarningIndicator.NO) {
        this.platform.log.warn(`[${this.device.name}] Device Alarm: ${AlarmWarningIndicator[status.alarm]}`);
      }

      this.updateCharacteristics(status);
      return status.active;
    } catch (error) {
      this.platform.log.warn(`[${this.device.name}] Get status error: ${(error as Error).message}`);
      throw new this.platform.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setActive(value: CharacteristicValue) {
    this.platform.log.debug(`[${this.device.name}] Turn on/off -> ${value}`);
    try {
      const active = await this.client.turnOnOff(<UnitOnOff>value);
      this.platform.log.debug(`[${this.device.name}] Turned on/off: ${active}`);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  async setRotationSpeed(value: CharacteristicValue) {
    if (value === 0) {
      return;
    }

    clearTimeout(this.setSpeedTimeout);

    // Debounced: the result can't be reported to HomeKit anymore, so errors are only logged here
    this.setSpeedTimeout = setTimeout(() => {
      this.platform.log.debug(`[${this.device.name}] Change speed -> ${value}`);
      this.client.changeSpeed(<SpeedNumber>value)
        .then(speed => this.platform.log.debug(`[${this.device.name}] Speed changed: ${speed}`))
        .catch(error => this.platform.log.warn(`[${this.device.name}] Client error: ${error.message}`));
    }, SET_SPEED_TIMEOUT);
  }

  async setSwingMode(value: CharacteristicValue) {
    this.platform.log.debug(`[${this.device.name}] Change mode -> ${value}`);
    try {
      const mode = await this.client.changeMode(value === this.platform.Characteristic.SwingMode.SWING_ENABLED
        ? this.device.swingModeOn
        : this.device.swingModeOff);
      this.platform.log.debug(`[${this.device.name}] Mode changed: ${mode}`);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  private async resetAlarms() {
    if (this.resettingAlarm) {
      return;
    }
    this.resettingAlarm = true;

    try {
      const status = await this.client.getStatus();
      if (status.alarm !== undefined && this.shouldResetAlarm(status.alarm)) {
        this.platform.log.warn(`[${this.device.name}] Device Alarm: ${AlarmWarningIndicator[status.alarm]}. Turn Off/On triggered`);
        await this.client.turnOnOff(UnitOnOff.OFF);
        await this.client.turnOnOff(UnitOnOff.ON);
      }
    } catch (error) {
      this.platform.log.warn(`[${this.device.name}] Reset alarms error: ${(error as Error).message}`);
    } finally {
      this.resettingAlarm = false;
    }
  }

  /**
   * resetAlarms = ALARM (1): reset alarms only; resetAlarms = WARNING (2): reset alarms and warnings.
   */
  private shouldResetAlarm(alarm: AlarmWarningIndicator): boolean {
    switch (this.device.resetAlarms) {
    case AlarmWarningIndicator.ALARM:
      return alarm === AlarmWarningIndicator.ALARM;
    case AlarmWarningIndicator.WARNING:
      return alarm === AlarmWarningIndicator.ALARM || alarm === AlarmWarningIndicator.WARNING;
    default:
      return false;
    }
  }

  private updateCharacteristics(status: DeviceStatus) {
    // Speed 255 means manual speed mode, which can't be shown with speed numbers 1-3
    if (status.speed >= SpeedNumber.SPEED_1 && status.speed <= SpeedNumber.SPEED_3) {
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, status.speed);
    }

    if (status.filter.life !== undefined) {
      this.filterService.updateCharacteristic(this.platform.Characteristic.FilterLifeLevel, status.filter.life);
    }
    if (status.filter.replace !== undefined) {
      this.filterService.updateCharacteristic(this.platform.Characteristic.FilterChangeIndication, status.filter.replace);
    }

    if (this.humidityService && status.humidity !== undefined) {
      this.humidityService.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, status.humidity);
    }

    if (status.mode === undefined) {
      return;
    }
    if (status.mode === this.device.swingModeOn) {
      this.service.updateCharacteristic(this.platform.Characteristic.SwingMode, this.platform.Characteristic.SwingMode.SWING_ENABLED);
    } else if (status.mode === this.device.swingModeOff) {
      this.service.updateCharacteristic(this.platform.Characteristic.SwingMode, this.platform.Characteristic.SwingMode.SWING_DISABLED);
    } else {
      this.service.updateCharacteristic(this.platform.Characteristic.SwingMode,
        new this.platform.api.hap.HapStatusError(HAPStatus.INVALID_VALUE_IN_REQUEST));
    }
  }

  private handleError(error: Error): never {
    this.platform.log.warn(`[${this.device.name}] Client error: ${error.message}`);
    throw new this.platform.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}
