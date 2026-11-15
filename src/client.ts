import { Command } from './command.js';
import { Packet, Parameter, SpeedNumber, UnitOnOff, VentilationMode } from './packet.js';
import { Device, DeviceStatus, FilterStatus } from './device.js';
import Bottleneck from 'bottleneck';

const COMMAND_TIMEOUT = 2000;

export class VentoExpertClient {
  private limiter = new Bottleneck({ maxConcurrent: 1 });

  constructor(private readonly device: Device) {
  }

  public async getStatus(): Promise<DeviceStatus> {
    const response = await this.send(Command.status());
    const filterTimer = response.get(Parameter.FILTER_TIMER_COUNTDOWN)?.data;

    return new DeviceStatus(
      VentoExpertClient.required(response, Parameter.UNIT_ON_OFF),
      VentoExpertClient.required(response, Parameter.SPEED_NUMBER),
      response.get(Parameter.CURRENT_HUMIDITY)?.value,
      response.get(Parameter.VENTILATION_MODE)?.value,
      response.get(Parameter.ALARM_WARNING_INDICATOR)?.value,
      new FilterStatus(
        filterTimer && filterTimer.length >= 3 ? filterTimer[2] : undefined, // days of FILTER_TIMER_COUNTDOWN
        response.get(Parameter.FILTER_REPLACEMENT_INDICATOR)?.value,
      ),
    );
  }

  public async turnOnOff(value: UnitOnOff): Promise<UnitOnOff> {
    return VentoExpertClient.required(await this.send(Command.onOff(value)), Parameter.UNIT_ON_OFF);
  }

  public async changeSpeed(value: SpeedNumber): Promise<SpeedNumber> {
    return VentoExpertClient.required(await this.send(Command.speed(value)), Parameter.SPEED_NUMBER);
  }

  public async changeMode(value: VentilationMode): Promise<VentilationMode> {
    return VentoExpertClient.required(await this.send(Command.mode(value)), Parameter.VENTILATION_MODE);
  }

  private async send(command: Command): Promise<Packet> {
    // The timeout starts when the command is actually sent, not while it is waiting in the queue
    return this.limiter.schedule(() => command.execute(this.device.ip, this.device.deviceId, this.device.password, COMMAND_TIMEOUT));
  }

  private static required(response: Packet, parameter: Parameter): number {
    const value = response.get(parameter)?.value;
    if (value === undefined) {
      throw new Error(`Device did not return parameter 0x${parameter.toString(16).padStart(2, '0')}`);
    }
    return value;
  }
}
