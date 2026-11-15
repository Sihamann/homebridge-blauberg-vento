import { TextDecoder, TextEncoder } from 'util';

const MAX_PACKET_SIZE = 256;
const PACKET_START = 0xFD;
const PROTOCOL_TYPE = 0x02;

// Special bytes within the data block of a packet
const SPECIAL_PAGE = 0xFF; // next byte: high byte (page) of the following parameter numbers
const SPECIAL_FUNCTION = 0xFC; // next byte: function for the following parameters
const SPECIAL_SIZE = 0xFE; // next byte: value size of the following parameter
const SPECIAL_UNSUPPORTED = 0xFD; // next byte: parameter not supported by the device

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export class Packet {

  constructor(public readonly deviceId: string,
    public readonly password: string,
    public readonly func: FuncType,
    public readonly data: DataBlock[]) {
  }

  public toBytes(): Uint8Array {
    const bytes = new Uint8Array(MAX_PACKET_SIZE);
    let i = 0;

    // Header
    bytes[i++] = PACKET_START;
    bytes[i++] = PACKET_START;
    bytes[i++] = PROTOCOL_TYPE;

    // Device ID
    const deviceId = TEXT_ENCODER.encode(this.deviceId);
    bytes[i++] = deviceId.length;
    bytes.set(deviceId, i);
    i += deviceId.length;

    // Password
    const password = TEXT_ENCODER.encode(this.password);
    bytes[i++] = password.length;
    bytes.set(password, i);
    i += password.length;

    // Function
    bytes[i++] = this.func;

    // Data
    this.data.forEach(dataBlock => {
      bytes[i++] = dataBlock.parameter;
      if (this.func === FuncType.WRITE) {
        bytes[i++] = dataBlock.value!;
      }
    });

    // Checksum
    bytes.set(Packet.checksum(bytes.subarray(2, i)), i);
    return bytes.subarray(0, i + 2);
  }

  public static fromBytes(bytes: Uint8Array): Packet {
    const end = bytes.length - 2; // position of checksum
    let i = 0;

    const next = (): number => {
      if (i >= end) {
        throw new Error('Invalid packet: unexpected end of data');
      }
      return bytes[i++];
    };

    // Header
    if (bytes.length < 8 || bytes[i++] !== PACKET_START || bytes[i++] !== PACKET_START || bytes[i++] !== PROTOCOL_TYPE) {
      throw new Error('Invalid packet header: ' + Array.from(bytes.subarray(0, 3)));
    }

    // Device ID
    const deviceIdSize = next();
    const deviceId = TEXT_DECODER.decode(bytes.subarray(i, i + deviceIdSize));
    i += deviceIdSize;

    // Password
    const passwordSize = next();
    const password = TEXT_DECODER.decode(bytes.subarray(i, i + passwordSize));
    i += passwordSize;

    // Function
    const func = next();
    if (func !== FuncType.RESPONSE) {
      throw new Error('Invalid packet function: ' + func);
    }

    // Data
    const dataBlocks: DataBlock[] = [];
    let page = 0;
    while (i < end) {
      const b = next();
      if (b === SPECIAL_PAGE) {
        page = next();
      } else if (b === SPECIAL_FUNCTION) {
        next(); // function change is not relevant for responses
      } else if (b === SPECIAL_UNSUPPORTED) {
        dataBlocks.push(new DataBlock((page << 8) | next(), undefined, undefined, true));
      } else if (b === SPECIAL_SIZE) {
        const size = next();
        const param = (page << 8) | next();
        if (i + size > end) {
          throw new Error('Invalid packet: unexpected end of data');
        }
        const data = bytes.slice(i, i += size);
        dataBlocks.push(new DataBlock(param, size === 1 ? data[0] : undefined, data));
      } else {
        const param = (page << 8) | b;
        dataBlocks.push(new DataBlock(param, next()));
      }
    }

    // Checksum
    const calculated = Packet.checksum(bytes.subarray(2, end));
    const actual = [bytes[end], bytes[end + 1]];
    if (calculated[0] !== actual[0] || calculated[1] !== actual[1]) {
      throw new Error('Invalid packet checksum. Expected: ' + calculated + '. Actual: ' + actual);
    }

    return new Packet(deviceId, password, FuncType.RESPONSE, dataBlocks);
  }

  /**
   * Returns the data block of the given parameter, if the device has returned a supported value for it.
   */
  public get(parameter: Parameter): DataBlock | undefined {
    return this.data.find(block => block.parameter === parameter && !block.unsupported);
  }

  private static checksum(bytes: Uint8Array): number[] {
    let checksum = 0;
    bytes.forEach(b => checksum += b);
    checksum = checksum & 0xFFFF;
    return [checksum & 0xFF, checksum >> 8];
  }
}

export enum FuncType {
  READ = 0x01,
  WRITE = 0x03,
  RESPONSE = 0x06
}

export enum Parameter {
  UNIT_ON_OFF = 0x01,
  SPEED_NUMBER = 0x02,
  CURRENT_HUMIDITY = 0x25,
  VENTILATION_MODE = 0xB7,
  ALARM_WARNING_INDICATOR = 0x83,
  FILTER_TIMER_COUNTDOWN = 0x64,
  FILTER_REPLACEMENT_INDICATOR = 0x88,
}

export enum UnitOnOff {
  ON = 1,
  OFF = 0
}

export enum SpeedNumber {
  SPEED_1 = 1,
  SPEED_2 = 2,
  SPEED_3 = 3
}

export enum VentilationMode {
  VENTILATION = 0,
  HEAT_RECOVERY = 1,
  SUPPLY = 2
}

export enum AlarmWarningIndicator {
  NO = 0,
  ALARM = 1,
  WARNING = 2
}

export enum FilterReplacementIndicator {
  REQUIRED = 1,
  NOT_REQUIRED = 0
}

export class DataBlock {
  constructor(public readonly parameter: Parameter,
    public readonly value?: number,
    public readonly data?: Uint8Array,
    public readonly unsupported: boolean = false) {
  }
}
