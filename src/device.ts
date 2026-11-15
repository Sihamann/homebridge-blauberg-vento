import { AlarmWarningIndicator, FilterReplacementIndicator, SpeedNumber, UnitOnOff, VentilationMode } from './packet.js';

export class Device {
  public readonly ip!: string;
  public readonly deviceId!: string;
  public readonly name!: string;
  public readonly password!: string;
  public readonly resetAlarms: AlarmWarningIndicator = AlarmWarningIndicator.NO;
  public readonly swingModeOn: VentilationMode = VentilationMode.HEAT_RECOVERY;
  public readonly swingModeOff: VentilationMode = VentilationMode.VENTILATION;
  public readonly humidity: boolean = false;

  constructor(config?: Partial<Device>) {
    Object.assign(this, config);
  }
}

export class DeviceStatus {
  constructor(
    public readonly active: UnitOnOff,
    public readonly speed: SpeedNumber,
    public readonly humidity: number | undefined,
    public readonly mode: VentilationMode | undefined,
    public readonly alarm: AlarmWarningIndicator | undefined,
    public readonly filter: FilterStatus,
  ) {
  }
}

export class FilterStatus {
  constructor(
    public readonly life: number | undefined,
    public readonly replace: FilterReplacementIndicator | undefined,
  ) {
  }
}
