import { withBindings } from '@stoprocent/bleno';

const binding = process.env.LANTERNIC_BINDING ?? 'default';
const name = process.env.LANTERNIC_FAKE_NAME ?? 'MELK-CODEX01';
const firmware = Buffer.from(process.env.LANTERNIC_FAKE_FIRMWARE ?? 'WCKJ3016FV25HCV6');
const serviceUuid = 'fff0';
const writeCharacteristicUuid = 'fff3';
const notifyCharacteristicUuid = 'fff4';

const bleno = withBindings((process.env.LANTERNIC_BINDING as any) ?? 'default');
const Characteristic = bleno.Characteristic;
const PrimaryService = bleno.PrimaryService;

const callbacks = new Map();

const parseWriteArgs = (args: any[]) => {
  if (args.length >= 5) {
    const [handle, data, offset, withoutResponse, callback] = args;
    return { handle, data, offset, withoutResponse, callback };
  }

  const [data, offset, withoutResponse, callback] = args;
  return { handle: 'legacy', data, offset, withoutResponse, callback };
};

const writeCharacteristic = new Characteristic({
  uuid: writeCharacteristicUuid,
  properties: ['read', 'writeWithoutResponse'],
  onReadRequest: (...args: any[]) => {
    const callback = args.at(-1) as any;
    const offset = args.length >= 3 ? args.at(-2) : args.at(0);
    const data = offset ? firmware.subarray(offset) : firmware;
    console.log(`READ ${writeCharacteristicUuid} offset=${offset ?? 0} -> ${data.toString('hex')} (${data.toString('utf8')})`);
    callback(Characteristic.RESULT_SUCCESS, data);
  },
  onWriteRequest: (...args: any[]) => {
    const { handle, data, offset, withoutResponse, callback } = parseWriteArgs(args);
    console.log(`WRITE ${writeCharacteristicUuid} handle=${handle} offset=${offset} withoutResponse=${withoutResponse} hex=${data.toString('hex')}`);

    const notify = callbacks.get(handle);
    if (notify) {
      notify(Buffer.from([0x01]));
    }

    callback(Characteristic.RESULT_SUCCESS);
  },
});

const notifyCharacteristic = new Characteristic({
  uuid: notifyCharacteristicUuid,
  properties: ['notify'],
  onSubscribe: (...args: any[]) => {
    const [handle, maxValueSize, updateValueCallback] = args.length >= 3
      ? args
      : ['legacy', args[0], args[1]];
    callbacks.set(handle, updateValueCallback);
    console.log(`SUBSCRIBE ${notifyCharacteristicUuid} handle=${handle} maxValueSize=${maxValueSize}`);
  },
  onUnsubscribe: (...args: any[]) => {
    const handle = args[0] ?? 'legacy';
    callbacks.delete(handle);
    console.log(`UNSUBSCRIBE ${notifyCharacteristicUuid} handle=${handle}`);
  },
});

const service = new PrimaryService({
  uuid: serviceUuid,
  characteristics: [
    notifyCharacteristic,
    writeCharacteristic,
  ],
});

bleno.on('stateChange', (state: any) => {
  console.log(`stateChange ${state}`);
});

bleno.on('advertisingStart', (error: any) => {
  console.log(error ? `advertisingStart error=${error.message}` : `advertisingStart name=${name}`);
});

bleno.on('accept', (address: any, handle: any) => {
  console.log(`ACCEPT address=${address} handle=${handle}`);
});

bleno.on('disconnect', (address: any, handle: any) => {
  callbacks.delete(handle);
  console.log(`DISCONNECT address=${address} handle=${handle}`);
});

const shutdown = async () => {
  try {
    await bleno.stopAdvertisingAsync();
  } catch {
    // Ignore shutdown races.
  }
  bleno.stop();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

console.log(`Starting fake Magic Lantern strip name=${name} binding=${binding}`);
console.log('In the Magic Lantern app, scan for this fake device and change colors/modes.');
console.log('Power off the real strip while testing if the app keeps auto-connecting to it.');

await bleno.waitForPoweredOnAsync(15_000);
await bleno.setServicesAsync([service]);
await bleno.startAdvertisingAsync(name, [serviceUuid]);
