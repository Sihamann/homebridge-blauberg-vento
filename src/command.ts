import { createSocket, Socket } from 'dgram';
import { DataBlock, FuncType, Packet, Parameter, SpeedNumber, UnitOnOff, VentilationMode } from './packet.js';

const PORT = 4000;

export class Command {
  private constructor(
    private readonly func: FuncType,
    private readonly data: DataBlock[],
  ) {
  }

  public static status() {
    return new Command(FuncType.READ, [
      new DataBlock(Parameter.UNIT_ON_OFF),
      new DataBlock(Parameter.SPEED_NUMBER),
      new DataBlock(Parameter.CURRENT_HUMIDITY),
      new DataBlock(Parameter.VENTILATION_MODE),
      new DataBlock(Parameter.ALARM_WARNING_INDICATOR),
      new DataBlock(Parameter.FILTER_TIMER_COUNTDOWN),
      new DataBlock(Parameter.FILTER_REPLACEMENT_INDICATOR),
    ]);
  }

  public static onOff(value: UnitOnOff) {
    return new Command(FuncType.WRITE, [new DataBlock(Parameter.UNIT_ON_OFF, value)]);
  }

  public static speed(value: SpeedNumber) {
    return new Command(FuncType.WRITE, [new DataBlock(Parameter.SPEED_NUMBER, value)]);
  }

  public static mode(value: VentilationMode) {
    return new Command(FuncType.WRITE, [new DataBlock(Parameter.VENTILATION_MODE, value)]);
  }

  /**
   * Sends the command to the device and waits for its response.
   * The socket is always closed and the promise always settled, either by a response, an error or the timeout.
   */
  public execute(ip: string, deviceId: string, password: string, timeout: number): Promise<Packet> {
    return new Promise((resolve, reject) => {
      let socket: Socket | undefined;
      let settled = false;
      let timer: NodeJS.Timeout | undefined = undefined;

      const finish = (error?: Error, packet?: Packet) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          socket?.close();
        } catch {
          // socket already closed
        }
        if (error) {
          reject(error);
        } else {
          resolve(packet!);
        }
      };

      timer = setTimeout(() => finish(new Error('Command timeout')), timeout);

      try {
        const request = new Packet(deviceId, password, this.func, this.data).toBytes();
        socket = createSocket('udp4')
          .on('error', error => finish(error))
          .on('message', message => {
            try {
              const response = Packet.fromBytes(message);
              if (response.deviceId !== deviceId) {
                throw new Error(`Unexpected device ID in response: ${response.deviceId}`);
              }
              finish(undefined, response);
            } catch (error) {
              finish(error as Error);
            }
          });
        socket.connect(PORT, ip, () => socket!.send(request, error => {
          if (error) {
            finish(error);
          }
        }));
      } catch (error) {
        finish(error as Error);
      }
    });
  }
}
