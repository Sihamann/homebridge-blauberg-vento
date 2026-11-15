import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { VentoExpertAccessory } from './accessory.js';
import { Device } from './device.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export class BlaubergVentoPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  private readonly handlers: VentoExpertAccessory[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');

      this.discoverDevices();
    });

    this.api.on('shutdown', () => this.handlers.forEach(handler => handler.shutdown()));
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  discoverDevices() {
    const devices: Partial<Device>[] = Array.isArray(this.config.devices) ? this.config.devices : [];
    devices.forEach((config, index) => {
      if (!config?.ip || !config.deviceId || !config.password) {
        this.log.error(`Device #${index + 1} (${config?.name ?? 'no name'}) skipped: ip, deviceId and password are required`);
        return;
      }

      const device = new Device({ ...config, name: config.name || config.deviceId });
      if (this.discoveredCacheUUIDs.includes(this.api.hap.uuid.generate(device.deviceId))) {
        this.log.error(`Device #${index + 1} (${device.name}) skipped: duplicate deviceId ${device.deviceId}`);
        return;
      }

      try {
        this.configureDevice(device);
      } catch (error) {
        this.log.error(`Device #${index + 1} (${device.name}) could not be configured: ${(error as Error).message}`);
      }
    });

    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  configureDevice(device: Device) {
    const uuid = this.api.hap.uuid.generate(device.deviceId);
    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      this.handlers.push(new VentoExpertAccessory(this, existingAccessory, device));
    } else {
      this.log.info('Adding new accessory:', device.name);
      const accessory = new this.api.platformAccessory(device.name, uuid);
      this.handlers.push(new VentoExpertAccessory(this, accessory, device));
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.discoveredCacheUUIDs.push(uuid);
  }
}
